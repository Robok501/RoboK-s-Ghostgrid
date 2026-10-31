/** Synthetic "voice" drum sounds for recognition tests (deterministic noise). */
export const SR = 44100;

export function rng(seed = 7) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s / 2147483647) * 2 - 1; };
}

export type SynthKind = 'bd' | 'sn' | 'hh' | 'hho';

export function sound(kind: SynthKind, R: () => number, gain = 1): Float32Array {
  const n = Math.round(SR * 0.35), o = new Float32Array(n);
  let lp = 0, hp = 0, py = 0, b1 = 0, b2 = 0;
  const jit = 1 + R() * 0.15;
  for (let i = 0; i < n; i++) {
    const t = i / SR, w = R();
    if (kind === 'bd') o[i] = Math.sin(2 * Math.PI * (110 * jit + 80 * Math.exp(-t * 25)) * t) * Math.exp(-t * 18) * 0.6 + w * Math.exp(-t * 60) * 0.25;
    if (kind === 'sn') { lp += 0.45 * (w - lp); hp = 0.6 * (hp + lp - py); py = lp; o[i] = hp * Math.exp(-t * 22) * 1.4 + Math.sin(2 * Math.PI * 350 * jit * t) * Math.exp(-t * 30) * 0.15; }
    if (kind === 'hh' || kind === 'hho') { hp = 0.5 * (hp + w - py); py = w; b1 = 0.5 * (b1 + hp - b2); b2 = hp; o[i] = b1 * Math.exp(-t * (kind === 'hh' ? 55 : 7)) * (kind === 'hh' ? 0.9 : 0.6); }
    o[i] *= gain;
  }
  return o;
}

/** Lay sounds out `gap` seconds apart, starting at 0.3 s. */
export function track(list: [SynthKind, number][], gap: number, R = rng()): Float32Array {
  const out = new Float32Array(Math.round(SR * (list.length * gap + 0.6)));
  list.forEach(([k, g], j) => {
    const s = sound(k, R, g), st = Math.round(SR * (0.3 + j * gap));
    for (let i = 0; i < s.length && st + i < out.length; i++) out[st + i] += s[i];
  });
  return out;
}
