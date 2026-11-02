/**
 * Drums to score: the separated drum track of a song becomes a Sketch idea.
 *  1. Hits: rises in three bands of the drum track (low = kick, mid = snare, high = hi-hat and cymbals).
 *     Every drum leaks into the other bands (a kick's beater click reaches the mid band, snare wires the highs),
 *     so a hit that shows in two bands is judged by how its bands compare with this song's own clear kicks
 *     and snares, not by fixed levels.
 *  2. Place: each hit gets its position from the song's beat map (bar, beat, and how far into the beat).
 *  3. Grid: per bar the coarsest grid that fits (8ths, 16ths or triplets), as in MIDI import; the exact positions
 *     stay with the idea, so the grid can still be changed afterwards.
 * Kick, snare (with ghost notes), hi-hat (open when it rings) and crash. Toms are not told apart yet.
 */
import type { Envelope, BeatMap } from './beatmap';
import { barStarts, placeOf } from './beatmap';
import { MAX_BARS, newId, withRaw, type Grid, type Idea, type InstrumentId, type NoteState, type RawNote } from './groove';
import { suggestGrid } from './midiimport';

export interface DrumHit { t: number; id: 'bd' | 'sn' | 'hh' | 'cr'; v: NoteState; level: number }

const pct = (xs: ArrayLike<number>, q: number) => {
  const s = Array.from(xs).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};
const median = (xs: number[]) => pct(xs, 0.5);

interface Onset { f: number; peak: number }

/** Attacks in one band: a clear rise (≥ 5 dB above the last 30 ms) to a level that counts for this song. */
function bandOnsets(b: ArrayLike<number>, rate: number): Onset[] {
  const ref = pct(b, 0.99) || 1e-6, floor = ref * 0.012, min = ref * 0.06;
  const gap = Math.round(rate * 0.05), out: Onset[] = [];
  const db = (i: number) => {
    let lo = Infinity;
    for (let k = 1; k <= 3; k++) if (i - k >= 0) lo = Math.min(lo, b[i - k]);
    return 20 * Math.log10((b[i] + floor) / ((isFinite(lo) ? lo : b[i]) + floor));
  };
  for (let i = 1; i < b.length; i++) {
    const r = db(i);
    if (r < 5) continue;
    let peak = 0;
    for (let k = 0; k < 4 && i + k < b.length; k++) peak = Math.max(peak, b[i + k]);
    if (peak < min) continue;
    const last = out[out.length - 1];
    if (last && i - last.f < gap) { if (peak > last.peak * 1.3 && i - last.f > 2) out[out.length - 1] = { f: i, peak }; continue; }
    out.push({ f: i, peak: peak / ref });
  }
  return out;
}

/** How long a band keeps ringing after frame f (seconds until it falls below 30 % of its peak). */
function ring(b: ArrayLike<number>, f: number, rate: number): number {
  let pk = 0, pi = f;
  for (let k = 0; k < 4 && f + k < b.length; k++) if (b[f + k] > pk) { pk = b[f + k]; pi = f + k; }
  let j = pi;
  while (j < b.length && j - pi < rate && b[j] > pk * 0.3) j++;
  return (j - pi) / rate;
}

/** Find kick, snare, hi-hat and crash hits in a drum track's band envelopes. */
export function drumHits(env: Envelope): DrumHit[] {
  const rate = env.rate, low = env.low, mid = env.mid ?? env.full, high = env.high ?? env.full;
  // level of an attack: how far the band rises above what was already sounding (a tail doesn't count),
  // relative to this song's loud end of that band
  const lev = (b: ArrayLike<number>) => {
    const ref = pct(b, 0.99) || 1e-6;
    return (f: number) => {
      let m = 0, before = Infinity;
      for (let k = 0; k < 4 && f + k < b.length; k++) m = Math.max(m, b[f + k]);
      for (let k = 1; k <= 3; k++) if (f - k >= 0) before = Math.min(before, b[f - k]);
      return Math.max(0, m - (isFinite(before) ? before : 0)) / ref;
    };
  };
  const L = lev(low), M = lev(mid), H = lev(high);
  // events: attacks in the low or mid band, merged when within 30 ms
  const near = Math.round(rate * 0.03);
  const evs: { f: number; l: number; m: number; h: number }[] = [];
  for (const o of [...bandOnsets(low, rate), ...bandOnsets(mid, rate)].sort((a, b) => a.f - b.f)) {
    const last = evs[evs.length - 1];
    if (last && o.f - last.f <= near) continue;
    evs.push({ f: o.f, l: L(o.f), m: M(o.f), h: H(o.f) });
  }
  const lr = (e: { l: number; m: number }) => Math.log((e.m + 1e-3) / (e.l + 1e-3));
  // this song's reference kick and snare: the loudest low-band events, and the loudest events clearly brighter
  const byLow = evs.slice().sort((a, b) => b.l - a.l).slice(0, Math.max(3, evs.length >> 2));
  const refK = median(byLow.map(lr));
  const snareish = evs.filter((e) => lr(e) > refK + 0.7).sort((a, b) => b.m - a.m);
  const refS = snareish.length >= 3 ? median(snareish.slice(0, Math.max(3, snareish.length >> 1)).map(lr)) : refK + 1.5;
  const mid0 = (refK + refS) / 2;
  const hits: DrumHit[] = [];
  for (const e of evs) {
    const r = lr(e), t = e.f / rate;
    const kick = r < mid0 ? e.l > 0.12 : e.l > 0.25 && Math.log((e.l + 1e-3) / (e.m + 1e-3)) > -refS + 1.2;
    const snare = r >= mid0 ? e.m > 0.08 : e.m > 0.3 && r > refK + 1.2;
    if (kick) hits.push({ t, id: 'bd', v: 0, level: e.l });
    if (snare) hits.push({ t, id: 'sn', v: 0, level: e.m });
  }
  // hi-hat and cymbals: attacks in the high band, unless they are just a snare's wires
  const snares = hits.filter((h) => h.id === 'sn');
  // a snare's wires: its usual brightness in this song, but never taken brighter than about a third of its body
  // (when every snare comes with a hi-hat, the measured value would hide those hi-hats)
  const hr = Math.min(-0.6, snares.length ? median(snares.map((s) => Math.log((H(Math.round(s.t * rate)) + 1e-3) / (M(Math.round(s.t * rate)) + 1e-3)))) : 0);
  const kicks = hits.filter((h) => h.id === 'bd');
  const highs = bandOnsets(high, rate).map((o) => ({ f: o.f, t: o.f / rate, h: H(o.f), m: M(o.f) }));
  const with_ = (list: DrumHit[], t: number) => list.some((x) => Math.abs(x.t - t) <= 0.03);
  // a plain hi-hat in this song: high attacks with no kick or snare under them
  const alone = highs.filter((o) => !with_(kicks, o.t) && !with_(snares, o.t)).map((o) => o.h);
  const hat = median(alone.length >= 4 ? alone : highs.map((o) => o.h));
  const cyms: DrumHit[] = [];
  for (const { f, t, h, m } of highs) {
    const withSnare = with_(snares, t), withKick = with_(kicks, t);
    if (withSnare && Math.log((h + 1e-3) / (m + 1e-3)) < hr + 0.4) continue;
    // a kick's beater click reaching the highs: far softer than a real hi-hat
    if (withKick && !withSnare && h < hat * 0.3) continue;
    if (h < 0.04) continue;
    const rg = ring(high, f, rate);
    cyms.push({ t, id: rg > 0.6 && h > 0.5 ? 'cr' : 'hh', v: rg > 0.22 && rg <= 0.6 ? 3 : 0, level: h });
  }
  // ghost snares: much softer than this song's normal snare
  const sl = median(snares.map((s) => s.level));
  for (const s of snares) if (s.level < sl * 0.4) s.v = 3;
  return [...hits, ...cyms].sort((a, b) => a.t - b.t);
}

export interface DrumScore { idea: Idea; notes: number; bars: number; truncated: boolean }

/**
 * Turn hits into an idea for the bars from `from` to `to` (seconds; whole bars, starting at the bar line at or
 * just before `from`). At most 64 bars.
 */
export function hitsToIdea(hits: DrumHit[], m: BeatMap, from: number, to: number, name: string): DrumScore {
  const bars = barStarts(m), bpb = m.beatsPerBar;
  let first = 0;
  for (let i = 0; i < bars.length; i++) if (bars[i] <= from + 0.05) first = i;
  let last = bars.length;
  for (let i = first + 1; i < bars.length; i++) if (bars[i] >= to - 0.05) { last = i; break; }
  const truncated = last - first > MAX_BARS;
  last = Math.min(last, first + MAX_BARS);
  const t0 = bars[first] ?? 0, tEnd = bars[last] ?? (m.beats[m.beats.length - 1] ?? 0) + 60 / (m.bpm || 120);
  const firstBeat = m.beats.findIndex((b) => Math.abs(b - t0) < 1e-6);
  const raw: RawNote[] = [];
  const step = (60 / (m.bpm || 120)) / 8; // a 32nd: hits a hair early still belong to this bar
  for (const h of hits) {
    if (h.t < t0 - step || h.t >= tEnd - step) continue;
    // the beat this hit is in, and how far into it
    let i = firstBeat;
    while (i + 1 < m.beats.length && m.beats[i + 1] <= h.t) i++;
    const len = i + 1 < m.beats.length ? m.beats[i + 1] - m.beats[i] : m.beats[i] - m.beats[i - 1];
    let bar = 0;
    for (let j = firstBeat + 1; j <= i; j++) if (placeOf(m, j) === 0) bar++;
    const beat = Math.max(0, bar * bpb + placeOf(m, i) + (h.t - m.beats[i]) / len);
    raw.push({ beat, id: h.id as InstrumentId, v: h.v });
  }
  const nb = Math.max(1, last - first);
  const perBar = Array.from({ length: nb }, (_, b) => {
    const inBar = raw.filter((r) => r.beat >= b * bpb - 0.1 && r.beat < (b + 1) * bpb - 0.1).map((r) => r.beat - b * bpb);
    return inBar.length >= 2 ? suggestGrid(inBar) : null;
  });
  const votes = new Map<Grid, number>();
  for (const g of perBar) if (g) votes.set(g, (votes.get(g) ?? 0) + 1);
  const pref: Record<Grid, number> = { 2: 0, 4: 1, 3: 2 };
  const grid: Grid = [...votes.entries()].sort((x, y) => y[1] - x[1] || pref[x[0]] - pref[y[0]])[0]?.[0] ?? 4;
  const base: Idea = { id: newId(), name, bpm: Math.round(m.bpm || 100), beats: bpb, grid, swing: 0, bars: [] };
  base.bars = perBar.map((g) => ({ n: {} as Idea['bars'][number]['n'], ...(g && g !== grid ? { grid: g } : {}) }));
  const idea = withRaw(base, raw, nb);
  return { idea: { ...idea, rows: undefined }, notes: raw.length, bars: nb, truncated };
}
