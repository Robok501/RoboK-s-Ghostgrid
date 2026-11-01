/**
 * Voice to notes: find hits in a beatbox recording and recognise which drum sound each one is.
 * Each hit becomes a feature vector: 8 spectral band shares, brightness, ring-out time, loudness, plus MFCCs
 * (the standard voice-timbre feature) of the attack and of the 20–85 ms that follow, so "ka" and "psh" differ.
 * With taught samples a hit takes the sound of its nearest taught examples (k-nearest neighbours);
 * without them, simple built-in rules decide. See the project memo on sound recognition for next steps.
 */
import type { InstrumentId, NoteState } from './groove';

export type SoundKey = 'bd' | 'sn' | 'sng' | 'hh' | 'hho' | 't1' | 'ft' | 'cr';
export interface Sound { k: SoundKey; name: string; say: string; cls: InstrumentId; v: NoteState; letter: string }

export const SOUNDS: Sound[] = [
  { k: 'bd', name: 'Kick', say: 'boom, or pm', cls: 'bd', v: 0, letter: 'K' },
  { k: 'sn', name: 'Snare', say: 'ka, psh or ta', cls: 'sn', v: 0, letter: 'S' },
  { k: 'sng', name: 'Ghost snare', say: 'a soft ka, or tk', cls: 'sn', v: 3, letter: 'g' },
  { k: 'hh', name: 'Hi-hat closed', say: 'ts, or ti', cls: 'hh', v: 0, letter: 'H' },
  { k: 'hho', name: 'Hi-hat open', say: 'tsss, or chi', cls: 'hh', v: 3, letter: 'O' },
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
  /** 0 = tie between two sounds, 1 = clear (taught sounds only) */
  margin?: number;
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

const melCache = new Map<number, { lo: number; c: number; hi: number }[]>();
const mel = (f: number) => 2595 * Math.log10(1 + f / 700);
const imel = (m: number) => 700 * (10 ** (m / 2595) - 1);
/** 26 triangular mel filters from 60 Hz to 11 kHz, as FFT-bin positions. */
function melBank(sr: number) {
  let b = melCache.get(sr);
  if (b) return b;
  const n = 26, lo = mel(60), hi = mel(Math.min(11000, sr / 2 - 100)), hz = sr / 1024;
  const pts = Array.from({ length: n + 2 }, (_, i) => imel(lo + ((hi - lo) * i) / (n + 1)) / hz);
  b = Array.from({ length: n }, (_, i) => ({ lo: pts[i], c: pts[i + 1], hi: pts[i + 2] }));
  melCache.set(sr, b);
  return b;
}
/** 12 MFCCs (1–12) of one 1024-sample window. */
export function mfcc(seg: ArrayLike<number>, sr: number): number[] {
  // pre-emphasis (standard for speech): tilts away from low rumble, e.g. a kick still ringing under a hi-hat
  const pe = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) pe[i] = (seg[i] || 0) - 0.97 * (i ? seg[i - 1] || 0 : 0);
  const p = fftPower(pe), bank = melBank(sr), e: number[] = [];
  for (const f of bank) {
    let q = 1e-10;
    for (let k = Math.max(1, Math.floor(f.lo)); k <= Math.min(p.length - 1, Math.ceil(f.hi)); k++) {
      const w = k < f.c ? (k - f.lo) / (f.c - f.lo) : (f.hi - k) / (f.hi - f.c);
      if (w > 0) q += w * p[k];
    }
    e.push(Math.log(q));
  }
  const N = e.length, out: number[] = [];
  for (let c = 1; c <= 12; c++) {
    let v = 0;
    for (let i = 0; i < N; i++) v += e[i] * Math.cos((Math.PI * c * (i + 0.5)) / N);
    out.push(v / N);
  }
  return out;
}
/** Length of a feature vector; taught examples of another length (an older app version) are ignored. */
export const FEATURE_LEN = 11 + 24;
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
  // timbre of the attack, and of what follows (the vowel or the hiss after a consonant)
  const attack = mfcc(seg.subarray(0, 1024), sr);
  const tail = new Array(12).fill(0);
  let nt = 0;
  for (let st = 1024; st + 512 <= seg.length && st < Math.round(sr * 0.085); st += 1024, nt++) {
    const m = mfcc(seg.subarray(st, st + 1024), sr);
    for (let i = 0; i < 12; i++) tail[i] += m[i];
  }
  const tailAvg = nt ? tail.map((x) => x / nt) : attack.slice();
  return {
    c, lo: lo / tot, hi: hi / tot, dec: decMs, pk,
    v: [
      ...band.map((b) => b / tot), Math.log2(Math.max(c, 50) / 50) / 7, Math.log2(Math.max(decMs, 5) / 5) / 6, Math.log10(Math.max(pk, 1e-4)) + 4,
      ...attack, ...tailAvg,
    ],
  };
}

// weights: band shares, brightness, ring-out, loudness, then 24 MFCCs (lighter each, there are many)
const W = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1.6, 0.8, ...new Array(12).fill(0.55), ...new Array(12).fill(0.4)];
const valid = (samples: Samples, k: SoundKey) => (samples[k] || []).filter((v) => v.length === FEATURE_LEN);
export const taughtSounds = (samples: Samples): SoundKey[] => SOUNDS.map((s) => s.k).filter((k) => valid(samples, k).length >= 2);
/** True when taught examples come from an older feature set and need teaching again. */
export const staleSamples = (samples: Samples) => SOUNDS.some((s) => (samples[s.k] || []).some((v) => v.length !== FEATURE_LEN));
/** Own sounds are used once kick, snare and closed hi-hat are taught. */
export const usesOwnSounds = (samples: Samples) => (['bd', 'sn', 'hh'] as SoundKey[]).every((k) => taughtSounds(samples).includes(k));

interface Model { all: [SoundKey, number[]][]; sd: number[] }
const models = new WeakMap<Samples, Model>();
function model(samples: Samples): Model {
  const hit = models.get(samples);
  if (hit) return hit;
  const all: [SoundKey, number[]][] = [];
  for (const k of taughtSounds(samples)) for (const x of valid(samples, k)) all.push([k, x]);
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
export function decide(f: Features, samples: Samples): Pick<Hit, 'k' | 'cls' | 'v' | 'margin'> {
  let k: SoundKey, margin: number | undefined;
  if (usesOwnSounds(samples)) ({ key: k, margin } = knn(f.v, samples));
  else k = f.lo > 0.5 || (f.lo > 0.3 && f.c < 700) ? 'bd' : f.c > 4500 || f.hi > 0.4 ? (f.dec >= 160 ? 'hho' : 'hh') : 'sn';
  const s = SOUND[k];
  return { k, cls: s.cls, v: s.v, margin };
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

/**
 * Find hits in a mono recording and classify them. Two envelopes are watched: the full signal (kicks, "ka") and its
 * high-frequency part (a soft "ts" can hide under room noise in the full signal). A hit is a clear jump above the
 * last 30 ms in either one. Hits are at least 90 ms apart, and a new hit inside a long sound needs a real new attack.
 * `sens` 1–10 (default 5): higher finds softer hits, lower ignores breaths and room noise.
 */
export function analyze(data: Float32Array, sr: number, samples: Samples, ghostPct = 45, sens = 5): Analysis {
  const hop = Math.max(1, Math.round(sr * 0.005)), nh = Math.floor(data.length / hop);
  const env = new Float32Array(nh), henv = new Float32Array(nh);
  let mx = 0, hmx = 0, prev = 0;
  for (let i = 0; i < nh; i++) {
    let q = 0, hq = 0;
    for (let k = 0; k < hop; k++) { const x = data[i * hop + k]; q += x * x; const d = x - prev; prev = x; hq += d * d; }
    env[i] = Math.sqrt(q / hop); henv[i] = Math.sqrt(hq / hop);
    if (env[i] > mx) mx = env[i];
    if (henv[i] > hmx) hmx = henv[i];
  }
  const floorF = 0.06 * 0.7 ** (sens - 5), ratio = 2.4 * 0.93 ** (sens - 5);
  const jump = (e: Float32Array, m: number, i: number) => {
    let avg = 0;
    for (let k = 2; k <= 7; k++) avg += e[i - k];
    avg /= 6;
    return e[i] > m * floorF && e[i] > avg * ratio + m * 0.01 && e[i] >= e[i - 1];
  };
  const ons: { t: number; start: number; peak: number }[] = [];
  let lastI = -1e9, lastPk = 0;
  const gap = Math.round(0.09 / 0.005);
  for (let i = 8; i < nh; i++) {
    if (i - lastI < gap) continue;
    if (!jump(env, mx, i) && !jump(henv, hmx, i)) continue;
    let pk = 0;
    for (let k = 0; k < 12 && i + k < nh; k++) pk = Math.max(pk, env[i + k]);
    // still ringing from the last hit and not much louder: same sound, not a new hit
    if (i - lastI < 60 && env[i - 1] > lastPk * 0.5 && pk < lastPk * 1.3) continue;
    ons.push({ t: (i * hop) / sr, start: Math.max(0, (i - 1) * hop), peak: pk });
    lastI = i; lastPk = pk;
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
