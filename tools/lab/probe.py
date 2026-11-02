"""Does the model's hi-hat column ever respond? Feed short noise bursts, high-passed at several cutoffs."""
import sys
import numpy as np, onnxruntime as ort
s = ort.InferenceSession(sys.argv[1], providers=['CPUExecutionProvider'])
sr = 44100; rng = np.random.default_rng(0)
for cut in (0, 3000, 6000, 9000, 12000):
    for dec in (0.02, 0.06, 0.3):
        x = np.zeros(sr * 4, np.float32)
        for i in range(8):
            n = int((0.3 + i * 0.45) * sr); k = np.arange(int(0.4 * sr))
            b = rng.standard_normal(len(k))
            if cut:
                B = np.fft.rfft(b); f = np.fft.rfftfreq(len(b), 1 / sr); B[f < cut] = 0; b = np.fft.irfft(B, len(b))
            x[n:n + len(k)] += (0.4 * b * np.exp(-k / (dec * sr))).astype(np.float32)
        o, _ = s.run(None, {'waveform': x[None, :]})
        print(f'noise above {cut:5d} Hz, decay {dec}s -> max per column', np.round(o[0].max(0), 2).tolist())
