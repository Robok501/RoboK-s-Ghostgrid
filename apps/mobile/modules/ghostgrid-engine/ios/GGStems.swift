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
  static func modelURL(_ name: String) -> URL { modelDir.appendingPathComponent(name) }

  func modelStatus(_ name: String) -> [String: Any] {
    let url = Self.modelURL(name)
    let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? 0
    return ["present": size > 1_000_000, "bytes": size, "path": url.path]
  }

  func deleteModel(_ name: String) {
    try? FileManager.default.removeItem(at: Self.modelURL(name))
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
    let dest = Self.modelURL(pendingName)
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
  func separate(input: URL, outDir: URL, modelName: String) throws -> Double {
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
    // drums = weighted average of the segments; the rest = the song minus the drums (in place, to save memory)
    for i in 0..<n {
      let d: Float = ws[i] > 0 ? 1 / ws[i] : 0
      dl[i] *= d
      dr[i] *= d
      l[i] -= dl[i]
      r[i] -= dr[i]
    }
    ws = []
    try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
    try Self.writeStereo(outDir.appendingPathComponent("drums.caf"), dl, dr)
    try Self.writeStereo(outDir.appendingPathComponent("nodrums.caf"), l, r)
    mark("done")
    return Double(n) / Self.sampleRate
  }
}
