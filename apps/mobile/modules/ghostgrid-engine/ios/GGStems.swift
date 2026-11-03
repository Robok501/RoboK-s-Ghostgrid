import Accelerate
import AVFoundation
import Foundation
import os
import onnxruntime_objc

/// On-device stem separation for practice: the drums are separated with an HT-Demucs drums model (ONNX),
/// and "the song without drums" is the song minus those drums. Everything stays on the phone.
///
/// The model works on 7.8 s stereo segments at 44.1 kHz. Long songs are cut into overlapping segments
/// (25 % overlap, triangular cross-fade), as in Demucs' own `apply_model`.
final class GGStems: NSObject, URLSessionDownloadDelegate {
  var emit: ((String, [String: Any?]) -> Void)?

  static let sampleRate = 44_100.0
  static let segment = 343_980
  private var cancelled = false
  private var downloadDone: ((Result<URL, Error>) -> Void)?
  private var downloadTask: URLSessionDownloadTask?

  // MARK: - Model file

  static var modelDir: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return base.appendingPathComponent("models", isDirectory: true)
  }
  /// A model that ships inside the app (Models/ in this module, copied in by the build) wins over a downloaded one.
  static func modelURL(_ name: String) -> URL {
    let ns = name as NSString
    if let bundled = Bundle.main.url(forResource: ns.deletingPathExtension, withExtension: ns.pathExtension) { return bundled }
    return modelDir.appendingPathComponent(name)
  }

  func modelStatus(_ name: String) -> [String: Any] {
    let url = Self.modelURL(name)
    let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? 0
    return ["present": size > 1_000_000, "bytes": size, "path": url.path]
  }

  func deleteModel(_ name: String) {
    try? FileManager.default.removeItem(at: Self.modelDir.appendingPathComponent(name))
  }

  /// Download the model once (resumes from scratch if interrupted). Progress arrives as onStemsProgress {phase: "download"}.
  func downloadModel(from urlString: String, name: String, done: @escaping (Result<URL, Error>) -> Void) {
    guard let url = URL(string: urlString) else {
      done(.failure(NSError(domain: "Ghostgrid", code: 10, userInfo: [NSLocalizedDescriptionKey: "Bad model URL"])))
      return
    }
    try? FileManager.default.createDirectory(at: Self.modelDir, withIntermediateDirectories: true)
    pendingName = name
    downloadDone = done
    let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    let task = session.downloadTask(with: url)
    downloadTask = task
    task.resume()
  }

  func cancelDownload() { downloadTask?.cancel() }

  private var pendingName = ""

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                  totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
    let p = totalBytesExpectedToWrite > 0 ? Double(totalBytesWritten) / Double(totalBytesExpectedToWrite) : 0
    emit?("onStemsProgress", ["phase": "download", "progress": p, "bytes": Double(totalBytesWritten)])
  }

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    let dest = Self.modelDir.appendingPathComponent(pendingName)
    do {
      if let http = downloadTask.response as? HTTPURLResponse, http.statusCode >= 400 {
        throw NSError(domain: "Ghostgrid", code: 11, userInfo: [NSLocalizedDescriptionKey: "Download failed (HTTP \(http.statusCode))"])
      }
      try? FileManager.default.removeItem(at: dest)
      try FileManager.default.moveItem(at: location, to: dest)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      var d = dest
      try? d.setResourceValues(values)
      downloadDone?(.success(dest))
    } catch {
      downloadDone?(.failure(error))
    }
    downloadDone = nil
    session.finishTasksAndInvalidate()
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error = error {
      downloadDone?(.failure(error))
      downloadDone = nil
    }
    session.finishTasksAndInvalidate()
  }

  // MARK: - Audio in and out

  /// Read any audio file iOS can decode as 44.1 kHz stereo float (mono is duplicated).
  static func readStereo(_ url: URL, maxSeconds: Double = 900) throws -> (l: [Float], r: [Float]) {
    let file = try AVAudioFile(forReading: url)
    guard let out = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 2, interleaved: false),
          let conv = AVAudioConverter(from: file.processingFormat, to: out) else {
      throw NSError(domain: "Ghostgrid", code: 20, userInfo: [NSLocalizedDescriptionKey: "Unsupported audio format"])
    }
    if file.processingFormat.channelCount == 1 { conv.channelMap = [0, 0] }
    var l: [Float] = [], r: [Float] = []
    let expected = Int(Double(file.length) * sampleRate / file.processingFormat.sampleRate)
    l.reserveCapacity(expected); r.reserveCapacity(expected)
    let inCap: AVAudioFrameCount = 16_384
    guard let inBuf = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: inCap),
          let outBuf = AVAudioPCMBuffer(pcmFormat: out, frameCapacity: AVAudioFrameCount(Double(inCap) * sampleRate / file.processingFormat.sampleRate) + 1024) else {
      throw NSError(domain: "Ghostgrid", code: 21, userInfo: [NSLocalizedDescriptionKey: "Out of memory"])
    }
    var ended = false
    while true {
      var err: NSError?
      let status = conv.convert(to: outBuf, error: &err) { _, outStatus in
        if ended { outStatus.pointee = .endOfStream; return nil }
        do {
          try file.read(into: inBuf, frameCount: inCap)
        } catch {
          ended = true; outStatus.pointee = .endOfStream; return nil
        }
        if inBuf.frameLength == 0 { ended = true; outStatus.pointee = .endOfStream; return nil }
        outStatus.pointee = .haveData
        return inBuf
      }
      if let err = err { throw err }
      let n = Int(outBuf.frameLength)
      if n > 0, let ch = outBuf.floatChannelData {
        l.append(contentsOf: UnsafeBufferPointer(start: ch[0], count: n))
        r.append(contentsOf: UnsafeBufferPointer(start: ch[1], count: n))
      }
      if status == .endOfStream || status == .error || (n == 0 && ended) { break }
      if Double(l.count) > maxSeconds * sampleRate { break }
    }
    return (l, r)
  }

  static func writeStereo(_ url: URL, _ l: [Float], _ r: [Float]) throws {
    guard let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 2, interleaved: false) else { return }
    try? FileManager.default.removeItem(at: url)
    let file = try AVAudioFile(forWriting: url, settings: fmt.settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    let chunk = 65_536
    var i = 0
    while i < l.count {
      let n = min(chunk, l.count - i)
      guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(n)), let ch = buf.floatChannelData else { break }
      l.withUnsafeBufferPointer { src in ch[0].update(from: src.baseAddress! + i, count: n) }
      r.withUnsafeBufferPointer { src in ch[1].update(from: src.baseAddress! + i, count: n) }
      buf.frameLength = AVAudioFrameCount(n)
      try file.write(from: buf)
      i += n
    }
  }

  // MARK: - Analysis helpers for the beat map and click

  /// Loudness envelopes at 100 frames per second: whole signal, low end (kick), mid band (snare, toms), high band (cymbals).
  static func envelope(_ url: URL) throws -> [String: Any] {
    let file = try AVAudioFile(forReading: url)
    let fmt = file.processingFormat
    let sr = fmt.sampleRate, hop = Int((sr / 100).rounded()), chans = Int(fmt.channelCount)
    guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(hop * 200)) else { return [:] }
    // one-pole low-pass coefficient for a corner frequency; two in a row give 12 dB/octave
    let co = { (f: Double) in Float(1 - exp(-2 * Double.pi * f / sr)) }
    let a = co(150), aM1 = co(200), aM2 = co(2500), aH = co(7000)
    var lp: Float = 0, accF: Float = 0, accL: Float = 0, accM: Float = 0, accH: Float = 0, k = 0
    // mid band (snare, toms: ~200 Hz – 2.5 kHz) and high band (hi-hat, cymbals: above ~7 kHz)
    var m1a: Float = 0, m1b: Float = 0, m2a: Float = 0, m2b: Float = 0, h1: Float = 0, h2: Float = 0
    var full: [Double] = [], low: [Double] = [], mid: [Double] = [], high: [Double] = []
    while file.framePosition < file.length {
      try file.read(into: buf, frameCount: buf.frameCapacity)
      let n = Int(buf.frameLength)
      if n == 0 { break }
      guard let ch = buf.floatChannelData else { break }
      for i in 0..<n {
        var x: Float = 0
        for c in 0..<chans { x += ch[c][i] }
        x /= Float(chans)
        lp += a * (x - lp)
        m1a += aM1 * (x - m1a); m1b += aM1 * (m1a - m1b)
        m2a += aM2 * (x - m2a); m2b += aM2 * (m2a - m2b)
        h1 += aH * (x - h1); h2 += aH * (h1 - h2)
        let md = m2b - m1b, hi = x - h2
        accF += x * x; accL += lp * lp; accM += md * md; accH += hi * hi; k += 1
        if k == hop {
          let h = Float(hop)
          full.append(Double(sqrt(accF / h))); low.append(Double(sqrt(accL / h)))
          mid.append(Double(sqrt(accM / h))); high.append(Double(sqrt(accH / h)))
          accF = 0; accL = 0; accM = 0; accH = 0; k = 0
        }
      }
    }
    return ["rate": 100.0, "full": full, "low": low, "mid": mid, "high": high]
  }

  /// Features of the music (the track without drums) at 10 frames per second, for finding the "1":
  /// 12 pitch-class energies per frame (chords) and the bass energy (40–150 Hz).
  static func musicFeatures(_ url: URL) throws -> [String: Any] {
    let file = try AVAudioFile(forReading: url)
    let fmt = file.processingFormat
    let sr = fmt.sampleRate, chans = Int(fmt.channelCount)
    let N = 4096, hop = Int(sr / 10)
    guard let dft = vDSP.DFT(count: N, direction: .forward, transformType: .complexComplex, ofType: Float.self),
          let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: 65_536) else { return [:] }
    // mono samples of the whole song
    var mono: [Float] = []
    mono.reserveCapacity(Int(file.length))
    while file.framePosition < file.length {
      try file.read(into: buf, frameCount: 65_536)
      let n = Int(buf.frameLength)
      if n == 0 { break }
      guard let ch = buf.floatChannelData else { break }
      for i in 0..<n {
        var x: Float = 0
        for c in 0..<chans { x += ch[c][i] }
        mono.append(x / Float(chans))
      }
    }
    let window = (0..<N).map { Float(0.5 - 0.5 * cos(2 * Double.pi * Double($0) / Double(N - 1))) }
    // which pitch class each FFT bin belongs to (55 Hz – 2 kHz), and which bins are bass
    var pc = [Int](repeating: -1, count: N / 2), isBass = [Bool](repeating: false, count: N / 2)
    for k in 1..<(N / 2) {
      let f = Double(k) * sr / Double(N)
      if f >= 55 && f <= 2000 {
        let midi = 69 + 12 * log2(f / 440)
        pc[k] = ((Int(midi.rounded()) % 12) + 12) % 12
      }
      isBass[k] = f >= 40 && f <= 150
    }
    var chroma: [Double] = [], bass: [Double] = []
    var re = [Float](repeating: 0, count: N), im = [Float](repeating: 0, count: N)
    var oRe = [Float](repeating: 0, count: N), oIm = [Float](repeating: 0, count: N)
    var start = 0
    while start + N <= mono.count {
      for i in 0..<N { re[i] = mono[start + i] * window[i]; im[i] = 0 }
      dft.transform(inputReal: re, inputImaginary: im, outputReal: &oRe, outputImaginary: &oIm)
      var c = [Double](repeating: 0, count: 12)
      var b: Double = 0
      for k in 1..<(N / 2) {
        let m = Double(oRe[k] * oRe[k] + oIm[k] * oIm[k])
        if pc[k] >= 0 { c[pc[k]] += sqrt(m) }
        if isBass[k] { b += m }
      }
      chroma.append(contentsOf: c)
      bass.append(sqrt(b))
      start += hop
    }
    return ["rate": 10.0, "chroma": chroma, "bass": bass]
  }

  /// Write a click track (44.1 kHz stereo) as long as the song, with a click at each time; accents are higher and louder.
  static func writeClick(_ url: URL, seconds: Double, times: [Double], accents: [Bool]) throws {
    guard let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 2, interleaved: false) else { return }
    let clickLen = Int(sampleRate * 0.045)
    func render(_ f: Double, _ gain: Double) -> [Float] {
      (0..<clickLen).map { i in
        let t = Double(i) / sampleRate
        return Float(sin(2 * .pi * f * t) * min(1, t / 0.0015) * exp(-t / 0.009) * gain)
      }
    }
    let normal = render(1320, 0.6), accent = render(1760, 0.95)
    try? FileManager.default.removeItem(at: url)
    let file = try AVAudioFile(forWriting: url, settings: fmt.settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    let total = Int(seconds * sampleRate), chunk = 65_536
    let starts = times.map { Int(($0 * sampleRate).rounded()) }
    var next = 0
    var pos = 0
    while pos < total {
      let n = min(chunk, total - pos)
      guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(n)), let ch = buf.floatChannelData else { break }
      buf.frameLength = AVAudioFrameCount(n)
      for c in 0..<2 { for i in 0..<n { ch[c][i] = 0 } }
      // clicks that start before this chunk can still ring into it
      while next < starts.count && starts[next] + clickLen < pos { next += 1 }
      var j = next
      while j < starts.count && starts[j] < pos + n {
        let src = accents.count > j && accents[j] ? accent : normal
        for i in 0..<clickLen {
          let p = starts[j] + i - pos
          if p >= 0 && p < n { ch[0][p] += src[i]; ch[1][p] += src[i] }
        }
        j += 1
      }
      try file.write(from: buf)
      pos += n
    }
  }

  // MARK: - Separation

  func cancel() { cancelled = true }

  // MARK: - Breadcrumbs: if iOS kills the app (usually for memory), the next start can say where it stopped.

  static var logURL: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    return base.appendingPathComponent("stems-last-run.json")
  }
  static func freeMB() -> Double { Double(os_proc_available_memory()) / 1_048_576 }

  private func mark(_ phase: String, _ extra: [String: Any] = [:]) {
    var info: [String: Any] = ["phase": phase, "time": Date().timeIntervalSince1970, "freeMB": Self.freeMB()]
    for (k, v) in extra { info[k] = v }
    if let data = try? JSONSerialization.data(withJSONObject: info) { try? data.write(to: Self.logURL, options: .atomic) }
  }

  func lastRun() -> [String: Any] {
    guard let data = try? Data(contentsOf: Self.logURL),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
    return obj
  }

  /// Separate `input` into drums.caf and nodrums.caf in `outDir`. Returns the duration in seconds.
  func separate(input: URL, outDir: URL, modelName: String) throws -> [String: Any] {
    cancelled = false
    let modelPath = Self.modelURL(modelName).path
    guard FileManager.default.fileExists(atPath: modelPath) else {
      throw NSError(domain: "Ghostgrid", code: 30, userInfo: [NSLocalizedDescriptionKey: "The separation model isn't downloaded yet"])
    }
    mark("decode")
    emit?("onStemsProgress", ["phase": "decode", "progress": 0.0])
    var (l, r) = try Self.readStereo(input)
    let n = l.count
    if n < Int(Self.sampleRate) { throw NSError(domain: "Ghostgrid", code: 31, userInfo: [NSLocalizedDescriptionKey: "That recording is too short"]) }

    // normalise like Demucs: by the mean and spread of the mono mix
    var mean: Double = 0
    for i in 0..<n { mean += Double(l[i] + r[i]) * 0.5 }
    mean /= Double(n)
    var varSum: Double = 0
    for i in 0..<n { let m = Double(l[i] + r[i]) * 0.5 - mean; varSum += m * m }
    let std = max(1e-5, sqrt(varSum / Double(n)))
    let fm = Float(mean), fs = Float(std)

    // The model needs roughly its own size again while loading. Refuse politely instead of being killed by iOS.
    let needMB = 900.0
    if Self.freeMB() < needMB {
      mark("error", ["message": "not enough memory", "freeMB": Self.freeMB()])
      throw NSError(domain: "Ghostgrid", code: 34, userInfo: [NSLocalizedDescriptionKey:
        "Not enough free memory (\(Int(Self.freeMB())) MB, needs about \(Int(needMB)) MB). Close other apps and try again."])
    }
    mark("load", ["seconds": Double(n) / Self.sampleRate])
    emit?("onStemsProgress", ["phase": "load", "progress": 0.0])
    let env = try ORTEnv(loggingLevel: .warning)
    let opts = try ORTSessionOptions()
    try opts.setIntraOpNumThreads(Int32(max(2, min(4, ProcessInfo.processInfo.activeProcessorCount))))
    // keep memory down on a phone: no pre-packed copies of the weights, weights outside the arena, basic graph fusions only
    // no graph rewriting at all: on the phone, optimising this model's graph took the app past its 4 GB limit
    try opts.setGraphOptimizationLevel(.none)
    try opts.addConfigEntry(withKey: "session.disable_prepacking", value: "1")
    try opts.addConfigEntry(withKey: "session.use_device_allocator_for_initializers", value: "1")
    // while the model loads (one long call), note the lowest free memory every 0.2 s, so a kill can be traced
    let startFree = Self.freeMB()
    var lowest = startFree
    let watch = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
    watch.schedule(deadline: .now(), repeating: 0.2)
    watch.setEventHandler { [weak self] in
      let f = Self.freeMB()
      if f < lowest { lowest = f; self?.mark("load", ["freeMB": startFree, "lowestFreeMB": f, "usedByLoadMB": startFree - f]) }
    }
    watch.resume()
    let session: ORTSession
    do {
      session = try ORTSession(env: env, modelPath: modelPath, sessionOptions: opts)
      watch.cancel()
    } catch {
      watch.cancel()
      throw error
    }
    mark("separate", ["freeAfterLoadMB": Self.freeMB(), "usedByLoadMB": startFree - lowest])
    let inName = try session.inputNames().first ?? "mix"
    let outName = try session.outputNames().first ?? "stems"

    let L = Self.segment, stride = L * 3 / 4
    // triangular weights for the overlap-add
    var w = [Float](repeating: 0, count: L)
    for i in 0..<L { w[i] = Float(min(i + 1, L - i)) }
    var dl = [Float](repeating: 0, count: n), dr = [Float](repeating: 0, count: n), ws = [Float](repeating: 0, count: n)
    let starts = stride >= n ? [0] : Array(Swift.stride(from: 0, to: n, by: stride))
    let input = NSMutableData(length: 2 * L * MemoryLayout<Float>.size)!

    for (k, s) in starts.enumerated() {
      if cancelled { throw NSError(domain: "Ghostgrid", code: 32, userInfo: [NSLocalizedDescriptionKey: "Cancelled"]) }
      let len = min(L, n - s)
      let p = input.mutableBytes.assumingMemoryBound(to: Float.self)
      for i in 0..<L {
        if i < len {
          p[i] = (l[s + i] - fm) / fs
          p[L + i] = (r[s + i] - fm) / fs
        } else {
          p[i] = 0; p[L + i] = 0
        }
      }
      let value = try ORTValue(tensorData: input, elementType: .float, shape: [1, 2, NSNumber(value: L)])
      let outputs = try session.run(withInputs: [inName: value], outputNames: Set([outName]), runOptions: nil)
      guard let out = outputs[outName] else { throw NSError(domain: "Ghostgrid", code: 33, userInfo: [NSLocalizedDescriptionKey: "The model gave no output"]) }
      let data = try out.tensorData()
      let o = data.bytes.assumingMemoryBound(to: Float.self)
      // shape (1, sources, 2, L) — drums are source 0, or the only source
      for i in 0..<len {
        let wi = w[i]
        dl[s + i] += (o[i] * fs) * wi
        dr[s + i] += (o[L + i] * fs) * wi
        ws[s + i] += wi
      }
      emit?("onStemsProgress", ["phase": "separate", "progress": Double(k + 1) / Double(starts.count)])
      if k == 0 { mark("separate", ["segments": starts.count, "done": 1]) }
    }

    mark("write")
    emit?("onStemsProgress", ["phase": "write", "progress": 1.0])
    // drums = weighted average of the segments; the rest = the song minus the drums (in place, to save memory).
    // Any invalid model output (NaN or infinite) is silenced and counted: one NaN can silence a whole player.
    var bad = 0
    var eMix: Double = 0, eDrums: Double = 0, eRest: Double = 0, peakDrums: Float = 0
    for i in 0..<n {
      let d: Float = ws[i] > 0 ? 1 / ws[i] : 0
      var a = dl[i] * d, b = dr[i] * d
      if !a.isFinite || !b.isFinite { a = 0; b = 0; bad += 1 }
      dl[i] = a
      dr[i] = b
      eMix += Double(l[i] * l[i] + r[i] * r[i])
      l[i] -= a
      r[i] -= b
      eDrums += Double(a * a + b * b)
      eRest += Double(l[i] * l[i] + r[i] * r[i])
      peakDrums = max(peakDrums, abs(a), abs(b))
    }
    ws = []
    let db = { (e: Double) in 10 * log10(max(1e-12, e / Double(2 * n))) }
    try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
    try Self.writeStereo(outDir.appendingPathComponent("drums.caf"), dl, dr)
    try Self.writeStereo(outDir.appendingPathComponent("nodrums.caf"), l, r)
    mark("done", ["invalid": bad])
    return [
      "duration": Double(n) / Self.sampleRate,
      "mixDb": db(eMix), "drumsDb": db(eDrums), "restDb": db(eRest),
      "drumsShare": eMix > 0 ? eDrums / eMix : 0, "drumsPeak": Double(peakDrums), "invalid": bad,
    ]
  }

  /// Drum transcription (Onsets and Frames Drums, E-GMD checkpoint, Apache-2.0) on a drum track.
  /// Runs in 20 s pieces that overlap by 2 s and returns every onset peak from 0.15 up, per model column
  /// (0 kick, 1 snare, 2 tom, 3 hi-hat, 4 ride, 5 ride bell, 6 crash, 7 clave), with the model's velocity.
  /// The thresholds per drum are applied in TypeScript (modelDrumHits), so they can be tuned without a new build.
  static func transcribe(_ url: URL, modelName: String) throws -> [String: Any] {
    let modelPath = modelURL(modelName).path
    guard FileManager.default.fileExists(atPath: modelPath) else {
      throw NSError(domain: "Ghostgrid", code: 40, userInfo: [NSLocalizedDescriptionKey: "The drum model isn't downloaded"])
    }
    let (l, r) = try readStereo(url)
    let n = l.count
    var x = [Float](repeating: 0, count: n)
    for i in 0..<n { x[i] = (l[i] + r[i]) * 0.5 }
    let env = try ORTEnv(loggingLevel: .warning)
    let opts = try ORTSessionOptions()
    try opts.setIntraOpNumThreads(Int32(max(2, min(4, ProcessInfo.processInfo.activeProcessorCount))))
    let session = try ORTSession(env: env, modelPath: modelPath, sessionOptions: opts)
    let cols = 8, hop = 441, sr = Int(sampleRate)
    let frames = n / hop + 1
    var on = [Float](repeating: 0, count: frames * cols), vel = [Float](repeating: 0, count: frames * cols)
    let chunk = 20 * sr, step = 18 * sr
    var start = 0
    while true {
      let len = min(chunk, n - start)
      if len < 2049 { break }
      let data = NSMutableData(length: len * MemoryLayout<Float>.size)!
      x.withUnsafeBufferPointer { src in
        data.mutableBytes.copyMemory(from: src.baseAddress! + start, byteCount: len * MemoryLayout<Float>.size)
      }
      let input = try ORTValue(tensorData: data, elementType: .float, shape: [1, NSNumber(value: len)])
      let outs = try session.run(withInputs: ["waveform": input], outputNames: Set(["onset_probs", "velocity"]), runOptions: nil)
      guard let o = outs["onset_probs"], let v = outs["velocity"] else {
        throw NSError(domain: "Ghostgrid", code: 41, userInfo: [NSLocalizedDescriptionKey: "The drum model gave no output"])
      }
      let od = try o.tensorData(), vd = try v.tensorData()
      let op = od.bytes.assumingMemoryBound(to: Float.self), vp = vd.bytes.assumingMemoryBound(to: Float.self)
      let got = od.length / MemoryLayout<Float>.size / cols
      let f0 = start / hop, keepFrom = start == 0 ? 0 : 100
      var f = keepFrom
      while f < got && f0 + f < frames {
        for c in 0..<cols { on[(f0 + f) * cols + c] = op[f * cols + c]; vel[(f0 + f) * cols + c] = vp[f * cols + c] }
        f += 1
      }
      if start + chunk >= n { break }
      start += step
    }
    // peaks: a local maximum from 0.15 up, at least 30 ms after the previous peak in the same column
    var ts: [Double] = [], cs: [Int] = [], ps: [Double] = [], vs: [Double] = []
    for c in 0..<cols {
      var lastF = -10
      if frames < 3 { break }
      for i in 1..<(frames - 1) {
        let a = on[i * cols + c]
        if a >= 0.15 && a >= on[(i - 1) * cols + c] && a > on[(i + 1) * cols + c] && i - lastF >= 3 {
          ts.append(Double(i) / 100); cs.append(c); ps.append(Double(a)); vs.append(Double(vel[i * cols + c])); lastF = i
        }
      }
    }
    return ["rate": 100, "t": ts, "c": cs, "p": ps, "v": vs, "duration": Double(n) / sampleRate]
  }

  /// Beats and downbeats of a whole song with Beat This! (Foscarin, Schlüter, Widmer, ISMIR 2024; MIT; ONNX build with the
  /// log-mel front end inside). The model wants mono at 22.05 kHz and works on 1500-frame pieces (50 frames a second) that
  /// overlap 6 frames per side; each frame is taken from the first piece that covers it with context on both sides.
  /// Returns the raw logits (50 per second); picking the peaks happens in TypeScript (modelBeatMap).
  static func beatLogits(_ url: URL, modelName: String) throws -> [String: Any] {
    let modelPath = modelURL(modelName).path
    guard FileManager.default.fileExists(atPath: modelPath) else {
      throw NSError(domain: "Ghostgrid", code: 50, userInfo: [NSLocalizedDescriptionKey: "The beat model isn't downloaded"])
    }
    // mono, then 44.1 → 22.05 kHz: a 63-tap windowed-sinc low-pass at 11 kHz, every second sample
    var mono: [Float] = []
    do {
      let (l, r) = try readStereo(url)
      mono = [Float](repeating: 0, count: l.count)
      for i in 0..<l.count { mono[i] = (l[i] + r[i]) * 0.5 }
    }
    let taps = 63, half = taps / 2
    var h = [Float](repeating: 0, count: taps)
    var hs: Float = 0
    for k in 0..<taps {
      let m = Double(k - half)
      let sinc = m == 0 ? 0.5 : sin(Double.pi * 0.5 * m) / (Double.pi * m)
      let w = 0.54 - 0.46 * cos(2 * Double.pi * Double(k) / Double(taps - 1))
      h[k] = Float(sinc * w); hs += h[k]
    }
    for k in 0..<taps { h[k] /= hs }
    let n22 = mono.count / 2
    guard n22 > 22_050 * 2 else {
      throw NSError(domain: "Ghostgrid", code: 51, userInfo: [NSLocalizedDescriptionKey: "The song is too short to find a beat"])
    }
    var x = [Float](repeating: 0, count: n22)
    mono.withUnsafeBufferPointer { src in
      for i in 0..<n22 {
        let c = 2 * i
        var acc: Float = 0
        for k in 0..<taps {
          let j = c + k - half
          if j >= 0 && j < src.count { acc += h[k] * src[j] }
        }
        x[i] = acc
      }
    }
    mono = []
    // reflect 512 samples at both ends (the model's context at the start and end of the piece)
    let ctx = 512, hop = 441, win = 1024, chunk = 1500, border = 6
    var xp = [Float](repeating: 0, count: n22 + 2 * ctx)
    for i in 0..<ctx { xp[i] = x[ctx - i]; xp[ctx + n22 + i] = x[n22 - 2 - i] }
    for i in 0..<n22 { xp[ctx + i] = x[i] }
    x = []
    let frames = (xp.count - win) / hop + 1

    let env = try ORTEnv(loggingLevel: .warning)
    let opts = try ORTSessionOptions()
    try opts.setIntraOpNumThreads(Int32(max(2, min(4, ProcessInfo.processInfo.activeProcessorCount))))
    let session = try ORTSession(env: env, modelPath: modelPath, sessionOptions: opts)

    var beat = [Double](repeating: -10, count: frames), down = [Double](repeating: -10, count: frames)
    var filled = [Bool](repeating: false, count: frames)
    var a = 0
    while true {
      var b = min(a + chunk, frames)
      if b == frames && b - a < chunk && a > 0 { a = max(0, frames - chunk) }   // the last piece is moved left
      b = min(a + chunk, frames)
      let count = b - a
      let from = a * hop, to = (b - 1) * hop + win
      let pad0 = a == 0 ? 6 : 0, pad1 = b == frames ? 6 : 0
      let data = NSMutableData(length: (to - from) * MemoryLayout<Float>.size)!
      xp.withUnsafeBufferPointer { src in
        data.mutableBytes.copyMemory(from: src.baseAddress! + from, byteCount: (to - from) * MemoryLayout<Float>.size)
      }
      let padData = NSMutableData(length: 2 * MemoryLayout<Int64>.size)!
      padData.mutableBytes.assumingMemoryBound(to: Int64.self)[0] = Int64(pad0)
      padData.mutableBytes.assumingMemoryBound(to: Int64.self)[1] = Int64(pad1)
      let input = try ORTValue(tensorData: data, elementType: .float, shape: [1, NSNumber(value: to - from)])
      let padIn = try ORTValue(tensorData: padData, elementType: .int64, shape: [2])
      let outs = try session.run(withInputs: ["waveform": input, "pad_frames": padIn], outputNames: Set(["beat", "downbeat"]), runOptions: nil)
      guard let ob = outs["beat"], let od = outs["downbeat"] else {
        throw NSError(domain: "Ghostgrid", code: 52, userInfo: [NSLocalizedDescriptionKey: "The beat model gave no output"])
      }
      let bd = try ob.tensorData(), dd = try od.tensorData()
      let bp = bd.bytes.assumingMemoryBound(to: Float.self), dp = dd.bytes.assumingMemoryBound(to: Float.self)
      let got = bd.length / MemoryLayout<Float>.size
      let lo = a == 0 ? 0 : a + border, hi = b == frames ? frames : b - border
      if lo < hi {
        for f in lo..<hi where !filled[f] {
          let k = f - a + pad0
          if k >= 0 && k < got { beat[f] = Double(bp[k]); down[f] = Double(dp[k]); filled[f] = true }
        }
      }
      _ = count
      if b == frames { break }
      a = b - 2 * border
    }
    return ["rate": 50, "beat": beat, "down": down, "duration": Double(n22) / 22_050]
  }

  /// Level check of a separated song's files (for songs separated before the check existed).
  static func levels(_ url: URL) throws -> [String: Any] {
    let file = try AVAudioFile(forReading: url)
    guard let buf = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 65_536) else { return [:] }
    var e: Double = 0, peak: Float = 0, bad = 0, count = 0
    let chans = Int(file.processingFormat.channelCount)
    while file.framePosition < file.length {
      try file.read(into: buf, frameCount: 65_536)
      let n = Int(buf.frameLength)
      if n == 0 { break }
      guard let ch = buf.floatChannelData else { break }
      for c in 0..<chans {
        for i in 0..<n {
          let x = ch[c][i]
          if !x.isFinite { bad += 1; continue }
          e += Double(x * x); peak = max(peak, abs(x)); count += 1
        }
      }
    }
    return ["db": 10 * log10(max(1e-12, e / Double(max(1, count)))), "peak": Double(peak), "invalid": bad]
  }
}
