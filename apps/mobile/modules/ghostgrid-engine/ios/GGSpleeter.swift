import Accelerate
import Foundation
import onnxruntime_objc

/// Second drum separator: Spleeter (Deezer Research, Hennequin et al., JOSS 2020; MIT code; models trained by Deezer on its
/// own data). The four U-Nets of the 4-stem model are converted to ONNX (tools/spleeter) as one network that takes 512 frames of
/// the song's magnitude spectrogram (first 1024 bins, both channels) and returns the soft mask of the drums. The STFT (4096
/// window, hop 1024, periodic Hann), the mask and the inverse STFT are done here, one chunk of 512 frames at a time, so
/// memory stays small. Above bin 1024 (about 11 kHz) the drums stem is empty, as in Spleeter itself; the song without drums
/// is the song minus the drums, so those highs stay in it.
/// tools/spleeter/spleeter_ref.py is the same algorithm in NumPy (checked against Deezer's own TensorFlow graph).

/// Radix-2 complex FFT, in place. Forward is e^{-i…}; inverse is e^{+i…} without the 1/n scale.
final class GGFFT {
  let n: Int
  private var cosT: [Float], sinT: [Float], rev: [Int]
  init(n: Int) {
    self.n = n
    cosT = (0..<n / 2).map { Float(cos(2 * Double.pi * Double($0) / Double(n))) }
    sinT = (0..<n / 2).map { Float(sin(2 * Double.pi * Double($0) / Double(n))) }
    var bits = 0
    while (1 << bits) < n { bits += 1 }
    rev = (0..<n).map { i in
      var r = 0, x = i
      for _ in 0..<bits { r = (r << 1) | (x & 1); x >>= 1 }
      return r
    }
  }

  func transform(_ re: inout [Float], _ im: inout [Float], inverse: Bool) {
    for i in 0..<n {
      let j = rev[i]
      if j > i { re.swapAt(i, j); im.swapAt(i, j) }
    }
    let sign: Float = inverse ? 1 : -1
    var len = 2
    while len <= n {
      let half = len / 2, step = n / len
      var i = 0
      while i < n {
        for j in 0..<half {
          let wr = cosT[j * step], wi = sign * sinT[j * step]
          let a = i + j, b = i + j + half
          let tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr
          re[b] = re[a] - tr; im[b] = im[a] - ti
          re[a] += tr; im[a] += ti
        }
        i += len
      }
      len <<= 1
    }
  }
}

extension GGStems {
  static let spFL = 4096, spFS = 1024, spT = 512, spF = 1024
  static let spWin: [Float] = (0..<4096).map { Float(0.5 - 0.5 * cos(2 * Double.pi * Double($0) / 4096)) }
  /// Synthesis window: the analysis window divided by the sum of its squared overlaps (so overlap-add reconstructs exactly).
  static let spIWin: [Float] = {
    var den = [Float](repeating: 0, count: 1024)
    for i in 0..<1024 {
      var s: Float = 0
      for k in 0..<4 { let w = spWin[i + 1024 * k]; s += w * w }
      den[i] = s
    }
    return (0..<4096).map { spWin[$0] / den[$0 % 1024] }
  }()

  /// Separate `input` into drums.caf and nodrums.caf in `outDir`, with Spleeter.
  func separateSpleeter(input: URL, outDir: URL, modelName: String) throws -> [String: Any] {
    let modelPath = Self.modelURL(modelName).path
    guard FileManager.default.fileExists(atPath: modelPath) else {
      throw NSError(domain: "Ghostgrid", code: 35, userInfo: [NSLocalizedDescriptionKey: "The Spleeter model isn't on this phone"])
    }
    mark("decode")
    emit?("onStemsProgress", ["phase": "decode", "progress": 0.0])
    var (l, r) = try Self.readStereo(input)
    let n = l.count
    if n < Int(Self.sampleRate) { throw NSError(domain: "Ghostgrid", code: 31, userInfo: [NSLocalizedDescriptionKey: "That recording is too short"]) }

    mark("load", ["seconds": Double(n) / Self.sampleRate])
    emit?("onStemsProgress", ["phase": "load", "progress": 0.0])
    let env = try ORTEnv(loggingLevel: .warning)
    let opts = try ORTSessionOptions()
    try opts.setIntraOpNumThreads(Int32(max(2, min(4, ProcessInfo.processInfo.activeProcessorCount))))
    let session = try ORTSession(env: env, modelPath: modelPath, sessionOptions: opts)
    let inName = try session.inputNames().first ?? "mag"
    let outName = try session.outputNames().first ?? "Identity:0"
    mark("separate", ["freeAfterLoadMB": Self.freeMB()])

    let FL = Self.spFL, FS = Self.spFS, T = Self.spT, F = Self.spF
    let win = Self.spWin, iwin = Self.spIWin
    let frames = (n + FS - 1) / FS
    let chunks = (frames + T - 1) / T
    var dl = [Float](repeating: 0, count: n), dr = [Float](repeating: 0, count: n)
    let fft = GGFFT(n: FL)
    var re = [Float](repeating: 0, count: FL), im = [Float](repeating: 0, count: FL)
    // the complex spectra of this chunk, left and right (first F bins), kept to apply the mask to
    var xlRe = [Float](repeating: 0, count: T * F), xlIm = xlRe, xrRe = xlRe, xrIm = xlRe
    let magData = NSMutableData(length: T * F * 2 * MemoryLayout<Float>.size)!
    let inv = 1 / Float(FL)

    for c in 0..<chunks {
      if cancelled { throw NSError(domain: "Ghostgrid", code: 32, userInfo: [NSLocalizedDescriptionKey: "Cancelled"]) }
      let f0 = c * T, fc = min(T, frames - f0)
      let mp = magData.mutableBytes.assumingMemoryBound(to: Float.self)
      memset(magData.mutableBytes, 0, magData.length)   // frames past the end stay silent
      for t in 0..<fc {
        let start = (f0 + t) * FS
        // both channels in one complex FFT: left is the real part, right the imaginary part
        for i in 0..<FL {
          let j = start + i
          if j < n { re[i] = l[j] * win[i]; im[i] = r[j] * win[i] } else { re[i] = 0; im[i] = 0 }
        }
        fft.transform(&re, &im, inverse: false)
        for k in 0..<F {
          let nk = (FL - k) % FL
          let zr = re[k], zi = im[k], wr = re[nk], wi = im[nk]
          let lr = 0.5 * (zr + wr), li = 0.5 * (zi - wi)       // left  = (Z[k] + conj Z[N-k]) / 2
          let rr = 0.5 * (zi + wi), ri = -0.5 * (zr - wr)      // right = (Z[k] - conj Z[N-k]) / 2i
          let idx = t * F + k
          xlRe[idx] = lr; xlIm[idx] = li; xrRe[idx] = rr; xrIm[idx] = ri
          mp[idx * 2] = (lr * lr + li * li).squareRoot()
          mp[idx * 2 + 1] = (rr * rr + ri * ri).squareRoot()
        }
      }
      let value = try ORTValue(tensorData: magData, elementType: .float, shape: [1, NSNumber(value: T), NSNumber(value: F), 2])
      let outputs = try session.run(withInputs: [inName: value], outputNames: Set([outName]), runOptions: nil)
      guard let out = outputs[outName] else { throw NSError(domain: "Ghostgrid", code: 33, userInfo: [NSLocalizedDescriptionKey: "The model gave no output"]) }
      let data = try out.tensorData()
      let mk = data.bytes.assumingMemoryBound(to: Float.self)

      for t in 0..<fc {
        for i in 0..<FL { re[i] = 0; im[i] = 0 }
        for k in 0..<F {
          let idx = t * F + k, ml = mk[idx * 2], mr = mk[idx * 2 + 1]
          let ylr = xlRe[idx] * ml, yli = xlIm[idx] * ml, yrr = xrRe[idx] * mr, yri = xrIm[idx] * mr
          if k == 0 {
            re[0] = ylr; im[0] = yrr                           // DC is real in both channels
          } else {
            re[k] = ylr - yri; im[k] = yli + yrr               // Z[k]   = YL + i YR
            re[FL - k] = ylr + yri; im[FL - k] = yrr - yli     // Z[N-k] = conj YL + i conj YR
          }
        }
        fft.transform(&re, &im, inverse: true)
        let start = (f0 + t) * FS
        for i in 0..<FL {
          let j = start + i
          if j >= n { break }
          dl[j] += re[i] * inv * iwin[i]
          dr[j] += im[i] * inv * iwin[i]
        }
      }
      emit?("onStemsProgress", ["phase": "separate", "progress": Double(c + 1) / Double(chunks)])
    }
    return try finishStems(l: &l, r: &r, dl: &dl, dr: &dr, n: n, outDir: outDir)
  }

  /// The song without drums is the song minus the drums (in place, to save memory); invalid samples are silenced and counted.
  func finishStems(l: inout [Float], r: inout [Float], dl: inout [Float], dr: inout [Float], n: Int, outDir: URL) throws -> [String: Any] {
    mark("write")
    emit?("onStemsProgress", ["phase": "write", "progress": 1.0])
    var bad = 0
    var eMix: Double = 0, eDrums: Double = 0, eRest: Double = 0, peakDrums: Float = 0
    for i in 0..<n {
      var a = dl[i], b = dr[i]
      if !a.isFinite || !b.isFinite { a = 0; b = 0; bad += 1 }
      dl[i] = a; dr[i] = b
      eMix += Double(l[i] * l[i] + r[i] * r[i])
      l[i] -= a; r[i] -= b
      eDrums += Double(a * a + b * b)
      eRest += Double(l[i] * l[i] + r[i] * r[i])
      peakDrums = max(peakDrums, abs(a), abs(b))
    }
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
}
