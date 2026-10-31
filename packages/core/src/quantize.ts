/** Quantize: place timed hits on the grid of an idea, and guess the tempo of a recording. */
import { INSTRUMENTS, MAX_BARS, emptyBar, steps, type Grid, type Idea, type InstrumentId, type NoteState } from './groove';

export interface TimedHit { t: number; cls: InstrumentId; v?: NoteState; acc?: boolean }

/**
 * Guess the tempo (BPM) that puts the hits closest to a grid, starting at the first hit.
 * Several tempos can fit equally well (half or double); the one closest to 100 BPM wins.
 */
export function guessTempo(times: number[], grid: Grid, min = 60, max = 180): number | null {
  if (times.length < 3) return null;
  const t0 = times[0], res: [number, number][] = [];
  for (let bpm = min; bpm <= max; bpm += 0.5) {
    const sd = 60 / bpm / grid;
    let e = 0;
    for (const t of times) { const x = (t - t0) / sd; e += Math.abs(x - Math.round(x)); }
    res.push([bpm, e / times.length]);
  }
  const minE = Math.min(...res.map((r) => r[1]));
  const c = res.filter((r) => r[1] <= minE + 0.03);
  c.sort((a, b) => Math.abs(Math.log2(a[0] / 100)) - Math.abs(Math.log2(b[0] / 100)));
  return Math.round(c[0][0]);
}

export interface Placement { bar: number; step: number; hit: TimedHit }

/** Snap hits to grid steps measured from `t0` (beat 1). Hits beyond the bar limit are left out. */
export function quantize(hits: TimedHit[], t0: number, idea: Pick<Idea, 'bpm' | 'beats' | 'grid'>, maxBars = MAX_BARS): Placement[] {
  const sd = 60 / idea.bpm / idea.grid, n = steps(idea), out: Placement[] = [];
  for (const h of hits) {
    const x = (h.t - t0) / sd;
    if (x < -0.5) continue;
    const s = Math.round(x), bar = Math.floor(s / n);
    if (bar >= maxBars) continue;
    out.push({ bar, step: s % n, hit: h });
  }
  return out;
}

export type WriteMode = 'replace' | 'merge';

/**
 * Write hits into an idea. Replace clears the affected instruments in the written bars first:
 * all instruments for e-drum input, the voice instruments otherwise.
 */
export function writeHits(idea: Idea, hits: TimedHit[], t0: number, mode: WriteMode, allInstruments = false): { idea: Idea; written: number } {
  const placed = quantize(hits, t0, idea);
  if (!placed.length) return { idea, written: 0 };
  const out: Idea = JSON.parse(JSON.stringify(idea));
  const n = steps(out), maxBar = Math.max(...placed.map((p) => p.bar));
  while (out.bars.length <= maxBar) out.bars.push(emptyBar(n));
  const clear: InstrumentId[] = allInstruments ? INSTRUMENTS.map((i) => i.id) : ['bd', 'sn', 'hh', 't1', 'ft', 'cr'];
  if (mode === 'replace') for (let b = 0; b <= maxBar; b++) for (const k of clear) out.bars[b].n[k].fill(0);
  for (const { bar, step, hit } of placed) {
    const cur = out.bars[bar].n[hit.cls][step];
    out.bars[bar].n[hit.cls][step] = (hit.v || (hit.acc ? 2 : Math.max(1, cur === 2 ? 2 : 1))) as NoteState;
  }
  return { idea: out, written: placed.length };
}
