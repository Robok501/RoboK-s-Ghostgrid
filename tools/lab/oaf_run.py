"""Run Onsets and Frames Drums on every WAV and write <name>.oaf<thr>.json with hits (time, class, velocity).
Usage: oaf_run.py <model.onnx> <dir> [threshold ...]"""
import json, sys
import numpy as np, onnxruntime as ort, soundfile as sf

CLS = ['kick', 'snare', 'tom', 'hh', 'cym', 'cym', 'cym', 'other']  # pitches 36,38,48,42,51,53,49,75
model, d = sys.argv[1], sys.argv[2]
thrs = [float(x) for x in sys.argv[3:]] or [0.5]
s = ort.InferenceSession(model, providers=['CPUExecutionProvider'])

def run(x, sr=44100, chunk=20, hop=18):
    """Chunks of 20 s with 2 s overlap; each frame is taken from the chunk where it is furthest from an edge."""
    n = len(x) // 441 + 1
    on = np.zeros((n, 8), np.float32); vel = np.zeros((n, 8), np.float32)
    start = 0
    while True:
        seg = x[start * sr: (start + chunk) * sr]
        o, v = s.run(None, {'waveform': seg[None, :].astype(np.float32)})
        f0 = start * 100; keep_from = 0 if start == 0 else 100
        m = min(o.shape[1], n - f0)
        on[f0 + keep_from: f0 + m] = o[0, keep_from:m]; vel[f0 + keep_from: f0 + m] = v[0, keep_from:m]
        if (start + chunk) * sr >= len(x): break
        start += hop
    return on, vel

for name in json.load(open(f'{d}/index.json')):
    x, sr = sf.read(f'{d}/{name}.wav', dtype='float32')
    if x.ndim > 1: x = x.mean(1)
    on, vel = run(x)
    for thr in thrs:
        hits = []
        for c in range(8):
            a = on[:, c]
            for i in range(1, len(a) - 1):
                if a[i] >= thr and a[i] >= a[i - 1] and a[i] > a[i + 1]:
                    if hits and hits[-1]['c'] == c and i - hits[-1]['f'] < 3: continue
                    hits.append({'f': i, 'c': c, 't': round(i / 100, 3), 'cls': CLS[c], 'vel': round(float(vel[i, c]), 3)})
        json.dump(hits, open(f'{d}/{name}.oaf{int(thr*100)}.json', 'w'))
    print(name, len(hits), 'hits')
