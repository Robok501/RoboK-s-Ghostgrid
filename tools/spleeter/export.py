"""Spleeter 4stems (Deezer, MIT) -> ONNX of the neural part: magnitude chunk in, drums soft mask out.

The four U-Nets are rebuilt in plain TensorFlow from Deezer's checkpoint (unet.py) and exported with tf2onnx. All four are
needed: the drums mask is a ratio between the stems. The STFT and inverse STFT stay outside the ONNX file (the app does them
natively); spleeter_ref.py is the same algorithm in NumPy.

Usage: export.py <checkpoint dir with model.meta/model.index> <out.onnx>
Checks (exit code 1 when they fail):
  1. ONNX vs TensorFlow on random input (max diff < 1e-4)
  2. the whole chain (spleeter_ref.drums) vs Deezer's own TensorFlow graph on a test clip (error > 60 dB below the signal)
"""
import sys
import numpy as np, tensorflow as tf, tf2onnx, onnxruntime as ort
from unet import load, build
from spleeter_ref import drums

ckpt, out = sys.argv[1], sys.argv[2]
f = build(load(ckpt + '/model'))
tf2onnx.convert.from_function(f, input_signature=f.input_signature, opset=13, output_path=out)
sess = ort.InferenceSession(out, providers=['CPUExecutionProvider'])
x = np.random.RandomState(0).rand(2, 512, 1024, 2).astype(np.float32)
d = float(np.abs(sess.run(None, {sess.get_inputs()[0].name: x})[0] - f(tf.constant(x)).numpy()).max())
print('onnx io:', [(i.name, i.shape) for i in sess.get_inputs()], [(o.name, o.shape) for o in sess.get_outputs()])
print('1. ONNX vs TensorFlow rebuild, max diff:', d)

# a test clip: chords plus kick-like and snare-like bursts
rng = np.random.RandomState(1); sr = 44100; n = sr * 9; t = np.arange(n) / sr
clip = np.zeros((n, 2))
for c in range(2):
    clip[:, c] += 0.15 * (np.sin(2*np.pi*220*t) + 0.6*np.sin(2*np.pi*277*t) + 0.5*np.sin(2*np.pi*330*t)) * (0.8 + 0.2*np.sin(2*np.pi*0.5*t))
for k in range(18):
    i = int(k * 0.5 * sr); m = 6000
    env = np.exp(-np.arange(m) / (1200 if k % 2 else 500))
    clip[i:i+m] += ((np.sin(2*np.pi*55*np.arange(m)/sr) if k % 2 == 0 else rng.randn(m)) * env * 0.6)[:min(m, n - i), None]
clip = clip.astype(np.float32)
mine = drums(clip.astype(np.float64), sess)
tf.compat.v1.disable_eager_execution()
g = tf.Graph()
with g.as_default():
    saver = tf.compat.v1.train.import_meta_graph(ckpt + '/model.meta')
    with tf.compat.v1.Session(graph=g) as s:
        saver.restore(s, ckpt + '/model')
        ref = s.run('strided_slice_23:0', {'waveform:0': clip, 'keras_learning_phase:0': False})   # drums of Deezer's own graph
db = 20 * np.log10(np.sqrt(np.mean(ref ** 2)) / (np.sqrt(np.mean((ref - mine) ** 2)) + 1e-12))
print('2. whole chain vs Deezer graph: error %.1f dB below the drums' % db)
sys.exit(0 if d < 1e-4 and db > 60 else 1)
