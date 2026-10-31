import { describe, expect, it } from 'vitest';
import { HitLog, calibrationFromHits, gridOffset, timingStats, verdict } from '../src/timing';

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
