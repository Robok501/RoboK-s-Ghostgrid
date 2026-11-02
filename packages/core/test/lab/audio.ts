/** Lab helpers (local only): the native envelope ported to JS, and songs built from real drum samples. */
import { existsSync, readFileSync } from 'fs';
import type { Envelope } from '../../src/beatmap';

export const KITS = process.env.GHOSTGRID_KITS_DIR ?? '';
export const hasKits = !!KITS && existsSync(`${KITS}/Kit8-kick.f32`);
export const loadF32 = (p: string) => { const b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };

/** Same as GGStems.envelope (Swift): 100 fps RMS of full, low (1-pole 150 Hz), mid (2-pole 2.5k − 2-pole 200), high (x − 2-pole 7k). */
export function envelope(x: Float32Array, sr = 44100): Envelope {
  const hop = Math.round(sr / 100), co = (f: number) => 1 - Math.exp((-2 * Math.PI * f) / sr);
  const a = co(150), aM1 = co(200), aM2 = co(2500), aH = co(7000);
  let lp = 0, m1a = 0, m1b = 0, m2a = 0, m2b = 0, h1 = 0, h2 = 0, aF = 0, aL = 0, aM = 0, aHh = 0, k = 0;
  const full: number[] = [], low: number[] = [], mid: number[] = [], high: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    lp += a * (v - lp);
    m1a += aM1 * (v - m1a); m1b += aM1 * (m1a - m1b);
    m2a += aM2 * (v - m2a); m2b += aM2 * (m2a - m2b);
    h1 += aH * (v - h1); h2 += aH * (h1 - h2);
    const md = m2b - m1b, hi = v - h2;
    aF += v * v; aL += lp * lp; aM += md * md; aHh += hi * hi;
    if (++k === hop) {
      full.push(Math.sqrt(aF / hop)); low.push(Math.sqrt(aL / hop)); mid.push(Math.sqrt(aM / hop)); high.push(Math.sqrt(aHh / hop));
      aF = aL = aM = aHh = 0; k = 0;
    }
  }
  return { rate: 100, full, low, mid, high };
}

export type Drum = 'bd' | 'sn' | 'sng' | 'hh' | 'hho';
/** A song from real samples: pattern per bar in beats, with velocity, timing feel, room reverb and bass bleed. */
export function sampleSong(kit: string, pattern: [number, Drum][], bars: number, bpm: number, opts: { start?: number; swing?: number; bleed?: number; reverb?: number; dirty?: number } = {}) {
  const sr = 44100, beat = 60 / bpm, start = opts.start ?? 1.3;
  const S = { bd: loadF32(`${KITS}/${kit}-kick.f32`), sn: loadF32(`${KITS}/${kit}-snare.f32`), hh: loadF32(`${KITS}/${kit}-hihat.f32`) };
  const n = Math.ceil((start + bars * 4 * beat + 2) * sr), out = new Float32Array(n);
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const truth: { t: number; beat: number; k: Drum }[] = [];
  for (let b = 0; b < bars; b++) for (const [x, k] of pattern) {
    const sw = opts.swing && Math.abs((x * 2) % 1 - 1) < 1e-6 ? opts.swing * beat : 0;
    const t = start + (b * 4 + x) * beat + sw + rnd() * 0.016;
    truth.push({ t, beat: b * 4 + x, k });
    const smp = k === 'sng' ? S.sn : k === 'hho' ? S.hh : S[k];
    const g = (k === 'sng' ? 0.22 : k === 'hh' ? 0.55 : 0.9) * (1 + rnd() * 0.35);
    const t0 = Math.round(t * sr);
    // open hi-hat: the sample, stretched into a longer ring
    const len = k === 'hho' ? Math.round(0.45 * sr) : smp.length;
    for (let j = 0; j < len && t0 + j < n; j++) {
      const v = k === 'hho' ? smp[j % Math.min(smp.length, 4000)] * Math.exp(-j / (0.18 * sr)) * (j < 4000 ? 1 : 0.8) : smp[j];
      out[t0 + j] += g * v;
    }
  }
  // room: a few early reflections and a soft tail
  const rv = opts.reverb ?? 0.25;
  if (rv > 0) {
    const tail = new Float32Array(n);
    for (const [d, gg] of [[0.011, 0.5], [0.023, 0.35], [0.037, 0.3], [0.051, 0.22]] as const) { const D = Math.round(d * sr); for (let i = D; i < n; i++) tail[i] += out[i - D] * gg * rv; }
    let z = 0; const fb = Math.round(0.067 * sr);
    for (let i = fb; i < n; i++) { z = tail[i - fb] * 0.55; tail[i] += z * rv; }
    for (let i = 0; i < n; i++) out[i] += tail[i];
  }
  // what separation leaves: bass guitar (a plucked note every 8th), guitar/vocal smear in the mids, cymbal wash
  const bl = opts.bleed ?? 0.04, dirty = opts.dirty ?? 0;
  let lpN = 0, lpN2 = 0, hpPrev = 0, wash = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, tb = (t - start) / (beat / 2), k8 = Math.floor(tb);
    const note = [55, 73.4, 65.4, 49][Math.floor((t - start) / (4 * beat)) & 3] * (k8 % 4 === 3 ? 1.5 : 1);
    const pluck = t > start ? 0.6 + 0.4 * Math.exp(-(tb - k8) * 3) : 0.6;
    out[i] += (bl + dirty * 0.25) * pluck * Math.sin(2 * Math.PI * note * t) + 0.002 * rnd();
    if (dirty) {
      const w = rnd() * 2;
      lpN += 0.08 * (w - lpN); lpN2 += 0.3 * (lpN - lpN2);
      // a slowly swelling mid-range smear (vocals, guitars) and a high wash (ride, reverb)
      const swell = 0.6 + 0.4 * Math.sin(2 * Math.PI * t / (8 * beat));
      out[i] += dirty * 0.5 * swell * (lpN - lpN2) * 4;
      const hp = w - hpPrev; hpPrev = w; wash += 0.5 * (hp - wash);
      out[i] += dirty * 0.06 * wash;
    }
  }
  return { audio: out, truth, beat, start };
}
