"""Hybrid: the model for kick, snare, toms and cymbals; our detector for hi-hat. Usage: hybrid.py <dir> <oaf suffix>"""
import json, sys
d, sfx = sys.argv[1], sys.argv[2]
for n in json.load(open(f'{d}/index.json')):
    oaf = [h for h in json.load(open(f'{d}/{n}.{sfx}.json')) if h['cls'] != 'hh']
    ours = [{'t': h['t'], 'cls': 'hh'} for h in json.load(open(f'{d}/{n}.ours.json')) if h['id'] == 'hh']
    json.dump(oaf + ours, open(f'{d}/{n}.hybrid.json', 'w'))
