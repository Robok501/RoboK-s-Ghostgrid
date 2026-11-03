"""Run Beat This! (ONNX, MIT) on every WAV in a lab folder and write <name>.bt.json with beats and downbeats.
Follows the model card: 22.05 kHz mono, 1500-frame chunks overlapping 6 frames per side, 50 fps logits.
Usage: beat_this_run.py <model.onnx> <dir>"""
import json, sys
import numpy as np, onnxruntime as ort, soundfile as sf

HOP, WIN, CHUNK, BORDER, FPS = 441, 1024, 1500, 6, 50
model, d = sys.argv[1], sys.argv[2]
s = ort.InferenceSession(model, providers=['CPUExecutionProvider'])
print('inputs', [(i.name, i.shape, i.type) for i in s.get_inputs()], 'outputs', [o.name for o in s.get_outputs()])

def resample(x, sr, to=22050):
    if sr == to: return x
    t = np.arange(0, len(x) * to // sr) * (sr / to)
    return np.interp(t, np.arange(len(x)), x).astype(np.float32)

def logits(x):
    """Same chunking as the app (GGStems.beatLogits): runs of 1500 frames, each frame taken from the first run
    that covers it with 6 frames of context on both sides; the last run is moved left to end at the end."""
    xp = np.pad(x, (512, 512), mode='reflect')
    F = (len(xp) - WIN) // HOP + 1
    beat = np.full(F, -10, np.float32); down = np.full(F, -10, np.float32); filled = np.zeros(F, bool)
    a = 0
    while True:
        b = min(a + CHUNK, F)
        if b == F and b - a < CHUNK and a > 0: a = max(0, F - CHUNK)
        b = min(a + CHUNK, F)
        pad = np.array([6 if a == 0 else 0, 6 if b == F else 0], np.int64)
        seg = xp[a * HOP: (b - 1) * HOP + WIN]
        ob, od = s.run(None, {'waveform': seg[None, :].astype(np.float32), 'pad_frames': pad})
        lo, hi = (0 if a == 0 else a + BORDER), (F if b == F else b - BORDER)
        for f in range(lo, hi):
            k = f - a + int(pad[0])
            if not filled[f] and 0 <= k < ob.shape[1]: beat[f] = ob[0, k]; down[f] = od[0, k]; filled[f] = True
        if b == F: break
        a = b - 2 * BORDER
    return beat, down

def peaks(l):
    """Local max over 7 frames with logit > 0; neighbouring peaks merged."""
    n = len(l); out = []
    for i in range(n):
        if l[i] > 0 and l[i] == l[max(0, i - 3): i + 4].max():
            if out and i - out[-1][-1] <= 1: out[-1].append(i)
            else: out.append([i])
    return [float(np.mean(g)) / FPS for g in out]

for name in json.load(open(f'{d}/index.json')):
    x, sr = sf.read(f'{d}/{name}.wav', dtype='float32')
    if x.ndim > 1: x = x.mean(1)
    b, dn = logits(resample(x, sr))
    beats = peaks(b)
    downs = sorted({min(beats, key=lambda t: abs(t - x0)) for x0 in peaks(dn)}) if beats else []
    json.dump({'beats': beats, 'downbeats': downs}, open(f'{d}/{name}.bt.json', 'w'))
    print(name, len(beats), 'beats', len(downs), 'downbeats')
