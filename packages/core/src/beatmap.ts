/**
 * Beat and bar map of a song, found in its separated drum track.
 * Input is two loudness envelopes of the drums at a fixed frame rate (the native side computes them):
 * the full signal and its low end (kick). Steps:
 *  1. onset strength: rises in loudness (log scale), kick rises weighted extra;
 *  2. tempo: autocorrelation of the onset strength between 62 and 210 BPM, favouring ~110 BPM;
 *  3. beats: dynamic programming (Ellis 2007) — beats on strong onsets, spaced close to the tempo,
 *     so a band that speeds up or drags is followed;
 *  4. bars: where the "1" is. Mostly from the music without drums: chords change and the bass lands on the "1"
 *     (harmonic change per beat, from 12 pitch classes); the kick only helps break ties.
 * Everything can be corrected by hand: shift the "1", change beats per bar, halve or double the tempo.
 */

export interface Envelope {
  /** frames per second */
  rate: number;
  full: ArrayLike<number>;
  low: ArrayLike<number>;
}

export interface BeatMap {
  /** beat times in seconds (song time) */
  beats: number[];
  beatsPerBar: number;
  /** index in `beats` of the first "1" (0 … beatsPerBar-1) */
  downbeat: number;
  /** median tempo */
  bpm: number;
  /** true when changed by hand */
  edited?: boolean;
  /** found in the separated drum track, or in the whole mix (less reliable) */
  source?: 'drums' | 'mix';
  /** analysis version (newer versions redo older, unedited maps) */
  v?: number;
}

/** Onset strength per frame: positive change of log loudness, kick weighted. */
export function onsetStrength(env: Envelope): Float32Array {
  const n = Math.min(env.full.length, env.low.length), o = new Float32Array(n);
  const lf = (x: number) => Math.log(1 + 1000 * x);
  for (let i = 1; i < n; i++) {
    const a = Math.max(0, lf(env.full[i]) - lf(env.full[i - 1]));
    const b = Math.max(0, lf(env.low[i]) - lf(env.low[i - 1]));
    o[i] = a + 0.8 * b;
  }
  // remove the slow trend (a local mean) so loud passages don't dominate
  const w = Math.round(env.rate * 0.5), out = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += o[i];
    if (i >= w) sum -= o[i - w];
    const mean = sum / Math.min(i + 1, w);
    out[i] = Math.max(0, o[i] - mean);
  }
  let sd = 0;
  for (let i = 0; i < n; i++) sd += out[i] * out[i];
  sd = Math.sqrt(sd / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i++) out[i] /= sd;
  return out;
}

/** Tempo period in frames (fractional), from the autocorrelation of the onset strength. */
export function estimatePeriod(o: Float32Array, rate: number, minBpm = 62, maxBpm = 210, centre = 110): number {
  const lo = Math.floor((60 * rate) / maxBpm), hi = Math.ceil((60 * rate) / minBpm);
  const n = o.length, top = Math.min(n - 1, 2 * hi + 2), ac = new Float64Array(top + 1);
  for (let lag = lo - 1; lag <= top; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += o[i] * o[i - lag];
    ac[lag] = s / (n - lag);
  }
  let best = lo, bestV = -Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    const bpm = (60 * rate) / lag;
    // prefer tempos near the centre (log-Gaussian, one octave wide), and reward lags whose double also fits
    const prior = Math.exp(-0.5 * (Math.log2(bpm / centre) / 1.0) ** 2);
    // the bar-level pulse (kick and snare) recurs every two beats; hi-hats every half beat: reward the former
    const dbl = 2 * lag <= top ? ac[2 * lag] * 0.5 : 0;
    const v = (ac[lag] + dbl) * prior;
    if (v > bestV) { bestV = v; best = lag; }
  }
  // parabolic refinement
  const a = ac[best - 1], b = ac[best], c = ac[best + 1], d = a - 2 * b + c;
  return best + (d !== 0 ? (0.5 * (a - c)) / d : 0);
}

/** Beat frames by dynamic programming over the onset strength. */
export function trackBeats(o: Float32Array, period: number, tightness = 120): number[] {
  const n = o.length, score = new Float64Array(n), back = new Int32Array(n).fill(-1);
  const lo = Math.max(1, Math.round(period / 2)), hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = 0, arg = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const r = Math.log((t - p) / period);
      const v = score[p] - tightness * r * r;
      if (arg < 0 || v > best) { best = v; arg = p; }
    }
    score[t] = o[t] + (arg >= 0 ? best : 0);
    back[t] = arg;
  }
  // end on the best-scoring frame among the last period
  let end = n - 1, bestEnd = -Infinity;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) if (score[t] > bestEnd) { bestEnd = score[t]; end = t; }
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]) { beats.push(t); if (back[t] < 0) break; }
  beats.reverse();
  // drop weak leading/trailing beats in silence (intro without drums, fade-out)
  const strength = (f: number) => Math.max(o[f] ?? 0, o[f - 1] ?? 0, o[f + 1] ?? 0);
  while (beats.length > 4 && strength(beats[0]) < 0.3) beats.shift();
  while (beats.length > 4 && strength(beats[beats.length - 1]) < 0.3) beats.pop();
  return beats;
}

/** Which beat (0 … beatsPerBar-1) is the "1": most kick, least snare/high, averaged over the song. */
export function findDownbeat(env: Envelope, beatFrames: number[], beatsPerBar: number): number {
  return pickPhase(kickPhaseScores(env, beatFrames, beatsPerBar));
}

/** Highest score wins; near-ties go to the earliest beat (songs usually start on a "1"). */
function pickPhase(v: number[]): number {
  const top = Math.max(...v), spread = top - Math.min(...v);
  return v.findIndex((x) => x >= top - 0.1 * spread);
}

/** Kick evidence per beat position in the bar (higher = more like a "1"). */
export function kickPhaseScores(env: Envelope, beatFrames: number[], beatsPerBar: number): number[] {
  const low = new Float64Array(beatsPerBar), high = new Float64Array(beatsPerBar), cnt = new Float64Array(beatsPerBar);
  const lf = (x: number) => Math.log(1 + 1000 * x);
  beatFrames.forEach((f, i) => {
    const k = i % beatsPerBar;
    let l = 0, h = 0;
    for (let d = 0; d <= 3; d++) {
      const j = f + d;
      if (j < 1 || j >= env.low.length) continue;
      l = Math.max(l, lf(env.low[j]) - lf(env.low[j - 1]));
      h = Math.max(h, lf(env.full[j]) - lf(env.full[j - 1]) - (lf(env.low[j]) - lf(env.low[j - 1])));
    }
    low[k] += l; high[k] += h; cnt[k]++;
  });
  return Array.from({ length: beatsPerBar }, (_, k) => (low[k] - 0.5 * high[k]) / Math.max(1, cnt[k]));
}

const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

/**
 * Features of the music without drums, at a fixed frame rate: 12 pitch-class energies per frame (flattened)
 * and the bass energy (roughly 40–150 Hz). The native side computes them from the "no drums" track.
 */
export interface MusicFeatures { rate: number; chroma: ArrayLike<number>; bass: ArrayLike<number> }

const norm01 = (v: number[]) => {
  const lo = Math.min(...v), hi = Math.max(...v);
  return hi - lo > 1e-9 ? v.map((x) => (x - lo) / (hi - lo)) : v.map(() => 0);
};

/**
 * Evidence per beat position in the bar from the music: how much the harmony changes on that beat
 * (chords change on the "1"), and how much the bass jumps up there (a new bass note on the "1").
 */
export function musicPhaseScores(music: MusicFeatures, beats: number[], beatsPerBar: number): number[] {
  const frames = Math.floor(music.chroma.length / 12);
  const vec = (from: number, to: number) => {
    const a = Math.max(0, Math.floor(from * music.rate)), b = Math.min(frames, Math.max(a + 1, Math.floor(to * music.rate)));
    const c = new Array(12).fill(0);
    let bass = 0;
    for (let f = a; f < b; f++) {
      for (let k = 0; k < 12; k++) c[k] += music.chroma[f * 12 + k];
      bass += music.bass[f] ?? 0;
    }
    const len = Math.sqrt(c.reduce((s, x) => s + x * x, 0)) || 1;
    return { c: c.map((x) => x / len), bass: bass / Math.max(1, b - a) };
  };
  const per = beats.map((t, i) => vec(t, beats[i + 1] ?? t + (t - (beats[i - 1] ?? t - 0.5))));
  const change = new Array(beatsPerBar).fill(0), bassUp = new Array(beatsPerBar).fill(0), cnt = new Array(beatsPerBar).fill(0);
  for (let i = 1; i < per.length; i++) {
    const k = i % beatsPerBar;
    const cos = per[i].c.reduce((s, x, j) => s + x * per[i - 1].c[j], 0);
    change[k] += 1 - cos;
    bassUp[k] += Math.max(0, Math.log((per[i].bass + 1e-6) / (per[i - 1].bass + 1e-6)));
    cnt[k]++;
  }
  const ch = norm01(change.map((x, k) => x / Math.max(1, cnt[k])));
  const bu = norm01(bassUp.map((x, k) => x / Math.max(1, cnt[k])));
  return ch.map((x, k) => x + 0.5 * bu[k]);
}

/** The whole analysis: drum envelope (and, when available, the music without drums) in, beat and bar map out. */
export function beatMap(env: Envelope, beatsPerBar = 4, music?: MusicFeatures): BeatMap {
  const o = onsetStrength(env);
  const period = estimatePeriod(o, env.rate);
  const frames = trackBeats(o, period);
  const beats = frames.map((f) => f / env.rate);
  const iv = beats.slice(1).map((b, i) => b - beats[i]);
  const kick = norm01(kickPhaseScores(env, frames, beatsPerBar));
  const scores = music ? musicPhaseScores(music, beats, beatsPerBar).map((x, k) => x + 0.35 * kick[k]) : kick;
  return { beats, beatsPerBar, downbeat: pickPhase(scores), bpm: iv.length ? Math.round(600 / median(iv)) / 10 : 0 };
}

// ---------------------------------------------------------------- using the map

/** Start times of every bar. */
export function barStarts(m: BeatMap): number[] {
  const out: number[] = [];
  for (let i = m.downbeat; i < m.beats.length; i += m.beatsPerBar) out.push(m.beats[i]);
  return out;
}

/** Bar number (0-based) playing at time t, or -1 before the first bar. */
export function barAt(m: BeatMap, t: number): number {
  const bars = barStarts(m);
  let lo = -1;
  for (let i = 0; i < bars.length; i++) { if (bars[i] <= t + 1e-6) lo = i; else break; }
  return lo;
}

/** Nearest bar line to t. */
export function snapToBar(m: BeatMap, t: number): number {
  const bars = barStarts(m);
  if (!bars.length) return t;
  let best = bars[0];
  for (const b of bars) if (Math.abs(b - t) < Math.abs(best - t)) best = b;
  return best;
}

/** End of a loop that starts on the bar line `a` and lasts `n` bars (the song end if past the last bar). */
export function barsFrom(m: BeatMap, a: number, n: number, songEnd: number): number {
  const bars = barStarts(m);
  const i = bars.findIndex((b) => Math.abs(b - a) < 1e-3);
  if (i < 0) return Math.min(songEnd, a + n * m.beatsPerBar * (60 / (m.bpm || 120)));
  if (i + n < bars.length) return bars[i + n];
  const last = m.beats[m.beats.length - 1] ?? songEnd;
  return Math.min(songEnd, last + 60 / (m.bpm || 120));
}

/** Local beat length at time t (seconds). */
export function beatLengthAt(m: BeatMap, t: number): number {
  const b = m.beats;
  for (let i = 1; i < b.length; i++) if (b[i] > t) return b[i] - b[i - 1];
  return 60 / (m.bpm || 120);
}

/** Click events for the song: one per beat, the "1" accented. */
export function clickTimes(m: BeatMap): { t: number; accent: boolean }[] {
  return m.beats.map((t, i) => ({ t, accent: (i - m.downbeat) % m.beatsPerBar === 0 }));
}

/**
 * Timing of a hit against the song's beats (or `grid` subdivisions of them): offset in ms, negative = early.
 * Null when the hit is more than half a subdivision away from anything (before the first beat, say).
 */
export function offsetToBeat(m: BeatMap, songTime: number, grid: 1 | 2 | 4 = 1): number | null {
  const b = m.beats;
  if (b.length < 2) return null;
  let lo = 0, hi = b.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b[mid] <= songTime) lo = mid; else hi = mid - 1; }
  if (songTime < b[0]) {
    const d = songTime - b[0];
    return -d > (b[1] - b[0]) / grid / 2 ? null : d * 1000;
  }
  const len = lo + 1 < b.length ? b[lo + 1] - b[lo] : b[lo] - b[lo - 1];
  const step = len / grid, k = Math.round((songTime - b[lo]) / step);
  const d = songTime - (b[lo] + k * step);
  if (lo === b.length - 1 && k > grid) return null;
  return d * 1000;
}

// ---------------------------------------------------------------- corrections by hand

export function shiftDownbeat(m: BeatMap, by = 1): BeatMap {
  return { ...m, downbeat: (((m.downbeat + by) % m.beatsPerBar) + m.beatsPerBar) % m.beatsPerBar, edited: true };
}

export function setBeatsPerBar(m: BeatMap, beatsPerBar: number): BeatMap {
  return { ...m, beatsPerBar, downbeat: m.downbeat % beatsPerBar, edited: true };
}

/** Half tempo: keep every other beat (the one on the current "1"). */
export function halfTime(m: BeatMap): BeatMap {
  const beats = m.beats.filter((_, i) => (i - m.downbeat) % 2 === 0);
  return { ...m, beats, downbeat: 0, bpm: Math.round(m.bpm * 5) / 10, edited: true };
}

/** Double tempo: add a beat halfway between each pair. */
export function doubleTime(m: BeatMap): BeatMap {
  const beats: number[] = [];
  m.beats.forEach((b, i) => { beats.push(b); if (i + 1 < m.beats.length) beats.push((b + m.beats[i + 1]) / 2); });
  return { ...m, beats, downbeat: m.downbeat * 2, bpm: Math.round(m.bpm * 20) / 10, edited: true };
}

/** Make the "1" fall on the beat nearest to time t (tap where the bar starts). */
export function setDownbeatAt(m: BeatMap, t: number): BeatMap {
  let i = 0;
  m.beats.forEach((b, j) => { if (Math.abs(b - t) < Math.abs(m.beats[i] - t)) i = j; });
  return { ...m, downbeat: i % m.beatsPerBar, edited: true };
}
