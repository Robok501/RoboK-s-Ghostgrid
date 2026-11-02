"""Score detected hits against the truth, per class, at ±50 ms and ±20 ms (mir_eval onset F-measure).
Usage: score.py <dir> <suffix> [<suffix> ...]   e.g. score.py out ours oaf"""
import json, sys
import numpy as np, mir_eval

d, systems = sys.argv[1], sys.argv[2:]
names = json.load(open(f'{d}/index.json'))
CLASSES = ['kick', 'snare', 'hh', 'tom', 'cym']
OURS = {'bd': 'kick', 'sn': 'snare', 'hh': 'hh', 'cr': 'cym', 'rd': 'cym', 't1': 'tom', 't2': 'tom', 'ft': 'tom'}
lines = ['| system | tol | ' + ' | '.join(CLASSES) + ' | all |', '|' + '---|' * (len(CLASSES) + 3)]
for sysname in systems:
    for tol in (0.05, 0.02):
        tot = {c: [0, 0, 0] for c in CLASSES}  # tp, n_ref, n_est
        for n in names:
            truth = json.load(open(f'{d}/{n}.json'))['notes']
            est = json.load(open(f'{d}/{n}.{sysname}.json'))
            for c in CLASSES:
                ref = np.array(sorted({x['t'] for x in truth if (x['cls'] == c or (c == 'hh' and x['cls'] == 'hho'))}))
                if sysname in ('ours', 'app'): e = [h['t'] for h in est if OURS.get(h['id']) == c]
                else: e = [h['t'] for h in est if h['cls'] == c]
                e = np.array(sorted(e))
                tp = len(mir_eval.util.match_events(ref, e, tol)) if len(ref) and len(e) else 0
                tot[c][0] += tp; tot[c][1] += len(ref); tot[c][2] += len(e)
        def f(tp, r, e): return 2 * tp / (r + e) if r + e else float('nan')
        cells = [f'{f(*tot[c]):.2f} ({tot[c][1]})' for c in CLASSES]
        a = [sum(tot[c][i] for c in CLASSES) for i in range(3)]
        lines.append(f'| {sysname} | ±{int(tol*1000)} ms | ' + ' | '.join(cells) + f' | {f(*a):.2f} |')
print('\n'.join(lines))
print('\nF-measure per class (number of true hits in brackets).')
