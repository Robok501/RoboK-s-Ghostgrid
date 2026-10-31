import { describe, expect, it } from 'vitest';
import { addSamples, analyze, knn, reclassify, usesOwnSounds, type Samples, type SoundKey } from '../src/voice';
import { SR, track, type SynthKind } from './synth';

// a 16-hit groove with ghost snares (quiet) and open hi-hats
const truth: [SoundKey, number][] = [
  ['bd', 1], ['hh', 1], ['sn', 1], ['hh', 1], ['bd', 1], ['sng', 0.3], ['sn', 1], ['hho', 1],
  ['bd', 1], ['hh', 1], ['sn', 1], ['sng', 0.3], ['bd', 1], ['hh', 1], ['sn', 1], ['hho', 1],
];
const groove = track(truth.map(([k, g]) => [(k === 'sng' ? 'sn' : k) as SynthKind, g]), 0.25);
const correct = (keys: SoundKey[]) => keys.filter((k, i) => truth[i][0] === k).length;

function teach(): Samples {
  let s: Samples = {};
  for (const k of ['bd', 'sn', 'hh', 'hho'] as const) {
    const a = analyze(track(Array.from({ length: 6 }, () => [k as SynthKind, 1] as [SynthKind, number]), 0.4), SR, {});
    s = addSamples(s, k, a.hits.map((h) => h.f.v));
  }
  return s;
}

describe('onset detection', () => {
  it('finds every hit, including soft ghost notes', () => {
    expect(analyze(groove, SR, {}).hits.length).toBe(16);
  });
  it('places hits at the right times', () => {
    const t = analyze(groove, SR, {}).hits.map((h) => h.t);
    t.forEach((v, i) => expect(Math.abs(v - (0.3 + i * 0.25))).toBeLessThan(0.012));
  });
});

describe('recognition', () => {
  it('built-in rules get the kicks but confuse this voice’s snare', () => {
    const keys = analyze(groove, SR, {}).hits.map((h) => h.k);
    expect(keys.filter((k, i) => k === 'bd' && truth[i][0] === 'bd').length).toBe(4);
    expect(correct(keys)).toBeLessThan(16);
  });
  it('taught sounds recognise all 16 hits, with ghost notes from loudness', () => {
    const samples = teach();
    expect(usesOwnSounds(samples)).toBe(true);
    const hits = analyze(groove, SR, samples).hits;
    expect(correct(hits.map((h) => h.k))).toBe(16);
    expect(hits.filter((h) => h.k === 'sng').every((h) => h.cls === 'sn' && h.v === 3)).toBe(true);
    expect(hits.filter((h) => h.k === 'hho').every((h) => h.cls === 'hh' && h.v === 3)).toBe(true);
  });
  it('reclassifies earlier hits after teaching', () => {
    const hits = analyze(groove, SR, {}).hits;
    reclassify(hits, teach());
    expect(correct(hits.map((h) => h.k))).toBe(16);
  });
  it('reports a confidence margin', () => {
    const samples = teach(), h = analyze(groove, SR, samples).hits[0];
    const r = knn(h.f.v, samples);
    expect(r.key).toBe('bd');
    expect(r.margin).toBeGreaterThan(0.5);
  });
  it('needs kick, snare and closed hi-hat before using own sounds', () => {
    const s = teach();
    expect(usesOwnSounds({ bd: s.bd, sn: s.sn })).toBe(false);
  });
});
