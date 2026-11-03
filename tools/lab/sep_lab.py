"""Score drum separators on songs with known stems (made by sep_mix.py).
Systems: demucs (the app's HT-Demucs drums ONNX, same segmenting as GGStems.separate) and spleeter (spleeter_ref.py, the algorithm of
GGSpleeter.swift). For each: SDR and SI-SDR of the drums, and of the rest (= mix minus the estimated drums), plus the time taken.
Spleeter is also scored with the tweaks of spleeter_ref.render (mask power, high-band restore, gate), one network pass per song.
Every variant's drum stem is also written to <dir>/v/<variant>/<name>.wav (with the true hits as <name>.json), so oaf_run.py + score.py can
measure what the notation recogniser makes of it. "truth" (the real drums) is the ceiling, "mix" (no separation) the floor.
Usage: sep_lab.py <dir> [demucs.onnx|-] [spleeter_drums.onnx|-]"""
import json, sys, time
import numpy as np, onnxruntime as ort, soundfile as sf
sys.path.insert(0, __import__('os').path.join(__import__('os').path.dirname(__file__), '..', 'spleeter'))
from spleeter_ref import analyse as spleeter_analyse, render as spleeter_render

d = sys.argv[1]
demucs_path = sys.argv[2] if len(sys.argv) > 2 else '-'; spl_path = sys.argv[3] if len(sys.argv) > 3 else '-'

def demucs_drums(x, sess):
    """x [n,2] -> drums [n,2]; the segmenting of GGStems.separate: 343980-sample segments, 25 % overlap, triangular weights."""
    n = len(x); L = 343980; stride = L * 3 // 4
    m = x.mean(1); mean, std = float(m.mean()), max(1e-5, float(m.std()))
    w = np.minimum(np.arange(1, L + 1), np.arange(L, 0, -1)).astype(np.float64)
    acc = np.zeros((n, 2)); ws = np.zeros(n)
    starts = [0] if stride >= n else list(range(0, n, stride))
    name = sess.get_inputs()[0].name
    for s in starts:
        ln = min(L, n - s); seg = np.zeros((1, 2, L), np.float32)
        seg[0, :, :ln] = ((x[s:s + ln] - mean) / std).T
        o = sess.run(None, {name: seg})[0]                     # (1, sources, 2, L); drums are source 0
        e = o[0, 0, :, :ln].T * std
        acc[s:s + ln] += e * w[:ln, None]; ws[s:s + ln] += w[:ln]
    return acc / np.maximum(ws, 1e-12)[:, None]

def sdr(t, e): return 10 * np.log10((t ** 2).sum() / (((t - e) ** 2).sum() + 1e-12) + 1e-12)
def si_sdr(t, e):
    a = (e * t).sum() / ((t ** 2).sum() + 1e-12)
    return 10 * np.log10(((a * t) ** 2).sum() / (((a * t - e) ** 2).sum() + 1e-12) + 1e-12)

SPL = {  # name -> tweaks
    'spleeter': {},
    'spl p1.5': dict(power=1.5), 'spl p2': dict(power=2.0),
    'spl hi.5': dict(hi=0.5), 'spl hi1': dict(hi=1.0),
    'spl gate40': dict(gate=40), 'spl gate30': dict(gate=30),
    'spl p1.5+hi1': dict(power=1.5, hi=1.0), 'spl p1.5+hi1+gate40': dict(power=1.5, hi=1.0, gate=40),
}
import os, shutil
dsess = ort.InferenceSession(demucs_path, providers=['CPUExecutionProvider']) if demucs_path != '-' else None
ssess = ort.InferenceSession(spl_path, providers=['CPUExecutionProvider']) if spl_path != '-' else None
names = json.load(open(f'{d}/index.json'))
order = (['demucs'] if dsess else []) + (list(SPL) if ssess else []) + ['mix']
res = {k: {'dr_sdr': [], 'dr_si': [], 'rest_sdr': [], 'rest_si': [], 'sec': []} for k in order}
for k in order + ['truth']:
    os.makedirs(f'{d}/v/{k}', exist_ok=True)
    shutil.copy(f'{d}/index.json', f'{d}/v/{k}/index.json')
for n in names:
    mix, sr = sf.read(f'{d}/{n}.mix.wav', dtype='float64'); td, _ = sf.read(f'{d}/{n}.drums.wav', dtype='float64'); tr, _ = sf.read(f'{d}/{n}.rest.wav', dtype='float64')
    ests = {}
    if dsess:
        t0 = time.time(); ests['demucs'] = (demucs_drums(mix, dsess), time.time() - t0)
    if ssess:
        t0 = time.time(); X, mask = spleeter_analyse(mix, ssess); base = time.time() - t0
        for k, o in SPL.items():
            t1 = time.time(); e = spleeter_render(X, mask, len(mix), **o); ests[k] = (e, base + time.time() - t1)
    ests['mix'] = (mix, 0.0)
    for k, (est, sec) in ests.items():
        r = res[k]; r['sec'].append(sec)
        r['dr_sdr'].append(sdr(td, est)); r['dr_si'].append(si_sdr(td, est))
        r['rest_sdr'].append(sdr(tr, mix - est)); r['rest_si'].append(si_sdr(tr, mix - est))
    for k, est in [(k, v[0]) for k, v in ests.items()] + [('truth', td)]:
        sf.write(f'{d}/v/{k}/{n}.wav', est.astype(np.float32), sr)
    for k in order + ['truth']: shutil.copy(f'{d}/{n}.json', f'{d}/v/{k}/{n}.json')
    print(n, {k: round(res[k]['dr_si'][-1], 1) for k in order}, flush=True)
dur = np.mean([sf.info(f'{d}/{n}.mix.wav').duration for n in names])
print(f'\n### Drum separation on {len(names)} songs with known stems (mean over songs, dB; higher is better)\n')
print('| system | drums SI-SDR | drums SDR | rest SI-SDR | rest SDR | time per song |\n|---|---|---|---|---|---|')
for k in order:
    r = res[k]; f = lambda a: f'{np.mean(a):.1f}'
    print(f'| {k} | {f(r["dr_si"])} | {f(r["dr_sdr"])} | {f(r["rest_si"])} | {f(r["rest_sdr"])} | {np.mean(r["sec"]):.1f} s (song {dur:.0f} s) |')
print('\n"rest" is the song without drums = mix minus the estimated drums. "mix" = no separation (the floor). The test songs are General MIDI synthesis '
      '(Groove MIDI drums and a generated piano/bass/guitar band), so this shows separation on clean sounds; real records are harder. '
      'Time is on a CI CPU, not a phone; for the spleeter variants it is the network pass plus the tweak.')
