"""Write <name>.beats.json (true beats and downbeats) for a lab folder.
gmd <dir>: from the rendered MIDI files (tempo and 4/4 from the Groove MIDI Dataset).
ballroom <data_dir> <annot_dir> <out_dir> [per_genre]: copy a sample of Ballroom clips with their annotations."""
import glob, json, os, shutil, sys
import soundfile as sf

if sys.argv[1] == 'gmd':
    import pretty_midi
    d = sys.argv[2]
    for n in json.load(open(f'{d}/index.json')):
        pm = pretty_midi.PrettyMIDI(f'{d}/{n}.mid')
        end = sf.info(f'{d}/{n}.wav').duration
        beats = [float(t) for t in pm.get_beats() if t < end - 0.5]
        downs = [float(t) for t in pm.get_downbeats() if t < end - 0.5]
        json.dump({'beats': beats, 'downbeats': downs}, open(f'{d}/{n}.beats.json', 'w'))
else:
    data, ann, out = sys.argv[2], sys.argv[3], sys.argv[4]
    per = int(sys.argv[5]) if len(sys.argv) > 5 else 10
    os.makedirs(out, exist_ok=True); index = []
    for g in sorted(os.listdir(data)):
        files = sorted(glob.glob(f'{data}/{g}/*.wav'))
        for f in files[:: max(1, len(files) // per)][:per]:
            base = os.path.splitext(os.path.basename(f))[0]
            a = f'{ann}/{base}.beats'
            if not os.path.exists(a): continue
            rows = [l.split() for l in open(a) if l.strip()]
            beats = [float(r[0]) for r in rows]
            downs = [float(r[0]) for r in rows if len(r) > 1 and int(float(r[1])) == 1]
            name = f'{g}_{base}'
            shutil.copy(f, f'{out}/{name}.wav')
            json.dump({'beats': beats, 'downbeats': downs, 'genre': g}, open(f'{out}/{name}.beats.json', 'w'))
            index.append(name)
    json.dump(index, open(f'{out}/index.json', 'w'))
    print(len(index), 'Ballroom clips')
