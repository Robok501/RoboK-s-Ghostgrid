"""Build test songs with known stems: Groove MIDI drums (rendered by render.py) plus a generated band
(piano chords, bass, strummed guitar from MIDI, rendered with the same soundfont), mixed at random levels.
Writes <name>.mix.wav, <name>.drums.wav and <name>.rest.wav (the exact components of the mix) and index.json.
Usage: sep_mix.py <dir with render.py output> [seed]
Caveat: both parts are General MIDI synthesis, so this measures separation on clean, unprocessed sounds, not on mastered records."""
import json, os, subprocess, sys
import numpy as np, pretty_midi, soundfile as sf

d = sys.argv[1]; rng = np.random.RandomState(int(sys.argv[2]) if len(sys.argv) > 2 else 7)
sf2 = os.environ.get('SF2', '/usr/share/sounds/sf2/FluidR3_GM.sf2')
MAJ, MIN = [0, 4, 7], [0, 3, 7]
PROG = [(0, MAJ), (7, MAJ), (9, MIN), (5, MAJ)]            # I V vi IV (semitones above the key)
index = []
for name in json.load(open(f'{d}/index.json')):
    info = json.load(open(f'{d}/{name}.json')); bpm = float(info['bpm'])
    drums, sr = sf.read(f'{d}/{name}.wav', dtype='float32')
    secs = len(drums) / sr; key = 40 + int(rng.randint(0, 12)); beat = 60 / bpm
    pm = pretty_midi.PrettyMIDI(initial_tempo=bpm)
    piano, bass, gtr = (pretty_midi.Instrument(p) for p in (0, 33, 25))
    t, bar = 0.0, 0
    while t < secs:
        root, kind = PROG[bar % 4]
        for k in kind: piano.notes.append(pretty_midi.Note(70, key + 12 + root + k, t, t + 4 * beat * 0.95))
        for b in (0, 2): bass.notes.append(pretty_midi.Note(85, key - 12 + root, t + b * beat, t + (b + 1.8) * beat))
        for e in range(8):
            for k in kind: gtr.notes.append(pretty_midi.Note(60 + 15 * (e % 2 == 0), key + root + k + 12, t + e * beat / 2, t + e * beat / 2 + beat * 0.45))
        t += 4 * beat; bar += 1
    for ins in (piano, bass, gtr): pm.instruments.append(ins)
    mid = f'{d}/{name}.music.mid'; pm.write(mid)
    subprocess.run(['fluidsynth', '-ni', '-g', '0.6', '-r', str(sr), '-F', f'{d}/{name}.music.wav', sf2, mid], check=True, capture_output=True)
    music, _ = sf.read(f'{d}/{name}.music.wav', dtype='float32')
    n = min(len(drums), len(music)); drums, music = drums[:n], music[:n]
    if drums.ndim == 1: drums = np.stack([drums, drums], 1)
    if music.ndim == 1: music = np.stack([music, music], 1)
    # drums between 6 dB under and 3 dB over the band, then everything scaled to a safe peak
    rms = lambda a: float(np.sqrt(np.mean(a ** 2)) + 1e-9)
    g = rms(music) / rms(drums) * 10 ** (rng.uniform(-6, 3) / 20)
    dr, mu = drums * g, music
    peak = max(np.abs(dr + mu).max(), 1e-6); s = 0.9 / peak
    dr, mu = dr * s, mu * s
    sf.write(f'{d}/{name}.drums.wav', dr, sr, subtype='FLOAT'); sf.write(f'{d}/{name}.rest.wav', mu, sr, subtype='FLOAT')
    sf.write(f'{d}/{name}.mix.wav', dr + mu, sr, subtype='FLOAT')
    index.append(name)
json.dump(index, open(f'{d}/index.json', 'w'))
print(len(index), 'test songs')
