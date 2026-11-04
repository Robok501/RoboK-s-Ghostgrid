/**
 * Song sections (verse, chorus…) from the music itself.
 *
 *  1. one feature vector per bar: the chord colours (12 pitch classes) plus how loud the music and the bass are there
 *  2. bars that sound alike are marked in a bar-by-bar similarity table
 *  3. where the table changes character, a new section starts (preferring a multiple of 4 bars from the start)
 *  4. sections that sound alike share a letter: A, B, A, C…  The player doesn't guess names; the user can rename a letter.
 *
 * Needs `MusicFeatures` (10 frames a second, 12 chroma per frame flattened, bass energy) and the bar start times.
 */
import type { MusicFeatures } from './beatmap';

export interface SongPart {
  /** first bar (0-based) */
  from: number;
  /** one past the last bar */
  to: number;
  /** A, B, C… — the same letter means it sounds the same */
  letter: string;
}

const dot = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const cos = (a: number[], b: number[]) => { const d = Math.sqrt(dot(a, a) * dot(b, b)); return d > 1e-9 ? dot(a, b) / d : 0; };

/** One vector per bar. `barTimes` are the bar start times in seconds; `end` is the song's end. */
export function barVectors(music: MusicFeatures, barTimes: number[], end: number): number[][] {
  const rate = music.rate || 10;
  const nF = Math.floor(music.chroma.length / 12);
  const raw = barTimes.map((t0, i) => {
    const a = Math.max(0, Math.floor(t0 * rate)), b = Math.min(nF, Math.max(a + 1, Math.ceil((barTimes[i + 1] ?? end) * rate)));
    const c = new Array(12).fill(0);
    let bass = 0;
    for (let f = a; f < b; f++) { for (let k = 0; k < 12; k++) c[k] += music.chroma[f * 12 + k] ?? 0; bass += music.bass[f] ?? 0; }
    const n = Math.max(1, b - a);
    const tot = c.reduce((x, y) => x + y, 0) / n;
    return { c: c.map((x) => x / n), tot, bass: bass / n };
  });
  const lg = (x: number) => Math.log(1e-6 + x);
  const stat = (f: (r: (typeof raw)[number]) => number) => {
    const v = raw.map((r) => lg(f(r)));
    const m = v.reduce((x, y) => x + y, 0) / Math.max(1, v.length);
    const sd = Math.sqrt(v.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, v.length)) || 1;
    return v.map((x) => (x - m) / sd);
  };
  const zt = stat((r) => r.tot), zb = stat((r) => r.bass);
  return raw.map((r, i) => {
    const s = Math.sqrt(dot(r.c, r.c)) || 1;
    // chroma has unit length; loudness is a gentler second voice
    return [...r.c.map((x) => x / s), 0.25 * zt[i], 0.15 * zb[i]];
  });
}

/** Start bars of the sections (always includes 0). */
export function sectionStarts(v: number[][], minBars = 4): number[] {
  const n = v.length;
  if (n < minBars * 2) return [0];
  // novelty at bar i: how different the K bars after i sound from the K bars before it (averaged, so a chord loop inside a part cancels out)
  const K = Math.max(2, Math.min(8, Math.floor(n / 3)));
  const len = v[0].length;
  const avg = (a: number, b: number) => { const m = new Array(len).fill(0); for (let i = a; i < b; i++) for (let d = 0; d < len; d++) m[d] += v[i][d] / (b - a); return m; };
  const nov = new Array(n).fill(0);
  for (let i = 2; i <= n - 2; i++) {
    const k = Math.min(K, i, n - i);
    nov[i] = (1 - cos(avg(i - k, i), avg(i, i + k))) * (k / K) ** 1.5; // a part-cycle window is less trustworthy
  }
  const m = nov.reduce((x, y) => x + y, 0) / n;
  const sd = Math.sqrt(nov.reduce((x, y) => x + (y - m) ** 2, 0) / n) || 1e-6;
  const cand: { i: number; v: number }[] = [];
  for (let i = 1; i < n; i++) {
    const near = (i % 4 === 0 ? 1 : i % 2 === 0 ? 0.85 : 0.65) * nov[i];
    if (nov[i] >= (nov[i - 1] ?? 0) && nov[i] >= (nov[i + 1] ?? 0) && nov[i] > m + 0.6 * sd && nov[i] > 0.12) cand.push({ i, v: near });
  }
  cand.sort((a, b) => b.v - a.v);
  const starts = [0];
  for (const c of cand) if (starts.every((s) => Math.abs(s - c.i) >= minBars) && n - c.i >= minBars) starts.push(c.i);
  return starts.sort((a, b) => a - b);
}

/** Sections with letters, from bar vectors. */
export function findSections(v: number[][], opts: { minBars?: number; same?: number } = {}): SongPart[] {
  if (!v.length) return [];
  const starts = sectionStarts(v, opts.minBars ?? 4);
  const same = opts.same ?? 0.93;
  const cents: number[][] = [];
  return starts.map((from, k) => {
    const to = starts[k + 1] ?? v.length;
    const len = v[0].length, mean = new Array(len).fill(0);
    for (let i = from; i < to; i++) for (let d = 0; d < len; d++) mean[d] += v[i][d] / (to - from);
    let best = -1, bs = same;
    cents.forEach((c, ci) => { const s = cos(c, mean); if (s > bs) { bs = s; best = ci; } });
    if (best < 0) { cents.push(mean); best = cents.length - 1; }
    return { from, to, letter: letterOf(best) };
  });
}

export const letterOf = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`);

/** Sections for a song: features + bar times. */
export function songSections(music: MusicFeatures, barTimes: number[], end: number): SongPart[] {
  return findSections(barVectors(music, barTimes, end));
}
