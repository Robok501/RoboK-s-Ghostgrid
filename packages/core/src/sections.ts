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
import type { Envelope, MusicFeatures } from './beatmap';

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

/** Per bar: how loud each band is (full, low, mid, high), as z-scored logs. This is the "how full is the arrangement" side. */
export function barBands(env: Envelope, barTimes: number[], end: number): number[][] {
  const bands = [env.full, env.low, env.mid ?? env.full, env.high ?? env.full];
  const raw = barTimes.map((t0, i) => {
    const a = Math.max(0, Math.floor(t0 * env.rate)), b = Math.max(a + 1, Math.ceil((barTimes[i + 1] ?? end) * env.rate));
    return bands.map((x) => { let sum = 0, c = 0; for (let f = a; f < Math.min(b, x.length); f++) { sum += x[f] * x[f]; c++; } return Math.log(1e-6 + Math.sqrt(sum / Math.max(1, c))); });
  });
  const out = raw.map(() => new Array(bands.length).fill(0));
  for (let d = 0; d < bands.length; d++) {
    const m = raw.reduce((x, r) => x + r[d], 0) / Math.max(1, raw.length);
    const sd = Math.sqrt(raw.reduce((x, r) => x + (r[d] - m) ** 2, 0) / Math.max(1, raw.length)) || 1;
    raw.forEach((r, i) => { out[i][d] = (r[d] - m) / sd; });
  }
  return out;
}

/** Per bar: the sound colour. `mel` is log energy in `bands` mel bands per frame (flattened), at `rate` frames a second. Each band is z-scored over the song. */
export function barTimbre(mel: ArrayLike<number>, bands: number, rate: number, barTimes: number[], end: number): number[][] {
  const nF = Math.floor(mel.length / bands);
  const raw = barTimes.map((t0, i) => {
    const a = Math.max(0, Math.floor(t0 * rate)), b = Math.min(nF, Math.max(a + 1, Math.ceil((barTimes[i + 1] ?? end) * rate)));
    const m = new Array(bands).fill(0);
    for (let f = a; f < b; f++) for (let k = 0; k < bands; k++) m[k] += (mel[f * bands + k] ?? 0) / Math.max(1, b - a);
    return m;
  });
  const out = raw.map(() => new Array(bands).fill(0));
  for (let k = 0; k < bands; k++) {
    const mean = raw.reduce((x, r) => x + r[k], 0) / Math.max(1, raw.length);
    const sd = Math.sqrt(raw.reduce((x, r) => x + (r[k] - mean) ** 2, 0) / Math.max(1, raw.length)) || 1;
    raw.forEach((r, i) => { out[i][k] = (r[k] - mean) / sd; });
  }
  return out;
}

/** Glue two feature sets together bar by bar, each scaled by its weight. */
export function joinVectors(a: number[][], wa: number, b: number[][], wb: number): number[][] {
  return a.map((x, i) => [...x.map((y) => y * wa), ...(b[i] ?? []).map((y) => y * wb)]);
}

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

/** How different the bars after each bar sound from the bars before it (0 = alike). */
export function noveltyCurve(v: number[][]): number[] {
  const n = v.length;
  const K = Math.max(2, Math.min(8, Math.floor(n / 3)));
  const len = v[0]?.length ?? 0;
  const avg = (a: number, b: number) => { const m = new Array(len).fill(0); for (let i = a; i < b; i++) for (let d = 0; d < len; d++) m[d] += v[i][d] / (b - a); return m; };
  const nov = new Array(n).fill(0);
  for (let i = 2; i <= n - 2; i++) {
    const k = Math.min(K, i, n - i);
    nov[i] = (1 - cos(avg(i - k, i), avg(i, i + k))) * (k / K) ** 1.5; // a part-cycle window is less trustworthy
  }
  return nov;
}

/** Start bars of the sections (always includes 0). */
export function sectionStarts(v: number[][], minBars = 8, z = 0.8, floor = 0): number[] {
  const n = v.length;
  if (n < minBars * 2) return [0];
  const nov = noveltyCurve(v);
  const m = nov.reduce((x, y) => x + y, 0) / n;
  const sd = Math.sqrt(nov.reduce((x, y) => x + (y - m) ** 2, 0) / n) || 1e-6;
  const cand: { i: number; v: number }[] = [];
  for (let i = 1; i < n; i++) {
    const near = (i % 4 === 0 ? 1 : i % 2 === 0 ? 0.85 : 0.65) * nov[i];
    if (nov[i] >= (nov[i - 1] ?? 0) && nov[i] >= (nov[i + 1] ?? 0) && nov[i] > m + z * sd && nov[i] > floor) cand.push({ i, v: near });
  }
  cand.sort((a, b) => b.v - a.v);
  const starts = [0];
  for (const c of cand) if (starts.every((s) => Math.abs(s - c.i) >= minBars) && n - c.i >= minBars) starts.push(c.i);
  return starts.sort((a, b) => a - b);
}

/** Sections with letters, from bar vectors. */
export function findSections(v: number[][], opts: { minBars?: number; same?: number; z?: number; floor?: number } = {}): SongPart[] {
  if (!v.length) return [];
  const starts = sectionStarts(v, opts.minBars ?? 8, opts.z ?? 0.8, opts.floor ?? 0);
  const same = opts.same ?? 0.93;
  const cents: number[][] = [];
  const parts = starts.map((from, k) => {
    const to = starts[k + 1] ?? v.length;
    const len = v[0].length, mean = new Array(len).fill(0);
    for (let i = from; i < to; i++) for (let d = 0; d < len; d++) mean[d] += v[i][d] / (to - from);
    let best = -1, bs = same;
    cents.forEach((c, ci) => { const s = cos(c, mean); if (s > bs) { bs = s; best = ci; } });
    if (best < 0) { cents.push(mean); best = cents.length - 1; }
    return { from, to, letter: letterOf(best) };
  });
  // two neighbours that sound the same are one part
  const merged: SongPart[] = [];
  for (const p of parts) { const last = merged[merged.length - 1]; if (last && last.letter === p.letter) last.to = p.to; else merged.push({ ...p }); }
  return merged;
}

export const letterOf = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`);

/**
 * Sections for a song: music features + bar times. With the sound profile (`music.mel`) and the band loudness (`env`) the
 * parts follow how the arrangement sounds (best in tests on real songs); without them only chords and loudness are used.
 */
export function songSections(music: MusicFeatures, barTimes: number[], end: number, env?: Envelope): SongPart[] {
  const chroma = barVectors(music, barTimes, end);
  if (!music.mel || !music.bands || !env) return findSections(chroma, { minBars: 8, z: 0.8 });
  const v = joinVectors(joinVectors(chroma, 0.3, barBands(env, barTimes, end), 0.3), 1, barTimbre(music.mel, music.bands, music.rate, barTimes, end), 1);
  return findSections(v, { minBars: 8, z: 0.8 });
}
