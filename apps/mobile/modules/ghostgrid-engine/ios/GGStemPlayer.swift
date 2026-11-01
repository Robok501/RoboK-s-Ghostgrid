import AVFoundation
import Foundation

/// Practice player for separated songs: two time-aligned stems (drums, everything else) with their own volume,
/// slow-down without pitch change (AVAudioUnitTimePitch) and an A–B loop.
/// Runs its own AVAudioEngine next to the click engine; both share the app's audio session.
final class GGStemPlayer {
  private let engine = AVAudioEngine()
  private let drums = AVAudioPlayerNode()
  private let rest = AVAudioPlayerNode()
  private let pitch = AVAudioUnitTimePitch()
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
    engine.attach(pitch)
  }

  /// Load a song: `restPath` alone (not yet separated) or both stems. Returns the duration in seconds.
  func load(drumsPath: String?, restPath: String) throws -> Double {
    stop()
    let rf = try AVAudioFile(forReading: URL(fileURLWithPath: restPath))
    let df = try drumsPath.map { try AVAudioFile(forReading: URL(fileURLWithPath: $0)) }
    let fmt = rf.processingFormat
    engine.disconnectNodeOutput(drums)
    engine.disconnectNodeOutput(rest)
    engine.disconnectNodeOutput(pitch)
    engine.connect(rest, to: pitch, format: fmt)
    if let df = df { engine.connect(drums, to: pitch, format: df.processingFormat) }
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

  func play() throws {
    guard restFile != nil else { return }
    if !engine.isRunning { try engine.start() }
    schedule(from: startFrame)
    if drumsFile != nil { drums.play() }
    rest.play()
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
    playing = false
  }

  func seek(_ seconds: Double) throws {
    let was = playing
    stop()
    startFrame = max(0, min(length - 1, AVAudioFramePosition(seconds * rate)))
    if was { try play() }
  }

  func setVolumes(drums d: Double, rest r: Double) {
    drums.volume = Float(d)
    rest.volume = Float(r)
  }

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
    if let df = drumsFile {
      drums.scheduleSegment(df, startingFrame: a, frameCount: count, at: nil)
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
