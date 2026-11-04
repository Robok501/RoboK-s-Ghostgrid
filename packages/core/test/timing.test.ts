import { describe, expect, it } from 'vitest';
import { HitLog, barDrift, calibrationFromHits, gridOffset, timingStats, verdict } from '../src/timing';

describe('gridOffset', () => {
  const grid = [0, 0.5, 1, 1.5];
  it('finds the nearest click', () => {
    expect(gridOffset(0.52, grid, 0.5)).toBeCloseTo(0.02);
    expect(gridOffset(0.97, grid, 0.5)).toBeCloseTo(-0.03);
  });
  it('ignores hits halfway between clicks', () => expect(gridOffset(0.75, grid, 0.5)).toBeNull());
  it('handles an empty grid', () => expect(gridOffset(1, [], 0.5)).toBeNull());
});

describe('stats', () => {
  it('computes mean, spread and score', () => {
    const s = timingStats([-10, 0, 10, 40], 15);
    expect(s).toMatchObject({ n: 4, mean: 10, score: 75 });
    expect(s.sd).toBeCloseTo(18.71, 1);
  });
  it('judges single hits', () => {
    expect(verdict(-20, 15)).toBe('early');
    expect(verdict(12, 15)).toBe('on');
    expect(verdict(30, 15)).toBe('late');
  });
});

describe('calibration', () => {
  it('uses the median after two settling hits and returns the correction', () => {
    expect(calibrationFromHits([200, -90, 40, 42, 38, 45, 41, 39])).toBe(-41);
  });
  it('clamps large values', () => expect(calibrationFromHits([0, 0, 400, 400, 400])).toBe(-250));
});

describe('HitLog', () => {
  it('keeps a rolling window per pad', () => {
    const log = new HitLog(3);
    [1, 2, 3, 4].forEach((v) => log.add(v, 'bd'));
    log.add(9, 'sn');
    expect(log.all).toEqual([3, 4, 9]);
    expect(log.byPad).toEqual({ bd: [2, 3, 4], sn: [9] });
  });
});

describe('calibration near half a beat (Bluetooth)', async () => {
  const { calibrateOnBeat, gridOffset } = await import('../src/timing');
  it('one cluster across the half-way point, and scoring after it lands on the beat', () => {
    const beat = 500, delay = 245; // ms; hits heard 245 ms late at 120 BPM, a little jitter
    const grid = Array.from({ length: 40 }, (_, i) => i * 0.5);
    const jit = [0, 12, -9, 15, -14, 8, -6, 11, -12, 5];
    const raw = jit.map((j, i) => gridOffset(4 + i * 0.5 + (delay + j) / 1000, grid, 0.5, 1)! * 1000);
    expect(raw.some((x) => x < 0) && raw.some((x) => x > 0)).toBe(true); // they wrap
    const { fix, spread } = calibrateOnBeat(raw, beat);
    expect(Math.abs(fix + delay)).toBeLessThan(10);
    expect(spread).toBeLessThan(20);
    // after the fix, a hit right on the heard click scores near 0
    const off = gridOffset(10 + (delay + 3) / 1000 + fix / 1000, grid, 0.5)! * 1000;
    expect(Math.abs(off)).toBeLessThan(15);
  });
});

describe('barDrift', () => {
  it('averages the hits of each bar, in bar order, and skips hits without a bar', () => {
    const log = new HitLog();
    log.add(-10, 'sn', 1, 2); log.add(-20, 'sn', 2, 2); log.add(10, 'bd', 3, 1); log.add(99, 'bd', 4);
    const d = barDrift(log.events);
    expect(d.map((x) => x.bar)).toEqual([1, 2]);
    expect(d[0]).toMatchObject({ n: 1, mean: 10, sd: 0 });
    expect(d[1].mean).toBeCloseTo(-15); expect(d[1].sd).toBeCloseTo(5); expect(d[1].n).toBe(2);
  });
});

import { correctedScore, autoGrade } from '../src/timing';
describe('lean-corrected score and auto grade', () => {
  it('removes a constant lean', () => {
    const v = [30, 28, 32, 31, 29, 30, 33, 27];
    expect(correctedScore(v, 25)).toBe(100);
  });
  it('chooses the coarsest grid that fits', () => {
    const beat = 500;
    const quarters = Array.from({ length: 20 }, (_, i) => (i % 3) - 1);
    expect(autoGrade(quarters, beat)).toBe(1);
    const eighths = Array.from({ length: 20 }, (_, i) => (i % 2 ? 250 : 0) + (i % 3) - 1).map((x) => (x > 250 ? x - 500 : x));
    expect(autoGrade(eighths, beat)).toBe(2);
    const sixteenths = Array.from({ length: 20 }, (_, i) => [0, 125, -125, 250][i % 4] + 2);
    expect(autoGrade(sixteenths, beat)).toBe(4);
  });
  it('counts off-grid hits and pad means', () => {
    const l = new HitLog();
    for (let i = 0; i < 5; i++) l.add(10, 'snare');
    l.addOff('snare');
    expect(l.offGrid).toBe(1);
    expect(l.padMean('snare')).toBe(10);
    expect(l.padMean('kick')).toBeNull();
    l.reset();
    expect(l.offGrid).toBe(0);
  });
});
