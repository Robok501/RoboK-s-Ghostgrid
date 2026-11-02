"""Inspect the Onsets and Frames Drums ONNX model and run it on one file (first pass: learn its inputs and outputs).
Usage: oaf.py <model.onnx> <dir>"""
import json, sys
import numpy as np, onnxruntime as ort, soundfile as sf

model, d = sys.argv[1], sys.argv[2]
s = ort.InferenceSession(model, providers=['CPUExecutionProvider'])
for i in s.get_inputs(): print('INPUT', i.name, i.shape, i.type)
for o in s.get_outputs(): print('OUTPUT', o.name, o.shape, o.type)
meta = s.get_modelmeta(); print('META', meta.custom_metadata_map, meta.description)
name = json.load(open(f'{d}/index.json'))[0]
x, sr = sf.read(f'{d}/{name}.wav', dtype='float32')
if x.ndim > 1: x = x.mean(1)
print('audio', name, sr, x.shape)
inp = s.get_inputs()[0]
seg = x[: sr * 10]
shape = [d if isinstance(d, int) else None for d in inp.shape]
feed = seg[None, :] if len(shape) == 2 else seg
try:
    outs = s.run(None, {inp.name: feed.astype(np.float32)})
    for o, v in zip(s.get_outputs(), outs):
        v = np.asarray(v); print('RESULT', o.name, v.shape, 'min', float(v.min()), 'max', float(v.max()))
        if v.ndim >= 2:
            a = v.reshape(-1, v.shape[-1]); print('  per-column max', np.round(a.max(0), 2).tolist())
except Exception as e:
    print('RUN FAILED', repr(e)[:500])
