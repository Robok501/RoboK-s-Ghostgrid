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

/** Rolling hit log, overall and per pad, limited to the last `size` hits. */
export class HitLog {
  all: number[] = [];
  byPad: Record<string, number[]> = {};
  constructor(public size = 32) {}
  add(offsetMs: number, pad?: string) {
    this.all.push(offsetMs);
    if (this.all.length > this.size) this.all.shift();
    if (pad) {
      const a = (this.byPad[pad] ||= []);
      a.push(offsetMs);
      if (a.length > this.size) a.shift();
    }
  }
  reset() { this.all = []; this.byPad = {}; }
}
