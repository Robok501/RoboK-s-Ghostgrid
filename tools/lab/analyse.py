"""What does a system output near the true hits of each class? Usage: analyse.py <dir> <suffix>"""
import json, sys, collections
d, sfx = sys.argv[1], sys.argv[2]
names = json.load(open(f'{d}/index.json'))
ests = collections.Counter(); conf = collections.defaultdict(collections.Counter); pitches = collections.Counter()
for n in names:
    tr = json.load(open(f'{d}/{n}.json'))['notes']; est = json.load(open(f'{d}/{n}.{sfx}.json'))
    for e in est: ests[e.get('cls', e.get('id'))] += 1
    for x in tr:
        pitches[(x['pitch'], x['cls'])] += 1
        near = sorted({e.get('cls', e.get('id')) for e in est if abs(e['t'] - x['t']) < 0.03})
        conf[x['cls']]['+'.join(near) or 'none'] += 1
print(sfx, 'output counts', dict(ests))
print('true notes by pitch', pitches.most_common(16))
for c, cnt in conf.items(): print(f'true {c:6s} ->', cnt.most_common(6))
