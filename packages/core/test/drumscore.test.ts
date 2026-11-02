import { describe, expect, it } from 'vitest';
import { type BeatMap, type Envelope } from '../src/beatmap';
import { drumHits, hitsToIdea, type DrumHit } from '../src/drumscore';
import { ideaToRaw } from '../src/groove';

const RATE = 100;
type K = 'bd' | 'sn' | 'sng' | 'hh' | 'hho';
/** A drum track as band envelopes, with each drum leaking into the other bands like a real kit. */
function kit(pattern: [number, K][], bars: number, bpm = 100, start = 1, beatsPerBar = 4) {
  const beat = 60 / bpm, n = Math.ceil((start + bars * beatsPerBar * beat + 2) * RATE);
  const full = new Float32Array(n), low = new Float32Array(n), mid = new Float32Array(n), high = new Float32Array(n);
  // [low, mid, high] share and decay (frames) per drum
  const S: Record<K, [number, number, number, number, number]> = {
    bd: [0.9, 0.25, 0.05, 0.8, 14], sn: [0.2, 0.8, 0.45, 0.65, 10], sng: [0.2, 0.8, 0.45, 0.18, 8],
    hh: [0.01, 0.08, 0.9, 0.25, 4], hho: [0.01, 0.1, 0.9, 0.3, 30],
  };
  const truth: { beat: number; k: K }[] = [];
  let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let b = 0; b < bars; b++) for (const [x, k] of pattern) {
    const t = start + (b * beatsPerBar + x) * beat + rnd() * 0.012, f0 = Math.round(t * RATE);
    truth.push({ beat: b * beatsPerBar + x, k });
    const [sl, sm, sh, amp, dec] = S[k], g = 1 + rnd() * 0.3;
    for (let d = 0; d < 80 && f0 + d < n; d++) {
      const v = amp * g * Math.exp(-d / dec);
      low[f0 + d] += v * sl; mid[f0 + d] += v * sm; high[f0 + d] += v * sh; full[f0 + d] += v;
    }
  }
  for (let i = 0; i < n; i++) { full[i] += 0.002; low[i] += 0.001; mid[i] += 0.001; high[i] += 0.001; }
  const map: BeatMap = { beats: Array.from({ length: bars * beatsPerBar }, (_, i) => start + i * beat), beatsPerBar, downbeat: 0, bpm };
  return { env: { rate: RATE, full, low, mid, high } as Envelope, truth, map };
}

// beat finding has its own tests: here the beat map is the true one
const score = (env: Envelope, m: BeatMap, from = 0, to = 1e9) => hitsToIdea(drumHits(env), m, from, to, 'Song');
const key = (r: { id: string; v: number }) => (r.id === 'sn' && r.v === 3 ? 'sng' : r.id === 'hh' && r.v === 3 ? 'hho' : r.id);
function compare(raw: { beat: number; id: string; v: number }[], truth: { beat: number; k: K }[]) {
  let right = 0;
  if (process.env.DBG) {
    const miss: Record<string, number> = {}, ext: Record<string, number> = {};
    for (const t of truth) if (!raw.some((r) => Math.abs(r.beat - t.beat) < 0.13 && key(r) === t.k)) miss[t.k] = (miss[t.k] ?? 0) + 1;
    for (const r of raw) if (!truth.some((t) => Math.abs(r.beat - t.beat) < 0.13 && key(r) === t.k)) ext[key(r)] = (ext[key(r)] ?? 0) + 1;
    console.log('MISS', JSON.stringify(miss), 'EXTRA', JSON.stringify(ext), raw.slice(0, 14).map((r) => `${key(r)}@${r.beat.toFixed(2)}`).join(' '));
  }
  for (const t of truth) if (raw.some((r) => Math.abs(r.beat - t.beat) < 0.13 && key(r) === t.k)) right++;
  const extra = raw.filter((r) => !truth.some((t) => Math.abs(r.beat - t.beat) < 0.13 && key(r) === t.k)).length;
  return { right, extra, total: truth.length };
}

describe('drums to score', () => {
  it('a rock groove: kick, snare, hi-hat 8ths', () => {
    const pat: [number, K][] = [[0, 'bd'], [2, 'bd'], [2.5, 'bd'], [1, 'sn'], [3, 'sn'], ...[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((x) => [x, 'hh'] as [number, K])];
    const { env, truth, map } = kit(pat, 8);
    const s = score(env, map);
    expect(s.bars).toBeGreaterThanOrEqual(8);
    const c = compare(ideaToRaw(s.idea), truth);
    expect(c.right / c.total).toBeGreaterThan(0.9);
    expect(c.extra).toBeLessThan(c.total * 0.08);
    expect(s.idea.grid).toBe(2);
  });
  it('16ths with ghost notes and an open hi-hat', () => {
    const pat: [number, K][] = [[0, 'bd'], [1.75, 'bd'], [2.5, 'bd'], [1, 'sn'], [3, 'sn'], [1.5, 'sng'], [3.25, 'sng'],
      ...[0, 0.5, 1, 2, 2.5, 3].map((x) => [x, 'hh'] as [number, K]), [3.5, 'hho']];
    const { env, truth, map } = kit(pat, 8, 92);
    const s = score(env, map);
    const raw = ideaToRaw(s.idea), c = compare(raw, truth);
    expect(c.right / c.total).toBeGreaterThan(0.85);
    expect(s.idea.grid).toBe(4);
    expect(raw.some((r) => r.id === 'sn' && r.v === 3)).toBe(true);
  });
  it('only the bars of a loop, numbered from its first bar', () => {
    const pat: [number, K][] = [[0, 'bd'], [1, 'sn'], [2, 'bd'], [3, 'sn'], [0, 'hh'], [1, 'hh'], [2, 'hh'], [3, 'hh']];
    const { env, map: m } = kit(pat, 12, 120, 1);
    const s = hitsToIdea(drumHits(env), m, 1 + 2 * 4, 1 + 2 * 6, 'Loop'); // bars 5–6 at 120 BPM (2 s per bar)
    expect(s.bars).toBe(2);
    const s2 = hitsToIdea(drumHits(env), m, 1 + 2 * 2 - 0.02, 1 + 2 * 6, 'Loop');
    expect(s2.bars).toBe(4);
    expect(ideaToRaw(s2.idea).filter((r) => r.id === 'bd').map((r) => r.beat).slice(0, 2)).toEqual([0, 2]);
  });

  it('puts the hits in the score grid, not only in the raw notes (a hit is 1; 0 is no note)', () => {
    const beat = 0.6, m: BeatMap = { beats: Array.from({ length: 17 }, (_, i) => 1 + i * beat), beatsPerBar: 4, downbeat: 0, bpm: 100 } as BeatMap;
    const hits: DrumHit[] = [0, 1, 2, 3].map((b) => ({ t: 1 + b * beat, id: b % 2 ? 'sn' : 'bd', v: 1, level: 1 }));
    const s = hitsToIdea(hits, m, 0, 1e9, 'x');
    const bar = s.idea.bars[0].n;
    expect(bar.bd.filter((x) => x > 0).length).toBe(2);
    expect(bar.sn.filter((x) => x > 0).length).toBe(2);
  });
  it('makes normal drum hits 1, never 0', () => {
    const env = kit([[0, 'bd'], [1, 'sn'], [2, 'bd'], [3, 'sn'], ...[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((x) => [x, 'hh'] as [number, K])], 4).env;
    expect(drumHits(env).every((h) => h.v === 1 || h.v === 3)).toBe(true);
  });
});
