import AVFoundation
import Foundation

/// Practice player for separated songs: two time-aligned stems (drums, everything else) with their own volume,
/// slow-down without pitch change (AVAudioUnitTimePitch) and an A–B loop.
/// Runs its own AVAudioEngine next to the click engine; both share the app's audio session.
final class GGStemPlayer {
  private let engine = AVAudioEngine()
  private let drums = AVAudioPlayerNode()
  private let rest = AVAudioPlayerNode()
  /// click track rendered on the song's beats: plays through the same time-stretch, so it stays with the music
  private let click = AVAudioPlayerNode()
  private var clickFile: AVAudioFile?
  private let pitch = AVAudioUnitTimePitch()
  /// both stems meet here first: the time-pitch unit has only one input, so connecting two players to it
  /// silently dropped the first one (and starting a disconnected player crashed the app)
  private let submix = AVAudioMixerNode()
  private var drumsFile: AVAudioFile?
  private var restFile: AVAudioFile?
  private var length: AVAudioFramePosition = 0
  private var rate: Double = 44_100
  /// file frame where the current schedule started
  private var startFrame: AVAudioFramePosition = 0
  private var playing = false
  private var loopA: AVAudioFramePosition = 0
  private var loopB: AVAudioFramePosition = 0
  private var looping = false
  private var generation = 0
  private var queued = 0
  private let q = DispatchQueue(label: "ghostgrid.stems")

  init() {
    engine.attach(drums)
    engine.attach(rest)
    engine.attach(click)
    engine.attach(pitch)
    engine.attach(submix)
  }

  /// Load a song: `restPath` alone (not yet separated) or both stems. Returns the duration in seconds.
  func load(drumsPath: String?, restPath: String) throws -> Double {
    stop()
    let rf = try AVAudioFile(forReading: URL(fileURLWithPath: restPath))
    let df = try drumsPath.map { try AVAudioFile(forReading: URL(fileURLWithPath: $0)) }
    let fmt = rf.processingFormat
    engine.disconnectNodeOutput(drums)
    engine.disconnectNodeOutput(rest)
    engine.disconnectNodeOutput(click)
    clickFile = nil
    engine.disconnectNodeOutput(pitch)
    engine.disconnectNodeOutput(submix)
    engine.connect(rest, to: submix, fromBus: 0, toBus: 0, format: fmt)
    if let df = df { engine.connect(drums, to: submix, fromBus: 0, toBus: 1, format: df.processingFormat) }
    engine.connect(submix, to: pitch, format: fmt)
    engine.connect(pitch, to: engine.mainMixerNode, format: fmt)
    restFile = rf
    drumsFile = df
    length = rf.length
    rate = fmt.sampleRate
    startFrame = 0
    loopA = 0
    loopB = length
    looping = false
    engine.prepare()
    return Double(length) / rate
  }

  /// Attach (or remove, with nil) the click track. Keeps playing from the same place.
  func setClick(path: String?) throws {
    let was = playing
    let p = position()
    stop()
    engine.disconnectNodeOutput(click)
    clickFile = nil
    if let path = path {
      let cf = try AVAudioFile(forReading: URL(fileURLWithPath: path))
      engine.connect(click, to: submix, fromBus: 0, toBus: 2, format: cf.processingFormat)
      clickFile = cf
    }
    startFrame = AVAudioFramePosition(p * rate)
    if was { try play() }
  }

  func unload() {
    stop()
    drumsFile = nil
    restFile = nil
    length = 0
    if engine.isRunning { engine.stop() }
  }

  /// Seconds into the song.
  func position() -> Double {
    guard playing, let t = rest.lastRenderTime, let pt = rest.playerTime(forNodeTime: t) else {
      return Double(startFrame) / rate
    }
    var f = startFrame + pt.sampleTime
    if looping && loopB > loopA && f >= loopB {
      // inside the loop: fold the played frames back into A..B
      let span = loopB - loopA
      f = loopA + (f - loopB) % span
    }
    return Double(min(max(0, f), length)) / rate
  }

  func play(atHost host: UInt64? = nil) throws {
    guard restFile != nil else { return }
    if !engine.isRunning { try engine.start() }
    // never start a player that isn't wired up: AVFoundation raises an exception that closes the app
    let wired = { (n: AVAudioNode) in !self.engine.outputConnectionPoints(for: n, outputBus: 0).isEmpty }
    guard wired(rest) else { throw NSError(domain: "Ghostgrid", code: 40, userInfo: [NSLocalizedDescriptionKey: "Player not ready"]) }
    schedule(from: startFrame)
    let when = host.map { AVAudioTime(hostTime: $0) }
    if drumsFile != nil && wired(drums) { drums.play(at: when) }
    if clickFile != nil && wired(click) { click.play(at: when) }
    rest.play(at: when)
    playing = true
  }

  func isPlaying() -> Bool { playing }

  func pause() {
    let p = position()
    stop()
    startFrame = AVAudioFramePosition(p * rate)
  }

  private func stop() {
    generation += 1
    drums.stop()
    rest.stop()
    click.stop()
    playing = false
  }

  /// Song position (seconds) that is playing at host time `host`; nil when not playing.
  func songTime(atHost host: UInt64, hostToSeconds: Double) -> Double? {
    guard playing, let t = rest.lastRenderTime, t.isHostTimeValid, let pt = rest.playerTime(forNodeTime: t) else { return nil }
    let dt = (Double(host) - Double(t.hostTime)) * hostToSeconds
    var f = Double(startFrame + pt.sampleTime) + dt * rate * Double(pitch.rate)
    if looping && loopB > loopA && f >= Double(loopB) {
      let span = Double(loopB - loopA)
      f = Double(loopA) + (f - Double(loopB)).truncatingRemainder(dividingBy: span)
    }
    return f / rate
  }

  func seek(_ seconds: Double) throws {
    let was = playing
    stop()
    startFrame = max(0, min(length - 1, AVAudioFramePosition(seconds * rate)))
    if was { try play() }
  }

  func setVolumes(drums d: Double, rest r: Double, click c: Double) {
    drums.volume = Float(d)
    rest.volume = Float(r)
    click.volume = Float(c)
  }

  var playbackRate: Double { Double(pitch.rate) }

  /// 0.5 … 1.25; pitch stays the same.
  func setRate(_ r: Double) {
    pitch.rate = Float(max(0.25, min(2, r)))
  }

  func setLoop(a: Double, b: Double, on: Bool) throws {
    loopA = max(0, AVAudioFramePosition(a * rate))
    loopB = min(length, AVAudioFramePosition(b * rate))
    let was = playing
    let p = position()
    looping = on && loopB - loopA > AVAudioFramePosition(rate * 0.2)
    if was {
      stop()
      var f = AVAudioFramePosition(p * rate)
      if looping && (f < loopA || f >= loopB) { f = loopA }
      startFrame = f
      try play()
    }
  }

  // MARK: - scheduling

  /// Schedule from `frame` to the loop end (or song end); with a loop on, keep two loop passes queued.
  private func schedule(from frame: AVAudioFramePosition) {
    let gen = generation
    let end = looping ? loopB : length
    let first = max(0, min(frame, end - 1))
    startFrame = first
    queued = 0
    enqueue(from: first, to: end, gen: gen)
    if looping {
      enqueue(from: loopA, to: loopB, gen: gen)
    }
  }

  private func enqueue(from a: AVAudioFramePosition, to b: AVAudioFramePosition, gen: Int) {
    guard let rf = restFile, b > a else { return }
    let count = AVAudioFrameCount(b - a)
    queued += 1
    if let df = drumsFile, !engine.outputConnectionPoints(for: drums, outputBus: 0).isEmpty {
      drums.scheduleSegment(df, startingFrame: a, frameCount: count, at: nil)
    }
    if let cf = clickFile, !engine.outputConnectionPoints(for: click, outputBus: 0).isEmpty, a < cf.length {
      click.scheduleSegment(cf, startingFrame: a, frameCount: AVAudioFrameCount(min(b, cf.length) - a), at: nil)
    }
    rest.scheduleSegment(rf, startingFrame: a, frameCount: count, at: nil, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      guard let self = self else { return }
      self.q.async {
        guard gen == self.generation else { return }
        self.queued -= 1
        if self.looping {
          self.enqueue(from: self.loopA, to: self.loopB, gen: gen)
        } else if self.queued <= 0 {
          self.playing = false
          self.startFrame = 0
        }
      }
    }
  }
}
