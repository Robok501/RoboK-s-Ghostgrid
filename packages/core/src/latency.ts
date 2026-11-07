/**
 * Latency test without a drummer: the app plays accent clicks (a 1760 Hz burst) on a known engine time and listens
 * with the microphone. This measures, per click, the time from "played" to "heard".
 * Run once over the phone speaker (baseline: the phone's own output + mic delay) and once over Bluetooth; the difference
 * is what the Bluetooth route adds.
 */

export const LOOPBACK_FREQ = 1760;

export interface LoopbackClick { sched: number; latencyMs: number | null; snr: number }
export interface LoopbackResult {
  clicks: LoopbackClick[];
  valid: number;
  medianMs: number;
  /** robust spread (1.48 × median absolute deviation), ms */
  spreadMs: number;
  minMs: number;
  maxMs: number;
  /** how the delay changes over the test, ms per 10 s (a steady creep shows here) */
  driftMsPer10s: number;
}

/** Amplitude envelope of the tone at `freq` over [from, to) samples, 1 ms steps. */
function toneEnvelope(x: Float32Array, sr: number, freq: number, from: number, to: number): { t0: number; env: number[] } {
  const hop = Math.max(1, Math.round(sr * 0.001)), win = Math.round(sr * 0.004);
  const w = (2 * Math.PI * freq) / sr;
  const env: number[] = [];
  const a = Math.max(0, from), b = Math.min(x.length - win, to);
  for (let s = a; s < b; s += hop) {
    let I = 0, Q = 0;
    for (let k = 0; k < win; k++) { const v = x[s + k]; I += v * Math.cos(w * (s + k)); Q += v * Math.sin(w * (s + k)); }
    env.push(Math.hypot(I, Q) / win);
  }
  return { t0: a, env };
}

const median = (v: number[]) => { const s = v.slice().sort((p, q) => p - q); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

/**
 * `samples`: raw mic recording starting at engine time `startTime`; `scheduled`: engine times the clicks were scheduled for.
 * A click is accepted when its tone stands out of the background (snr ≥ minSnr).
 */
export function analyzeLoopback(samples: Float32Array, sr: number, startTime: number, scheduled: number[], opts: { freq?: number; minSnr?: number; maxDelay?: number } = {}): LoopbackResult {
  const freq = opts.freq ?? LOOPBACK_FREQ, minSnr = opts.minSnr ?? 6, maxDelay = opts.maxDelay ?? 0.8;
  const hop = Math.max(1, Math.round(sr * 0.001));
  const clicks: LoopbackClick[] = scheduled.map((sched) => {
    const from = Math.round((sched - 0.03 - startTime) * sr), to = Math.round((sched + maxDelay - startTime) * sr);
    const { t0, env } = toneEnvelope(samples, sr, freq, from, to);
    if (env.length < 50) return { sched, latencyMs: null, snr: 0 };
    const peak = Math.max(...env), floor = median(env) + 1e-9;
    const snr = peak / floor;
    if (snr < minSnr) return { sched, latencyMs: null, snr };
    // onset: first step that reaches 30 % of the peak, refined between the previous step and this one
    const thr = peak * 0.3;
    let k = env.findIndex((v) => v >= thr);
    if (k < 0) return { sched, latencyMs: null, snr };
    const frac = k > 0 && env[k] > env[k - 1] ? (thr - env[k - 1]) / (env[k] - env[k - 1]) : 1;
    const idx = t0 + (k - 1 + frac) * hop;
    const heard = startTime + idx / sr;
    return { sched, latencyMs: (heard - sched) * 1000, snr };
  });
  const ok = clicks.filter((c) => c.latencyMs !== null) as { sched: number; latencyMs: number; snr: number }[];
  const lat = ok.map((c) => c.latencyMs);
  const med = median(lat);
  const spread = 1.4826 * median(lat.map((v) => Math.abs(v - med)));
  // drift: least-squares slope of latency over time
  let drift = 0;
  if (ok.length > 3) {
    const t = ok.map((c) => c.sched - ok[0].sched), mt = t.reduce((a, b) => a + b, 0) / t.length, ml = lat.reduce((a, b) => a + b, 0) / lat.length;
    const num = t.reduce((a, v, i) => a + (v - mt) * (lat[i] - ml), 0), den = t.reduce((a, v) => a + (v - mt) ** 2, 0);
    drift = den ? (num / den) * 10 : 0;
  }
  return { clicks, valid: ok.length, medianMs: med, spreadMs: spread, minMs: lat.length ? Math.min(...lat) : 0, maxMs: lat.length ? Math.max(...lat) : 0, driftMsPer10s: drift };
}

/** Click times for a test: `count` clicks starting `lead` s after `now`, with uneven gaps (1.1–1.9 s) so a room echo can't line up with the next click. */
export function loopbackSchedule(now: number, count = 20, lead = 1): number[] {
  let seed = 7, t = now + lead;
  const out: number[] = [];
  for (let i = 0; i < count; i++) { out.push(t); seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; t += 1.1 + 0.8 * (seed / 4294967295); }
  return out;
}
