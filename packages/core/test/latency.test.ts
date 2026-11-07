import { describe, expect, it } from 'vitest';
import { analyzeLoopback, loopbackSchedule, LOOPBACK_FREQ } from '../src';

const SR = 48000;
function synth(scheduled: number[], startTime: number, delay: (i: number) => number, noise = 0.02, secs = 45) {
  const x = new Float32Array(SR * secs);
  let seed = 1; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967295 * 2 - 1; };
  for (let i = 0; i < x.length; i++) x[i] = rnd() * noise;
  scheduled.forEach((s, n) => {
    const a = Math.round((s + delay(n) - startTime) * SR);
    for (let k = 0; k < SR * 0.045; k++) { const t = k / SR; x[a + k] += Math.sin(2 * Math.PI * LOOPBACK_FREQ * t) * Math.min(1, t / 0.0015) * Math.exp(-t / 0.009) * 0.5; }
  });
  return x;
}

describe('analyzeLoopback', () => {
  const sched = loopbackSchedule(10, 20);
  it('measures a constant delay to within a couple of ms', () => {
    const r = analyzeLoopback(synth(sched, 9.5, () => 0.146), SR, 9.5, sched);
    expect(r.valid).toBe(20);
    expect(Math.abs(r.medianMs - 146)).toBeLessThan(2.5);
    expect(r.spreadMs).toBeLessThan(1.5);
  });
  it('reports jitter', () => {
    const r = analyzeLoopback(synth(sched, 9.5, (i) => 0.1 + (i % 2 ? 0.02 : 0)), SR, 9.5, sched);
    expect(r.spreadMs).toBeGreaterThan(8);
  });
  it('sees a delay that creeps up', () => {
    const r = analyzeLoopback(synth(sched, 9.5, (i) => 0.1 + i * 0.002), SR, 9.5, sched);
    expect(r.driftMsPer10s).toBeGreaterThan(5);
  });
  it('a silent room gives no valid clicks', () => {
    const r = analyzeLoopback(synth([], 9.5, () => 0), SR, 9.5, sched);
    expect(r.valid).toBe(0);
  });
  it('survives loud broadband noise', () => {
    const r = analyzeLoopback(synth(sched, 9.5, () => 0.2, 0.15), SR, 9.5, sched);
    expect(r.valid).toBeGreaterThan(17);
    expect(Math.abs(r.medianMs - 200)).toBeLessThan(3);
  });
});
