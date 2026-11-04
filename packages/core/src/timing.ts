/** Timing coach: score hits against the click grid. All times in seconds unless named ...Ms. */

/** Offset of a hit to the nearest grid time, or null when it is more than `window` (0–1 of half a step) away. */
export function gridOffset(hit: number, grid: number[], step: number, window = 0.95): number | null {
  let best: number | null = null;
  for (const g of grid) if (best === null || Math.abs(hit - g) < Math.abs(best)) best = hit - g;
  if (best === null || Math.abs(best) > (step / 2) * window) return null;
  return best;
}

export interface TimingStats {
  n: number;
  /** mean offset in ms; negative = early (rushing), positive = late (dragging) */
  mean: number;
  /** spread (standard deviation) in ms */
  sd: number;
  /** share of hits within the tolerance window, 0–100 */
  score: number;
}

export function timingStats(offsetsMs: number[], tolMs: number): TimingStats {
  const n = offsetsMs.length;
  if (!n) return { n: 0, mean: 0, sd: 0, score: 0 };
  const mean = offsetsMs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(offsetsMs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const score = (offsetsMs.filter((v) => Math.abs(v) <= tolMs).length / n) * 100;
  return { n, mean, sd, score };
}

/** Score after taking away the player's average lean: what they'd score if they were centred on the grid. */
export function correctedScore(offsetsMs: number[], tolMs: number): number {
  const st = timingStats(offsetsMs, tolMs);
  if (!st.n) return 0;
  return timingStats(offsetsMs.map((v) => v - st.mean), tolMs).score;
}

/** Hits further than this from the chosen grid are "off-grid" (ghost notes, fills, other subdivisions): shown, not scored. */
export const OFF_GRID_MS = 60;

/**
 * Pick the coarsest grid (1 = beats, 2 = eighths, 4 = sixteenths) that most hits sit on.
 * `phasesMs`: each hit's distance to the nearest beat (ms, signed, within half a beat). Needs at least 8 hits, else 1.
 */
export function autoGrade(phasesMs: number[], beatMs: number, share = 0.85): 1 | 2 | 4 {
  if (phasesMs.length < 8 || beatMs <= 0) return 1;
  for (const g of [1, 2, 4] as const) {
    const step = beatMs / g;
    const lim = Math.min(OFF_GRID_MS, step / 2);
    let on = 0;
    for (const p of phasesMs) {
      const d = p - Math.round(p / step) * step;
      if (Math.abs(d) <= lim) on++;
    }
    if (on / phasesMs.length >= share && (g === 4 || step / 2 > OFF_GRID_MS * 0.75)) return g;
  }
  return 4;
}

export type Verdict = 'on' | 'early' | 'late';
export function verdict(offsetMs: number, tolMs: number): Verdict {
  return Math.abs(offsetMs) <= tolMs ? 'on' : offsetMs < 0 ? 'early' : 'late';
}

/**
 * Latency correction from calibration hits (raw offsets in ms, player aiming right on the click).
 * The first two hits are ignored (settling in); the median of the rest is the device's delay,
 * and the correction is its negative, clamped to ±limit.
 */
export function calibrationFromHits(rawMs: number[], limit = 250): number {
  const v = rawMs.slice(2).sort((a, b) => a - b);
  if (!v.length) return 0;
  const med = v[Math.floor(v.length / 2)];
  return Math.max(-limit, Math.min(limit, Math.round(-med)));
}

/**
 * Calibration that also works when the device's delay is near half a beat (Bluetooth audio): hits just before
 * and just after the half-way point are one cluster on a circle, not two. Offsets (ms, against the nearest beat)
 * are unwrapped around their circular mean; the correction is minus their median. Also returns how far the hits
 * still spread around it (ms, root mean square), a measure of how steady the connection is.
 */
export function calibrateOnBeat(rawMs: number[], beatMs: number): { fix: number; spread: number } {
  const v = rawMs.slice(2);
  if (!v.length || beatMs <= 0) return { fix: 0, spread: 0 };
  let s = 0, c = 0;
  for (const x of v) { const a = (2 * Math.PI * x) / beatMs; s += Math.sin(a); c += Math.cos(a); }
  const mean = (Math.atan2(s, c) / (2 * Math.PI)) * beatMs;
  const un = v.map((x) => { let d = x - mean; d -= Math.round(d / beatMs) * beatMs; return mean + d; }).sort((a, b) => a - b);
  const med = un[Math.floor(un.length / 2)];
  let fix = -med;
  fix -= Math.round(fix / beatMs) * beatMs; // keep within half a beat
  const spread = Math.sqrt(un.reduce((a, x) => a + (x - med) ** 2, 0) / un.length);
  return { fix: Math.round(fix), spread: Math.round(spread) };
}

/**
 * Hit log, overall and per pad. Scores count the whole session (up to `size` hits, ten thousand by default:
 * it used to be 32, so the count stopped at 32 and the scores only covered the last few bars).
 */
export class HitLog {
  all: number[] = [];
  byPad: Record<string, number[]> = {};
  /** recent hits with the moment they were played (seconds, any clock), for drawing them on a moving timeline */
  events: { t: number; off: number; pad?: string; bar?: number }[] = [];
  /** hits that fell between grid points (not scored), overall and per pad */
  offGrid = 0;
  offByPad: Record<string, number> = {};
  constructor(public size = 10_000) {}
  addOff(pad?: string) {
    this.offGrid++;
    if (pad) this.offByPad[pad] = (this.offByPad[pad] ?? 0) + 1;
  }
  /** average timing of one pad (ms), or null when it has too few hits */
  padMean(pad: string, min = 4): number | null {
    const a = this.byPad[pad];
    return a && a.length >= min ? a.reduce((x, y) => x + y, 0) / a.length : null;
  }
  /** `bar`: the bar of the song the hit fell in (1-based), for the drift line */
  add(offsetMs: number, pad?: string, t = Date.now() / 1000, bar?: number) {
    this.events.push({ t, off: offsetMs, pad, bar });
    if (this.events.length > 400) this.events.shift();
    this.all.push(offsetMs);
    if (this.all.length > this.size) this.all.shift();
    if (pad) {
      const a = (this.byPad[pad] ||= []);
      a.push(offsetMs);
      if (a.length > this.size) a.shift();
    }
  }
  reset() { this.all = []; this.byPad = {}; this.events = []; this.offGrid = 0; this.offByPad = {}; }
}

/** One bar's worth of hits: how many, the average timing (ms, minus = early) and how scattered. */
export interface BarDrift { bar: number; n: number; mean: number; sd: number }

/** Average timing per bar for the hits that know their bar, in bar order: the drift line through a song. */
export function barDrift(events: { off: number; bar?: number }[]): BarDrift[] {
  const by = new Map<number, number[]>();
  for (const e of events) if (e.bar !== undefined) (by.get(e.bar) ?? by.set(e.bar, []).get(e.bar)!).push(e.off);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([bar, v]) => {
    const st = timingStats(v, 0);
    return { bar, n: st.n, mean: st.mean, sd: st.sd };
  });
}
