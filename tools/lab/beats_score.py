"""Score beat maps against the truth. Usage: beats_score.py <dir> <label> <suffix> [...]
Per system: beat F-measure (±70 ms), downbeat F-measure, and per song what went wrong:
tempo (right / double / half / other), beat phase (on the beat / half a beat off), and where the "1" landed."""
import json, sys
import numpy as np, mir_eval

d, label, systems = sys.argv[1], sys.argv[2], sys.argv[3:]
names = json.load(open(f'{d}/index.json'))

def near(est, ref, tol=0.07):
    return np.array([np.min(np.abs(ref - t)) <= tol for t in est]) if len(est) and len(ref) else np.array([])

def diagnose(ref_b, ref_d, est_b, est_d):
    ri, ei = np.median(np.diff(ref_b)), np.median(np.diff(est_b)) if len(est_b) > 1 else np.inf
    r = ri / ei
    tempo = 'right' if abs(r - 1) < 0.08 else 'double' if abs(r - 2) < 0.15 else 'half' if abs(r - 0.5) < 0.05 else 'other'
    mids = (ref_b[1:] + ref_b[:-1]) / 2
    on, off = near(est_b, ref_b).mean() if len(est_b) else 0, near(est_b, mids).mean() if len(est_b) else 0
    phase = 'on' if on >= 0.6 else 'half-off' if off >= 0.6 else 'unsteady'
    # where do the estimated 1s fall in the true bar? (0 = right)
    places = []
    bpb = int(round(np.median(np.diff(ref_d)) / ri)) if len(ref_d) > 1 else 4
    for t in est_d:
        i = int(np.argmin(np.abs(ref_b - t)))
        if abs(ref_b[i] - t) > 0.07: continue
        prev = ref_d[ref_d <= ref_b[i] + 1e-3]
        if not len(prev): continue
        places.append(int(round((ref_b[i] - prev[-1]) / ri)) % max(1, bpb))
    one = 'right' if places and np.mean(np.array(places) == 0) >= 0.6 else (f'on {np.bincount(places).argmax() + 1}' if places else '-')
    return tempo, phase, one

print(f'### {label}\n')
print('| system | beat F | downbeat F | tempo right | on the beat | "1" right |')
print('|---|---|---|---|---|---|')
rows = {}
for sname in systems:
    bf, df, diag = [], [], []
    for n in names:
        t = json.load(open(f'{d}/{n}.beats.json')); e = json.load(open(f'{d}/{n}.{sname}.json'))
        rb, rd = np.array(t['beats']), np.array(t['downbeats'])
        eb, ed = np.array(e['beats']), np.array(e['downbeats'])
        bf.append(mir_eval.beat.f_measure(mir_eval.beat.trim_beats(rb), mir_eval.beat.trim_beats(eb)))
        df.append(mir_eval.beat.f_measure(mir_eval.beat.trim_beats(rd), mir_eval.beat.trim_beats(ed)) if len(rd) else np.nan)
        diag.append(diagnose(rb, rd, eb, ed))
    rows[sname] = diag
    pc = lambda k, v: f'{100 * np.mean([x[k] == v for x in diag]):.0f}%'
    print(f'| {sname} | {np.mean(bf):.2f} | {np.nanmean(df):.2f} | {pc(0, "right")} | {pc(1, "on")} | {pc(2, "right")} |')
print(f'\n{len(names)} pieces.\n')
for sname, diag in rows.items():
    bad = [(n, *x) for n, x in zip(names, diag) if x != ('right', 'on', 'right')]
    print(f'<details><summary>{sname}: {len(bad)} pieces with a problem</summary>\n')
    for b in bad: print(f'- {b[0]}: tempo {b[1]}, phase {b[2]}, "1" {b[3]}')
    print('\n</details>\n')
