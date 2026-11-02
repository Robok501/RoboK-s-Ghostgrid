import { describe, expect, it } from 'vitest';
import {
  barAt, barStarts, barsFrom, beatMap, clickTimes, doubleTime, halfTime, offsetToBeat, setDownbeatAt, shiftDownbeat, snapToBar,
  type Envelope,
} from '../src/beatmap';

const RATE = 100;
/** A drum track as envelopes: kick on 1 and 3, snare on 2 and 4, hi-hat 8ths. `drift` = BPM change per bar. */
function drums(bpm: number, bars: number, opts: { drift?: number; start?: number; jitter?: number; beatsPerBar?: number } = {}) {
  const bpb = opts.beatsPerBar ?? 4;
  const events: { t: number; k: 'bd' | 'sn' | 'hh' }[] = [];
  const beats: number[] = [];
  let t = opts.start ?? 1.0, tempo = bpm, seed = 9;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let bar = 0; bar < bars; bar++) {
    for (let q = 0; q < bpb; q++) {
      const len = 60 / tempo, j = (opts.jitter ?? 0) * rnd();
      beats.push(t);
      events.push({ t: t + j, k: q === 0 || (bpb === 4 && q === 2) ? 'bd' : 'sn' });
      events.push({ t: t + j, k: 'hh' }, { t: t + len / 2 + j, k: 'hh' });
      t += len;
    }
    tempo += opts.drift ?? 0;
  }
  const n = Math.ceil((t + 2) * RATE), full = new Float32Array(n), low = new Float32Array(n);
  for (const e of events) {
    const f0 = Math.round(e.t * RATE);
    const amp = e.k === 'bd' ? 0.8 : e.k === 'sn' ? 0.6 : 0.15, dec = e.k === 'hh' ? 4 : 12;
    for (let d = 0; d < 40 && f0 + d < n; d++) {
      const v = amp * Math.exp(-d / dec);
      full[f0 + d] += v;
      if (e.k === 'bd') low[f0 + d] += v * 0.9;
      if (e.k === 'sn') low[f0 + d] += v * 0.08;
    }
  }
  for (let i = 0; i < n; i++) { full[i] += 0.002; low[i] += 0.001; }
  return { env: { rate: RATE, full, low } as Envelope, beats };
}

const near = (found: number[], truth: number[], tol = 0.03) => truth.filter((t) => found.some((f) => Math.abs(f - t) <= tol)).length / truth.length;

describe('beat map', () => {
  it('finds the tempo and every beat of a steady groove', () => {
    const { env, beats } = drums(100, 16);
    const m = beatMap(env);
    expect(m.bpm).toBeGreaterThan(98); expect(m.bpm).toBeLessThan(102);
    expect(near(m.beats, beats)).toBeGreaterThan(0.95);
  });
  it('finds the "1" from the kick', () => {
    const { env, beats } = drums(120, 12, { start: 1.0 });
    const m = beatMap(env);
    const first = barStarts(m)[0];
    expect(Math.abs(((first - beats[0]) / (60 / 120)) % 4)).toBeLessThan(0.1);
  });
  it('follows a band that speeds up', () => {
    const { env, beats } = drums(96, 20, { drift: 1 });
    expect(near(beatMap(env).beats, beats)).toBeGreaterThan(0.9);
  });
  it('copes with a loose human feel', () => {
    const { env, beats } = drums(110, 16, { jitter: 0.02 });
    expect(near(beatMap(env).beats, beats, 0.04)).toBeGreaterThan(0.9);
  });
  it('handles fast and slow songs', () => {
    for (const bpm of [70, 150, 175]) {
      const { env } = drums(bpm, 16);
      const m = beatMap(env);
      const ok = [bpm, bpm / 2, bpm * 2].some((b) => Math.abs(m.bpm - b) / b < 0.03);
      expect(ok, `${bpm} → ${m.bpm}`).toBe(true);
    }
  });
});

describe('using the map', () => {
  const m = { beats: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5], beatsPerBar: 4, downbeat: 0, bpm: 120 };
  it('bars, snapping and loops by bar count', () => {
    expect(barStarts(m)).toEqual([1, 3, 5]);
    expect(barAt(m, 3.2)).toBe(1);
    expect(barAt(m, 0.5)).toBe(-1);
    expect(snapToBar(m, 2.2)).toBe(3);
    expect(barsFrom(m, 1, 1, 10)).toBe(3);
    expect(barsFrom(m, 3, 2, 10)).toBeCloseTo(5.5);
  });
  it('clicks with an accent on the 1', () => {
    expect(clickTimes(m).filter((c) => c.accent).map((c) => c.t)).toEqual([1, 3, 5]);
  });
  it('scores hits against the beats and their subdivisions', () => {
    expect(offsetToBeat(m, 2.02)).toBeCloseTo(20);
    expect(offsetToBeat(m, 1.49)).toBeCloseTo(-10);
    expect(offsetToBeat(m, 1.26, 2)).toBeCloseTo(10);
    expect(offsetToBeat(m, 0.0)).toBeNull();
  });
  it('can be corrected by hand', () => {
    expect(barStarts(shiftDownbeat(m))).toEqual([1.5, 3.5]);
    expect(barStarts(setDownbeatAt(m, 2.05))).toEqual([2, 4]);
    expect(halfTime(m).beats).toEqual([1, 2, 3, 4, 5]);
    expect(doubleTime(m).beats.length).toBe(17);
  });
});

describe('finding the "1" from the music', () => {
  it('uses chord changes and the bass, even when the kick suggests another beat', async () => {
    const { musicPhaseScores, beatMap: bm } = await import('../src/beatmap');
    // drums whose kick pattern points at beat 3, music whose chords change on beat 1 of each bar
    const bpm = 100, beat = 60 / bpm, bars = 16, start = 1;
    const { env } = drums(bpm, bars, { start });
    const rate = 10, n = Math.ceil((start + bars * 4 * beat + 2) * rate);
    const chroma = new Float32Array(n * 12), bass = new Float32Array(n);
    const chords = [[0, 4, 7], [5, 9, 0], [7, 11, 2], [9, 0, 4]];
    for (let f = 0; f < n; f++) {
      const t = f / rate - start;
      if (t < 0) continue;
      const bar = Math.floor(t / (4 * beat)), inBar = t - bar * 4 * beat;
      for (const pc of chords[bar % 4]) chroma[f * 12 + pc] = 1;
      bass[f] = inBar < beat ? 1 : 0.3; // a new bass note on the 1, held softer afterwards
    }
    const music = { rate, chroma, bass };
    const m = bm(env, 4, music);
    const first = barStarts(m)[0];
    expect(Math.abs(((first - start) / beat) % 4)).toBeLessThan(0.1);
    // shifting the music by two beats moves the "1" with it
    const shifted = new Float32Array(n * 12), sb = new Float32Array(n), sh = Math.round(2 * beat * rate);
    for (let f = 0; f < n; f++) { const g = Math.max(0, f - sh); for (let k = 0; k < 12; k++) shifted[f * 12 + k] = chroma[g * 12 + k]; sb[f] = bass[g]; }
    const m2 = bm(env, 4, { rate, chroma: shifted, bass: sb });
    expect(Math.round((barStarts(m2)[0] - start) / beat) % 4).toBe(2);
    expect(musicPhaseScores(music, m.beats, 4).length).toBe(4);
  });
});
