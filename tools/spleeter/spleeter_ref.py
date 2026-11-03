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

def analyse(x, sess):                          # x [n, 2] -> (spectrum X [frames, 2049, 2], network mask [frames, 1024, 2])
    X = stft(x); fr = X.shape[0]
    pad = (-fr) % T
    Xp = np.concatenate([X, np.zeros((pad, X.shape[1], 2), X.dtype)]) if pad else X
    mag = np.abs(Xp)[:, :F, :].astype(np.float32).reshape(-1, T, F, 2)
    mask = np.concatenate([sess.run(None, {sess.get_inputs()[0].name: mag[i:i + 4]})[0] for i in range(0, len(mag), 4)])
    return X, mask.reshape(-1, F, 2)[:fr]

def _smooth(a, lo, hi):                        # smoothstep of a between lo and hi
    t = np.clip((a - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t)

def render(X, mask, n, power=1.0, hi=0.0, gate=0.0):
    """Tweaks on top of the network's mask (all off = plain Spleeter):
    power  mask**power; above 1 it removes more of what the network is unsure about (less bleed, more artefacts).
    hi     0..1; Spleeter's mask is zero above bin 1024 (~11 kHz), so hats and cymbals lose their top. Here that band is brought back from
           the mix, per frame, by how much of the 3-11 kHz energy the (tweaked) mask assigns to drums, at most `hi` of the mix.
    gate   dB; frames whose drum energy is more than `gate` dB under the song's loud frames are turned down (x0.25), with a +-2 frame
           margin so decays are kept: removes sustained bleed between the hits."""
    M = mask ** power if power != 1 else mask
    Y = np.zeros_like(X); Y[:, :F, :] = X[:, :F, :] * M
    if hi > 0:
        band = slice(280, F)                    # 3 kHz .. 11 kHz
        r = (np.abs(Y[:, band]) ** 2).sum((1, 2)) / ((np.abs(X[:, band]) ** 2).sum((1, 2)) + 1e-9)
        g = hi * _smooth(r, 0.3, 0.8)
        Y[:, F:, :] = X[:, F:, :] * g[:, None, None]
    if gate > 0:
        e = 10 * np.log10((np.abs(Y) ** 2).sum((1, 2)) + 1e-9)
        quiet = e < np.percentile(e, 98) - gate
        loud = np.convolve((~quiet).astype(float), np.ones(5), 'same') > 0
        Y *= np.where(loud, 1.0, 0.25)[:, None, None]
    return istft(Y, n)

def drums(x, sess, **opts):                    # x [n, 2] float -> drums [n, 2]
    X, mask = analyse(x, sess)
    return render(X, mask, x.shape[0], **opts)   # inverse window normalised by the overlap sum, so no extra compensation factor
