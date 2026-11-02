"""Render test grooves from the Groove MIDI Dataset (CC BY 4.0) to WAV, with the true hits as JSON.
Usage: render.py <gmd_dir> <out_dir> [n_files] [seconds]"""
import csv, json, os, subprocess, sys
import pretty_midi

# Roland TD-11 / GM drum notes (as used by GMD) -> five classes
CLASS = {}
for p in (35, 36): CLASS[p] = 'kick'
for p in (37, 38, 40): CLASS[p] = 'snare'
for p in (41, 43, 45, 47, 48, 50, 58): CLASS[p] = 'tom'
for p in (22, 42, 44): CLASS[p] = 'hh'
for p in (26, 46): CLASS[p] = 'hho'
for p in (49, 51, 52, 53, 55, 57, 59): CLASS[p] = 'cym'

gmd, out = sys.argv[1], sys.argv[2]
n = int(sys.argv[3]) if len(sys.argv) > 3 else 24
secs = float(sys.argv[4]) if len(sys.argv) > 4 else 30
sf2 = os.environ.get('SF2', '/usr/share/sounds/sf2/FluidR3_GM.sf2')
os.makedirs(out, exist_ok=True)
rows = [r for r in csv.DictReader(open(os.path.join(gmd, 'info.csv')))
        if r['split'] == 'test' and r['beat_type'] == 'beat' and r['time_signature'] == '4-4' and float(r['duration']) > secs]
rows = rows[:: max(1, len(rows) // n)][:n]
index = []
for r in rows:
    pm = pretty_midi.PrettyMIDI(os.path.join(gmd, r['midi_filename']))
    name = r['id'].replace('/', '_')
    notes = []
    for inst in pm.instruments:
        inst.is_drum = True
        inst.notes = [x for x in inst.notes if x.start < secs]
        for x in inst.notes:
            notes.append({'t': round(x.start, 4), 'pitch': x.pitch, 'vel': x.velocity, 'cls': CLASS.get(x.pitch, 'other')})
    mid = os.path.join(out, name + '.mid'); pm.write(mid)
    wav = os.path.join(out, name + '.wav')
    subprocess.run(['fluidsynth', '-ni', '-g', '0.8', '-r', '44100', '-F', wav, sf2, mid], check=True, capture_output=True)
    json.dump({'bpm': float(r['bpm']), 'style': r['style'], 'drummer': r['drummer'], 'notes': sorted(notes, key=lambda x: x['t'])},
              open(os.path.join(out, name + '.json'), 'w'))
    index.append(name)
    print(name, r['style'], r['bpm'], len(notes), 'notes')
json.dump(index, open(os.path.join(out, 'index.json'), 'w'))
