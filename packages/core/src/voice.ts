/**
 * Voice to notes: find hits in a beatbox recording and recognise which drum sound each one is.
 * Each hit becomes a feature vector (8 spectral band shares, brightness, ring-out time, loudness).
 * With taught samples a hit takes the sound of its nearest taught examples (k-nearest neighbours);
 * without them, simple built-in rules decide. See the project memo on sound recognition for next steps.
 */
import type { InstrumentId, NoteState } from './groove';

export type SoundKey = 'bd' | 'sn' | 'sng' | 'hh' | 'hho' | 't1' | 'ft' | 'cr';
export interface Sound { k: SoundKey; name: string; say: string; cls: InstrumentId; v: NoteState; letter: string }

export const SOUNDS: Sound[] = [
  { k: 'bd', name: 'Kick', say: 'boom', cls: 'bd', v: 0, letter: 'K' },
  { k: 'sn', name: 'Snare', say: 'ka or psh', cls: 'sn', v: 0, letter: 'S' },
  { k: 'sng', name: 'Ghost snare', say: 'a soft ka, or tk', cls: 'sn', v: 3, letter: 'g' },
  { k: 'hh', name: 'Hi-hat closed', say: 'ts', cls: 'hh', v: 0, letter: 'H' },
  { k: 'hho', name: 'Hi-hat open', say: 'tsss', cls: 'hh', v: 3, letter: 'O' },
  { k: 't1', name: 'Tom', say: 'dum', cls: 't1', v: 0, letter: 'T' },
  { k: 'ft', name: 'Floor tom', say: 'doom, low', cls: 'ft', v: 0, letter: 'F' },
  { k: 'cr', name: 'Crash', say: 'kssh, long', cls: 'cr', v: 0, letter: 'C' },
];
export const SOUND = Object.fromEntries(SOUNDS.map((s) => [s.k, s])) as Record<SoundKey, Sound>;
/** Taught feature vectors per sound. */
export type Samples = Partial<Record<SoundKey, number[][]>>;

export interface Features { c: number; lo: number; hi: number; dec: number; pk: number; v: number[] }
export interface Hit {
  /** seconds from the start of the recording (or audio-context time for live input) */
  t: number;
  peak: number;
  f: Features;
  k: SoundKey;
  cls: InstrumentId;
  /** 0 = plain, 3 = ghost / open (from the sound), set to 2 by accents */
  v: NoteState;
  acc?: boolean;
}

/** Power spectrum of the first 1024 samples (Hann window, radix-2 FFT). */
export function fftPower(buf: ArrayLike<number>): Float64Array {
  const N = 1024, re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (buf[i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len, h = len >> 1;
    for (let i = 0; i < N; i += len) for (let k = 0; k < h; k++) {
      const c = Math.cos(ang * k), s = Math.sin(ang * k), a = i + k, b = a + h;
      const vr = re[b] * c - im[b] * s, vi = re[b] * s + im[b] * c;
      re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
    }
  }
  const p = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i];
  return p;
}

const EDGES = [0, 150, 300, 600, 1200, 2400, 4800, 9600, 1e9];
/** Features of one hit. `seg` starts at the onset and runs up to 300 ms (or the next hit). */
export function featVec(seg: Float32Array, sr: number): Features {
  const p = fftPower(seg.subarray(0, 1024)), hz = sr / 1024, band = new Array(8).fill(0);
  let tot = 1e-12, cen = 0, lo = 0, hi = 0;
  for (let i = 1; i < p.length; i++) {
    const f = i * hz;
    tot += p[i]; cen += f * p[i];
    if (f < 250) lo += p[i];
    if (f > 5000) hi += p[i];
    for (let b = 0; b < 8; b++) if (f < EDGES[b + 1]) { band[b] += p[i]; break; }
  }
  const w = Math.max(1, Math.round(sr * 0.005)), env: number[] = [];
  for (let j = 0; j + w <= seg.length; j += w) { let q = 0; for (let k = 0; k < w; k++) q += seg[j + k] * seg[j + k]; env.push(Math.sqrt(q / w)); }
  let pk = 0, pi = 0;
  for (let j = 0; j < Math.min(10, env.length); j++) if (env[j] > pk) { pk = env[j]; pi = j; }
  let dec = env.length;
  for (let j = pi; j < env.length; j++) if (env[j] < pk * 0.2) { dec = j; break; }
  const c = cen / tot, decMs = dec * 5;
  return {
    c, lo: lo / tot, hi: hi / tot, dec: decMs, pk,
    v: [...band.map((b) => b / tot), Math.log2(Math.max(c, 50) / 50) / 7, Math.log2(Math.max(decMs, 5) / 5) / 6, Math.log10(Math.max(pk, 1e-4)) + 4],
  };
}

const W = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1.6, 0.8];
export const taughtSounds = (samples: Samples): SoundKey[] => SOUNDS.map((s) => s.k).filter((k) => (samples[k] || []).length >= 2);
/** Own sounds are used once kick, snare and closed hi-hat are taught. */
export const usesOwnSounds = (samples: Samples) => (['bd', 'sn', 'hh'] as SoundKey[]).every((k) => taughtSounds(samples).includes(k));

interface Model { all: [SoundKey, number[]][]; sd: number[] }
const models = new WeakMap<Samples, Model>();
function model(samples: Samples): Model {
  const hit = models.get(samples);
  if (hit) return hit;
  const all: [SoundKey, number[]][] = [];
  for (const k of taughtSounds(samples)) for (const x of samples[k]!) all.push([k, x]);
  const D = W.length, mean = new Array(D).fill(0), sd = new Array(D).fill(0);
  for (const [, x] of all) for (let d = 0; d < D; d++) mean[d] += x[d] / all.length;
  for (const [, x] of all) for (let d = 0; d < D; d++) sd[d] += (x[d] - mean[d]) ** 2 / all.length;
  for (let d = 0; d < D; d++) sd[d] = Math.max(Math.sqrt(sd[d]), 0.03);
  const m = { all, sd };
  models.set(samples, m);
  return m;
}

/** Nearest taught sounds; returns the winner and a confidence margin (0 = tie, 1 = clear). */
export function knn(v: number[], samples: Samples, k = 3): { key: SoundKey; margin: number } {
  const { all, sd } = model(samples);
  const ds = all
    .map(([key, x]) => { let q = 0; for (let d = 0; d < W.length; d++) q += W[d] * ((v[d] - x[d]) / sd[d]) ** 2; return [key, Math.sqrt(q)] as const; })
    .sort((a, b) => a[1] - b[1]);
  const vote: Partial<Record<SoundKey, number>> = {};
  for (const [key, d] of ds.slice(0, k)) vote[key] = (vote[key] || 0) + 1 / (d + 0.25);
  const ranked = (Object.entries(vote) as [SoundKey, number][]).sort((a, b) => b[1] - a[1]);
  const top = ranked[0][1], second = ranked[1]?.[1] ?? 0;
  return { key: ranked[0][0], margin: (top - second) / top };
}

/** Which sound a hit is: taught sounds when available, otherwise built-in rules. */
export function decide(f: Features, samples: Samples): Pick<Hit, 'k' | 'cls' | 'v'> {
  let k: SoundKey;
  if (usesOwnSounds(samples)) k = knn(f.v, samples).key;
  else k = f.lo > 0.5 || (f.lo > 0.3 && f.c < 700) ? 'bd' : f.c > 4500 || f.hi > 0.4 ? (f.dec >= 160 ? 'hho' : 'hh') : 'sn';
  const s = SOUND[k];
  return { k, cls: s.cls, v: s.v };
}

/**
 * Ghost notes by loudness (when Ghost snare is not taught): snares softer than `ghostPct`% of the median snare.
 * Accents: hits clearly louder (×1.7) than the median of their sound.
 */
export function finalize(hits: Hit[], samples: Samples, ghostPct = 45): Hit[] {
  if (!taughtSounds(samples).includes('sng')) {
    const sn = hits.filter((h) => h.k === 'sn');
    if (sn.length >= 3) {
      const pk = sn.map((h) => h.peak).sort((a, b) => a - b), med = pk[pk.length >> 1];
      sn.forEach((h) => { if (h.peak < (med * ghostPct) / 100) { h.k = 'sng'; h.v = 3; } });
    }
  }
  for (const c of ['bd', 'sn', 'hh', 't1', 'ft', 'cr'] as InstrumentId[]) {
    const hs = hits.filter((h) => h.cls === c && !h.v);
    if (hs.length < 3) continue;
    const pk = hs.map((h) => h.peak).sort((a, b) => a - b), med = pk[pk.length >> 1];
    hs.forEach((h) => (h.acc = h.peak >= med * 1.7));
  }
  return hits;
}

export interface Analysis { hits: Hit[]; env: Float32Array; hop: number; sr: number; dur: number }

/** Find hits in a mono recording (energy onsets, 70 ms apart at least) and classify them. */
export function analyze(data: Float32Array, sr: number, samples: Samples, ghostPct = 45): Analysis {
  const hop = Math.max(1, Math.round(sr * 0.005)), nh = Math.floor(data.length / hop), env = new Float32Array(nh);
  let mx = 0;
  for (let i = 0; i < nh; i++) { let q = 0; for (let k = 0; k < hop; k++) { const x = data[i * hop + k]; q += x * x; } env[i] = Math.sqrt(q / hop); if (env[i] > mx) mx = env[i]; }
  const ons: { t: number; start: number; peak: number }[] = [], floor = mx * 0.06;
  let lastT = -1;
  for (let i = 6; i < nh; i++) {
    let avg = 0;
    for (let k = 2; k <= 7; k++) avg += env[i - k];
    avg /= 6;
    const t = (i * hop) / sr;
    if (env[i] > floor && env[i] > avg * 2.4 + mx * 0.01 && env[i] >= env[i - 1] && t - lastT > 0.07) {
      let pk = 0;
      for (let k = 0; k < 12 && i + k < nh; k++) pk = Math.max(pk, env[i + k]);
      ons.push({ t, start: Math.max(0, (i - 1) * hop), peak: pk });
      lastT = t;
    }
  }
  const hits: Hit[] = ons.map((o, j) => {
    const lim = Math.min((ons[j + 1] ? ons[j + 1].start : data.length) - o.start, Math.round(sr * 0.3));
    const f = featVec(data.subarray(o.start, o.start + lim), sr);
    return { t: o.t, peak: o.peak, f, ...decide(f, samples) };
  });
  finalize(hits, samples, ghostPct);
  return { hits, env, hop, sr, dur: data.length / sr };
}

/** Re-run recognition on existing hits, e.g. after new sounds were taught. */
export function reclassify(hits: Hit[], samples: Samples, ghostPct = 45): Hit[] {
  for (const h of hits) { Object.assign(h, decide(h.f, samples)); h.acc = false; }
  return finalize(hits, samples, ghostPct);
}

/** Add taught vectors for one sound (keeps the last 16). Returns a new samples object. */
export function addSamples(samples: Samples, k: SoundKey, vecs: number[][]): Samples {
  return { ...samples, [k]: (samples[k] || []).concat(vecs).slice(-16) };
}
