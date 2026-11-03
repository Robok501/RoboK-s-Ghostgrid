"""Reference drums separation with Spleeter's ONNX drums-mask network: STFT -> network -> mask -> inverse STFT.
This is the algorithm the Swift code implements; the lab uses it to score Spleeter."""
import numpy as np, onnxruntime as ort

FL, FS, T, F = 4096, 1024, 512, 1024
WIN = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(FL) / FL)).astype(np.float64)  # periodic Hann
_den = (WIN ** 2).reshape(-1, FS).sum(0)
IWIN = WIN / np.tile(_den, FL // FS)

def stft(x):                                   # x [n, 2] -> [frames, 2049, 2] complex
    n = x.shape[0]; frames = -(-n // FS)
    xp = np.zeros(((frames - 1) * FS + FL, 2)); xp[:n] = x
    idx = np.arange(frames)[:, None] * FS + np.arange(FL)[None, :]
    fr = xp[idx] * WIN[None, :, None]           # [frames, FL, 2]
    return np.fft.rfft(fr, axis=1)

def istft(X, n):                               # X [frames, 2049, 2] -> [n, 2]
    fr = np.fft.irfft(X, n=FL, axis=1) * IWIN[None, :, None]
    frames = fr.shape[0]; out = np.zeros(((frames - 1) * FS + FL, 2))
    for i in range(frames): out[i * FS:i * FS + FL] += fr[i]
    return out[:n]

def drums(x, sess):                            # x [n, 2] float -> drums [n, 2]
    n = x.shape[0]; X = stft(x); fr = X.shape[0]
    pad = (-fr) % T
    Xp = np.concatenate([X, np.zeros((pad, X.shape[1], 2), X.dtype)]) if pad else X
    mag = np.abs(Xp)[:, :F, :].astype(np.float32).reshape(-1, T, F, 2)
    mask = np.concatenate([sess.run(None, {sess.get_inputs()[0].name: mag[i:i + 4]})[0] for i in range(0, len(mag), 4)])
    mask = mask.reshape(-1, F, 2)[:fr]
    Y = np.zeros_like(X); Y[:, :F, :] = X[:, :F, :] * mask
    return istft(Y, n)   # inverse window normalised by the overlap sum, so no extra compensation factor
