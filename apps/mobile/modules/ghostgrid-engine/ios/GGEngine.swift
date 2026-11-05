import AVFoundation
import CoreMIDI
import Foundation
import os

/// Native audio engine for the proof of concept.
///
/// - Clock: frames rendered by the output, so click times are sample-accurate.
/// - Clicks: JavaScript schedules them ahead (time + level); the render callback mixes them in at the exact frame.
/// - Host-time mapping: every render cycle records which engine frame plays at which host time, so MIDI and mic
///   timestamps (host time) convert to the same clock as the clicks.
/// - Audio session: with the mic on, `.playAndRecord` + `.allowBluetoothA2DP` keeps output on a Bluetooth
///   speaker or e-drum module while the iPhone's own microphone listens.
final class GGEngine {
  var emit: ((String, [String: Any?]) -> Void)?

  // MARK: audio state (shared with the render thread under `lock`)
  private let lock: UnsafeMutablePointer<os_unfair_lock> = {
    let p = UnsafeMutablePointer<os_unfair_lock>.allocate(capacity: 1)
    p.initialize(to: os_unfair_lock())
    return p
  }()
  private var engine: AVAudioEngine?
  /// the settings of the last start(), so the engine can be brought back after the system stopped it
  private var lastStart: (keepBt: Bool, mic: Bool, sens: Double)?
  private var sourceNode: AVAudioSourceNode?
  private var sampleRate: Double = 48_000
  private var rendered: Int64 = 0
  private var mapFrame: Int64 = 0
  private var mapHost: UInt64 = 0
  private var pending: [(frame: Int64, buf: Int, gain: Float)] = []
  private var voices: [(buf: Int, pos: Int, gain: Float)] = []
  /// All playable buffers: 0–2 = click (soft, normal, accent), then the drum voices for the tempo trainer.
  private var clicks: [[Float]] = []
  private let hostToSeconds: Double = {
    var tb = mach_timebase_info_data_t()
    mach_timebase_info(&tb)
    return Double(tb.numer) / Double(tb.denom) / 1e9
  }()

  // MARK: voice recording (tap thread appends, JS thread starts and stops, guarded by recLock)
  private let recLock: UnsafeMutablePointer<os_unfair_lock> = {
    let p = UnsafeMutablePointer<os_unfair_lock>.allocate(capacity: 1)
    p.initialize(to: os_unfair_lock())
    return p
  }()
  private var recording = false
  private var recBuf: [Float] = []
  private var recStart: Double = 0
  private var recRate: Double = 48_000
  private let recMaxSeconds: Double = 600

  // MARK: mic state (tap thread only)
  private var micThreshold: Float = 0.07
  private var micFloor: Float = 0.003
  private var micHold = 0
  private var micPeak: Float = 0
  private var micLevelCounter = 0
  private var micOn = false

  // MARK: MIDI state
  private var client = MIDIClientRef()
  private var inPort = MIDIPortRef()
  private var connected: [MIDIEndpointRef] = []
  private(set) var sourceNames: [String] = []

  init() {
    pending.reserveCapacity(1024)
    voices.reserveCapacity(64)
    NotificationCenter.default.addObserver(
      forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil
    ) { [weak self] _ in
      guard let self = self else { return }
      self.emit?("onRouteChange", self.info())
    }
    // The system can stop the engine without telling the app (another AVAudioEngine such as the song player
    // changing the shared session, a call, Siri, media services reset). Then the clock freezes and nothing plays,
    // so bring it back as soon as that happens; ensureRunning() also does it right before playing.
    let revive: (Notification) -> Void = { [weak self] _ in _ = self?.ensureRunning() }
    NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main, using: revive)
    NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in
      if let v = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
         AVAudioSession.InterruptionType(rawValue: v) == .ended { _ = self?.ensureRunning() }
    }
    NotificationCenter.default.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main, using: revive)
  }

  /// Makes sure the click/drum engine is rendering; restarts it when it was stopped behind our back.
  /// `force` restarts it even if it claims to run. Returns true if it had to be restarted.
  @discardableResult
  func ensureRunning(force: Bool = false) -> Bool {
    guard let p = lastStart else { return false }
    if !force, let e = engine, e.isRunning { return false }
    _ = try? start(keepBluetoothOutput: p.keepBt, mic: p.mic, sensitivity: p.sens)
    return true
  }

  deinit {
    lock.deinitialize(count: 1)
    lock.deallocate()
    recLock.deinitialize(count: 1)
    recLock.deallocate()
  }

  // MARK: - Engine

  func start(keepBluetoothOutput: Bool, mic: Bool, sensitivity: Double) throws -> [String: Any] {
    stop()
    lastStart = (keepBluetoothOutput, mic, sensitivity)
    let session = AVAudioSession.sharedInstance()
    if mic {
      var options: AVAudioSession.CategoryOptions = [.defaultToSpeaker]
      if keepBluetoothOutput { options.insert(.allowBluetoothA2DP) }
      try session.setCategory(.playAndRecord, mode: .measurement, options: options)
    } else {
      try session.setCategory(.playback, mode: .default, options: [])
    }
    try? session.setPreferredIOBufferDuration(0.005)
    try session.setActive(true)

    let e = AVAudioEngine()
    let outFormat = e.outputNode.outputFormat(forBus: 0)
    sampleRate = outFormat.sampleRate > 0 ? outFormat.sampleRate : session.sampleRate
    makeClicks()

    os_unfair_lock_lock(lock)
    rendered = 0
    mapFrame = 0
    mapHost = mach_absolute_time()
    pending.removeAll(keepingCapacity: true)
    voices.removeAll(keepingCapacity: true)
    os_unfair_lock_unlock(lock)

    guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1) else {
      throw NSError(domain: "Ghostgrid", code: 1, userInfo: [NSLocalizedDescriptionKey: "No audio format"])
    }
    let node = AVAudioSourceNode(format: format) { [unowned self] _, timestamp, frameCount, bufferList -> OSStatus in
      self.render(timestamp: timestamp, frames: Int(frameCount), bufferList: bufferList)
      return noErr
    }
    e.attach(node)
    e.connect(node, to: e.mainMixerNode, format: format)

    micOn = false
    if mic {
      let input = e.inputNode
      let inFormat = input.outputFormat(forBus: 0)
      if inFormat.channelCount > 0 {
        // sensitivity 1–10: 5 ≈ 0.02 full scale, so a soft spoken "ts" still counts; the noise guard below rejects room hiss
        micThreshold = Float(0.12 * pow(0.65, sensitivity - 1))
        micFloor = 0.003
        micHold = 0
        input.installTap(onBus: 0, bufferSize: 512, format: inFormat) { [weak self] buffer, when in
          self?.processMic(buffer: buffer, when: when)
        }
        micOn = true
      }
    }

    e.prepare()
    try e.start()
    engine = e
    sourceNode = node
    return info()
  }

  func stop() {
    lastStart = nil   // an explicit stop must not be undone by ensureRunning()
    if let e = engine {
      if micOn { e.inputNode.removeTap(onBus: 0) }
      e.stop()
    }
    engine = nil
    sourceNode = nil
    micOn = false
  }

  func now() -> Double {
    os_unfair_lock_lock(lock)
    let f = rendered
    os_unfair_lock_unlock(lock)
    return Double(f) / sampleRate
  }

  func scheduleClick(time: Double, level: Int) {
    guard level > 0 else { return }
    let frame = Int64((time * sampleRate).rounded())
    let buf = min(max(level, 1), 3) - 1
    os_unfair_lock_lock(lock)
    if frame >= rendered { pending.append((frame, buf, 1)) }
    os_unfair_lock_unlock(lock)
  }

  /// Drum voice, index into DRUM_SOUNDS (@ghostgrid/core): kick, snare, ghost, hat, hatAcc, open, click, clickAcc,
  /// tom1, tom2, ftom, ride, crash, hhFoot, rim. `gain` scales the hit (accents, ghosts).
  func scheduleDrum(time: Double, sound: Int, gain: Double) {
    let frame = Int64((time * sampleRate).rounded())
    os_unfair_lock_lock(lock)
    let buf = 3 + sound
    if sound >= 0 && buf < clicks.count && frame >= rendered { pending.append((frame, buf, Float(gain))) }
    os_unfair_lock_unlock(lock)
  }

  func cancelAfter(time: Double) {
    let frame = Int64(time * sampleRate)
    os_unfair_lock_lock(lock)
    pending.removeAll { $0.frame > frame }
    os_unfair_lock_unlock(lock)
  }

  /// Convert engine seconds back to host time (mach_absolute_time units).
  func engineToHost(_ t: Double) -> UInt64 {
    os_unfair_lock_lock(lock)
    let f = mapFrame
    let h = mapHost
    os_unfair_lock_unlock(lock)
    let delta = t - Double(f) / sampleRate
    return UInt64(max(0, Double(h) + delta / hostToSeconds))
  }

  var hostSeconds: Double { hostToSeconds }

  /// Convert a host time (mach_absolute_time units) to engine seconds.
  func hostToEngine(_ host: UInt64) -> Double {
    os_unfair_lock_lock(lock)
    let f = mapFrame
    let h = mapHost
    os_unfair_lock_unlock(lock)
    let delta = (Double(host) - Double(h)) * hostToSeconds
    return Double(f) / sampleRate + delta
  }

  func info() -> [String: Any] {
    let s = AVAudioSession.sharedInstance()
    let out = s.currentRoute.outputs.first
    return [
      "running": engine?.isRunning ?? false,
      "sampleRate": sampleRate,
      "outputLatency": s.outputLatency + s.ioBufferDuration,
      "inputLatency": s.inputLatency + s.ioBufferDuration,
      "ioBuffer": s.ioBufferDuration,
      "route": Self.routeKind(out?.portType),
      "routeName": out?.portName ?? "",
      "mic": micOn,
    ]
  }

  private static func routeKind(_ t: AVAudioSession.Port?) -> String {
    guard let t = t else { return "other" }
    switch t {
    case .builtInSpeaker, .builtInReceiver: return "speaker"
    case .headphones, .lineOut: return "wired"
    case .bluetoothA2DP, .bluetoothLE, .bluetoothHFP: return "bluetooth"
    case .usbAudio: return "usb"
    default: return "other"
    }
  }

  // MARK: - Click sounds

  private var clickSound = "click"

  /// Choose the click sound: "click", "wood", "cowbell" or "hat". Takes effect on the next click.
  func setClickSound(_ name: String) {
    clickSound = name
    let made = makeSounds(name) + makeDrums()
    os_unfair_lock_lock(lock)
    clicks = made
    voices.removeAll(keepingCapacity: true)
    os_unfair_lock_unlock(lock)
  }

  private func makeClicks() {
    let made = makeSounds(clickSound) + makeDrums()
    os_unfair_lock_lock(lock)
    clicks = made
    os_unfair_lock_unlock(lock)
  }

  /// Three buffers per sound: index 0 = soft (subdivision), 1 = normal, 2 = accent. Same recipes as the web prototype.
  private func makeSounds(_ name: String) -> [[Float]] {
    let sr = sampleRate
    var seed: UInt32 = 12345
    func noise() -> Double { seed = seed &* 1664525 &+ 1013904223; return Double(seed) / Double(UInt32.max) * 2 - 1 }
    func env(_ t: Double, _ dur: Double) -> Double { min(1, t / 0.0015) * exp(-t / (dur / 5)) }
    func render(_ dur: Double, _ f: (Double) -> Double) -> [Float] {
      let n = Int(sr * dur)
      return (0..<n).map { i in Float(f(Double(i) / sr)) }
    }
    func tri(_ freq: Double, _ t: Double) -> Double { let x = (freq * t).truncatingRemainder(dividingBy: 1); return 4 * abs(x - 0.5) - 1 }
    func sq(_ freq: Double, _ t: Double) -> Double { sin(2 * .pi * freq * t) >= 0 ? 1 : -1 }

    func one(_ level: Int) -> [Float] {
      let gain = [0.28, 0.6, 0.95][level]
      let acc = level == 2, sub = level == 0
      switch name {
      case "wood":
        let f = acc ? 1180.0 : sub ? 640.0 : 860.0
        var prev = 0.0
        return render(0.06) { t in
          let n = noise(); let hp = n - prev; prev = n
          return (tri(f, t) * 0.9 + hp * 0.25 * exp(-t / 0.004)) * env(t, 0.06) * gain
        }
      case "cowbell":
        let m = acc ? 1.25 : sub ? 0.85 : 1.0
        return render(0.16) { t in (sq(540 * m, t) + sq(800 * m, t)) * 0.18 * env(t, 0.16) * gain }
      case "hat":
        let dur = acc ? 0.14 : 0.05
        var p1 = 0.0, p2 = 0.0
        return render(dur) { t in
          let n = noise(); let h1 = n - p1; p1 = n; let h2 = h1 - p2; p2 = h1
          return h2 * 0.35 * env(t, dur) * gain
        }
      default:
        let f = acc ? 1760.0 : sub ? 990.0 : 1320.0
        let dur = acc ? 0.045 : sub ? 0.035 : 0.04
        return render(dur) { t in sin(2 * .pi * f * t) * env(t, dur) * gain }
      }
    }
    return [one(0), one(1), one(2)]
  }

  /// Synthesised drum voices (no samples, so nothing to license). Order matches DRUM_SOUNDS in @ghostgrid/core.
  private func makeDrums() -> [[Float]] {
    let sr = sampleRate
    var seed: UInt32 = 987
    func noise() -> Double { seed = seed &* 1664525 &+ 1013904223; return Double(seed) / Double(UInt32.max) * 2 - 1 }
    func render(_ dur: Double, _ f: (Double) -> Double) -> [Float] {
      let n = Int(sr * dur)
      return (0..<n).map { i in Float(f(Double(i) / sr)) }
    }
    let attack = { (t: Double) in min(1, t / 0.001) }
    let kick = render(0.4) { t in
      let phase = 2 * .pi * (48 * t + 90 * 0.035 * (1 - exp(-t / 0.035)))
      return sin(phase) * exp(-t / 0.13) * attack(t) * 0.85
    }
    func snare(_ gain: Double) -> [Float] {
      var prev = 0.0
      return render(0.25) { t in
        let n = noise(); let hp = n - prev * 0.6; prev = n
        return (hp * 0.5 * exp(-t / 0.055) + sin(2 * .pi * 185 * t) * 0.45 * exp(-t / 0.035)) * attack(t) * gain
      }
    }
    func hat(_ dur: Double, _ gain: Double) -> [Float] {
      var p1 = 0.0, p2 = 0.0
      return render(dur) { t in
        let n = noise(); let h1 = n - p1; p1 = n; let h2 = h1 - p2; p2 = h1
        return h2 * exp(-t / (dur / 5)) * attack(t) * gain
      }
    }
    func click(_ f: Double, _ gain: Double) -> [Float] {
      render(0.045) { t in sin(2 * .pi * f * t) * min(1, t / 0.0015) * exp(-t / 0.009) * gain }
    }
    func tom(_ f0: Double, _ dur: Double) -> [Float] {
      render(dur) { t in
        let phase = 2 * .pi * (f0 * t + f0 * 0.5 * 0.04 * (1 - exp(-t / 0.04)))
        return sin(phase) * exp(-t / (dur / 4)) * attack(t) * 0.7
      }
    }
    func sq(_ freq: Double, _ t: Double) -> Double { sin(2 * .pi * freq * t) >= 0 ? 1 : -1 }
    func cymbal(_ dur: Double, _ gain: Double, _ bell: Double) -> [Float] {
      var p1 = 0.0, p2 = 0.0
      return render(dur) { t in
        let n = noise(); let h1 = n - p1; p1 = n; let h2 = h1 - p2; p2 = h1
        let metal = (sq(3140, t) + sq(4410, t) * 0.7 + sq(5930, t) * 0.5) * 0.08
        return (h2 * 0.6 + metal + sin(2 * .pi * 2350 * t) * bell * exp(-t / 0.25)) * exp(-t / (dur / 5)) * attack(t) * gain
      }
    }
    let rim = render(0.05) { t in (sin(2 * .pi * 1700 * t) * 0.6 + noise() * 0.3) * exp(-t / 0.008) * attack(t) * 0.7 }
    return [kick, snare(0.8), snare(0.18), hat(0.05, 0.16), hat(0.06, 0.3), hat(0.35, 0.22), click(1320, 0.6), click(1760, 0.95),
            tom(210, 0.5), tom(160, 0.55), tom(105, 0.7), cymbal(0.9, 0.16, 0.25), cymbal(1.8, 0.3, 0.0), hat(0.04, 0.12), rim]
  }

  /// Convert a time in seconds since boot (UITouch / React Native touch timestamps) to engine seconds.
  func uptimeToEngine(_ uptime: Double) -> Double {
    return hostToEngine(UInt64(max(0, uptime) / hostToSeconds))
  }

  // MARK: - Render (audio thread)

  private func render(timestamp: UnsafePointer<AudioTimeStamp>, frames n: Int, bufferList: UnsafeMutablePointer<AudioBufferList>) {
    let buffers = UnsafeMutableAudioBufferListPointer(bufferList)
    os_unfair_lock_lock(lock)
    let start = rendered
    mapFrame = start
    mapHost = timestamp.pointee.mFlags.contains(.hostTimeValid) ? timestamp.pointee.mHostTime : mach_absolute_time()

    // move clicks that start in this buffer to the active voices
    let end = start + Int64(n)
    var i = 0
    while i < pending.count {
      let e = pending[i]
      if e.frame < end {
        voices.append((buf: e.buf, pos: -Int(max(0, e.frame - start)), gain: e.gain))
        pending.swapAt(i, pending.count - 1)
        pending.removeLast()
      } else {
        i += 1
      }
    }

    for b in buffers {
      guard let data = b.mData?.assumingMemoryBound(to: Float.self) else { continue }
      for f in 0..<n { data[f] = 0 }
    }
    if !voices.isEmpty, let first = buffers.first?.mData?.assumingMemoryBound(to: Float.self) {
      for v in 0..<voices.count {
        let samples = clicks[voices[v].buf]
        let pos = voices[v].pos
        let gain = voices[v].gain
        for f in 0..<n {
          let p = pos + f
          if p >= 0 && p < samples.count { first[f] += samples[p] * gain }
        }
        voices[v].pos = pos + n
      }
      voices.removeAll { $0.pos >= clicks[$0.buf].count }
      for f in 0..<n { first[f] = max(-1, min(1, first[f])) }
      for b in buffers.dropFirst() {
        guard let data = b.mData?.assumingMemoryBound(to: Float.self) else { continue }
        for f in 0..<n { data[f] = first[f] }
      }
    }
    rendered = end
    os_unfair_lock_unlock(lock)
  }

  // MARK: - Microphone (tap thread)

  private func processMic(buffer: AVAudioPCMBuffer, when: AVAudioTime) {
    guard let ch = buffer.floatChannelData?[0] else { return }
    let n = Int(buffer.frameLength)
    let sr = buffer.format.sampleRate
    let host = when.isHostTimeValid ? when.hostTime : mach_absolute_time()
    let inputLatency = AVAudioSession.sharedInstance().inputLatency
    os_unfair_lock_lock(recLock)
    if recording {
      if recBuf.isEmpty {
        recStart = hostToEngine(host) - inputLatency
        recRate = sr
      }
      if Double(recBuf.count) < recMaxSeconds * sr {
        recBuf.append(contentsOf: UnsafeBufferPointer(start: ch, count: n))
      }
    }
    os_unfair_lock_unlock(recLock)
    for i in 0..<n {
      let a = abs(ch[i])
      if a > micPeak { micPeak = a }
      if micHold > 0 {
        micHold -= 1
      } else if a > micThreshold && a > micFloor * 8 {
        let t = hostToEngine(host) + Double(i) / sr - inputLatency
        emit?("onCaptureHit", ["time": t, "peak": Double(a)])
        micHold = Int(sr * 0.08)
      }
      micFloor += (a - micFloor) * 0.0004
    }
    micLevelCounter += n
    if Double(micLevelCounter) > sr * 0.1 {
      emit?("onMicLevel", ["level": Double(micPeak)])
      micPeak = 0
      micLevelCounter = 0
    }
  }

  /// Start keeping the raw microphone signal (for voice-to-notes). The mic must be on (start with mic: true).
  func startRecording() -> Bool {
    os_unfair_lock_lock(recLock)
    recBuf.removeAll(keepingCapacity: true)
    recBuf.reserveCapacity(Int(sampleRate * 30))
    recording = micOn
    os_unfair_lock_unlock(recLock)
    return micOn
  }

  /// Stop and write the recording as raw 32-bit float mono samples to a temporary file.
  /// Returns the file path, sample rate, engine time of the first sample and the number of samples.
  func stopRecording() -> [String: Any] {
    os_unfair_lock_lock(recLock)
    recording = false
    let buf = recBuf
    let start = recStart
    let rate = recRate
    recBuf.removeAll()
    os_unfair_lock_unlock(recLock)
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("ghostgrid-voice.f32")
    let data = buf.withUnsafeBufferPointer { Data(buffer: $0) }
    try? data.write(to: url)
    return ["path": url.absoluteString, "sampleRate": rate, "startTime": start, "frames": buf.count]
  }

  static func requestMicPermission(_ done: @escaping (Bool) -> Void) {
    if #available(iOS 17.0, *) {
      AVAudioApplication.requestRecordPermission { done($0) }
    } else {
      AVAudioSession.sharedInstance().requestRecordPermission { done($0) }
    }
  }

  // MARK: - MIDI (CoreMIDI, USB and Bluetooth LE)

  func setupMidi() {
    guard client == 0 else { return }
    MIDIClientCreateWithBlock("Ghostgrid" as CFString, &client) { [weak self] note in
      if note.pointee.messageID == .msgSetupChanged {
        DispatchQueue.main.async { self?.connectSources() }
      }
    }
    MIDIInputPortCreateWithBlock(client, "Ghostgrid In" as CFString, &inPort) { [weak self] list, srcRef in
      self?.handle(list: list, srcRef: srcRef)
    }
    connectSources()
  }

  private func connectSources() {
    for src in connected { MIDIPortDisconnectSource(inPort, src) }
    connected.removeAll()
    var names: [String] = []
    for i in 0..<MIDIGetNumberOfSources() {
      let src = MIDIGetSource(i)
      names.append(Self.displayName(src))
      MIDIPortConnectSource(inPort, src, UnsafeMutableRawPointer(bitPattern: Int(i) + 1))
      connected.append(src)
    }
    sourceNames = names
    emit?("onMidiSources", ["sources": names])
  }

  private static func displayName(_ obj: MIDIObjectRef) -> String {
    var str: Unmanaged<CFString>?
    MIDIObjectGetStringProperty(obj, kMIDIPropertyDisplayName, &str)
    return (str?.takeRetainedValue() as String?) ?? "MIDI device"
  }

  private func handle(list: UnsafePointer<MIDIPacketList>, srcRef: UnsafeMutableRawPointer?) {
    let index = srcRef.map { Int(bitPattern: $0) - 1 } ?? -1
    let source = index >= 0 && index < sourceNames.count ? sourceNames[index] : "MIDI"
    let mutable = UnsafeMutablePointer(mutating: list)
    let count = Int(mutable.pointee.numPackets)
    withUnsafeMutablePointer(to: &mutable.pointee.packet) { first in
      var p = first
      for _ in 0..<count {
        let len = min(Int(p.pointee.length), 256)
        let host = p.pointee.timeStamp == 0 ? mach_absolute_time() : p.pointee.timeStamp
        withUnsafeBytes(of: &p.pointee.data) { raw in
          parse(raw, len, host, source)
        }
        p = MIDIPacketNext(p)
      }
    }
  }

  private func parse(_ raw: UnsafeRawBufferPointer, _ len: Int, _ host: UInt64, _ source: String) {
    var i = 0
    var status: UInt8 = 0
    while i < len {
      let b = raw[i]
      if b >= 0xF8 { i += 1; continue }                    // real-time bytes
      if b & 0x80 != 0 { status = b >= 0xF0 ? 0 : b; i += 1; continue }
      let kind = status & 0xF0
      if kind == 0x90 || kind == 0x80 {
        guard i + 1 < len else { break }
        let note = Int(raw[i]), vel = Int(raw[i + 1])
        i += 2
        if kind == 0x90 && vel > 0 {
          emit?("onPadHit", [
            "time": hostToEngine(host),
            "note": note,
            "velocity": vel,
            "channel": Int(status & 0x0F),
            "source": source,
          ])
        }
      } else if kind == 0xB0 {
        guard i + 1 < len else { break }
        let cc = Int(raw[i]), value = Int(raw[i + 1])
        i += 2
        emit?("onControl", [
          "time": hostToEngine(host),
          "cc": cc,
          "value": value,
          "channel": Int(status & 0x0F),
          "source": source,
        ])
      } else if kind == 0xC0 || kind == 0xD0 {
        i += 1
      } else if status != 0 {
        i += 2
      } else {
        i += 1
      }
    }
  }
}
