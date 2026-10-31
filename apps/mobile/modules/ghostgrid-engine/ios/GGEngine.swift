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
  private var sourceNode: AVAudioSourceNode?
  private var sampleRate: Double = 48_000
  private var rendered: Int64 = 0
  private var mapFrame: Int64 = 0
  private var mapHost: UInt64 = 0
  private var pending: [(frame: Int64, buf: Int)] = []
  private var voices: [(buf: Int, pos: Int)] = []
  private var clicks: [[Float]] = []
  private let hostToSeconds: Double = {
    var tb = mach_timebase_info_data_t()
    mach_timebase_info(&tb)
    return Double(tb.numer) / Double(tb.denom) / 1e9
  }()

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
  }

  deinit {
    lock.deinitialize(count: 1)
    lock.deallocate()
  }

  // MARK: - Engine

  func start(keepBluetoothOutput: Bool, mic: Bool, sensitivity: Double) throws -> [String: Any] {
    stop()
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
        micThreshold = Float(0.5 * pow(0.6, sensitivity - 1))
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
    if frame >= rendered { pending.append((frame, buf)) }
    os_unfair_lock_unlock(lock)
  }

  func cancelAfter(time: Double) {
    let frame = Int64(time * sampleRate)
    os_unfair_lock_lock(lock)
    pending.removeAll { $0.frame > frame }
    os_unfair_lock_unlock(lock)
  }

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

  private func makeClicks() {
    func burst(_ freq: Double, _ gain: Float, _ dur: Double) -> [Float] {
      let n = Int(sampleRate * dur)
      return (0..<n).map { i in
        let t = Double(i) / sampleRate
        let env = Float(min(1, t / 0.0015) * exp(-t / (dur / 5)))
        return Float(sin(2 * Double.pi * freq * t)) * env * gain
      }
    }
    // index 0 = soft (subdivision), 1 = normal, 2 = accent
    clicks = [burst(990, 0.28, 0.035), burst(1320, 0.6, 0.04), burst(1760, 0.95, 0.045)]
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
        voices.append((buf: e.buf, pos: -Int(max(0, e.frame - start))))
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
        for f in 0..<n {
          let p = pos + f
          if p >= 0 && p < samples.count { first[f] += samples[p] }
        }
        voices[v].pos = pos + n
      }
      voices.removeAll { $0.pos >= clicks[$0.buf].count }
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
    for i in 0..<n {
      let a = abs(ch[i])
      if a > micPeak { micPeak = a }
      if micHold > 0 {
        micHold -= 1
      } else if a > micThreshold && a > micFloor * 6 {
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
