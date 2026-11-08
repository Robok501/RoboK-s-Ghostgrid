import { describe, expect, it } from 'vitest';
import { analyzeClocks, type ClockSample } from '../src/clockcheck';

const make = (n: number, engineRate: number, micRate: number, noise = 0): ClockSample[] =>
  Array.from({ length: n }, (_, i) => ({ wall: i, engine: 3 + i * engineRate + noise * Math.sin(i * 7), mic: 0.2 + i * micRate }));

describe('clock check', () => {
  it('agrees when the clocks run together', () => {
    const r = analyzeClocks(make(90, 1, 1.00003));
    expect(r.verdict).toBe('agree');
    expect(Math.abs(r.micVsEnginePpm - 30)).toBeLessThan(2);
  });
  it('finds a 0.2% mismatch between mic and engine', () => {
    const r = analyzeClocks(make(90, 1, 1.00197));
    expect(r.verdict).toBe('mismatch');
    expect(r.creepMsPer10s).toBeCloseTo(19.7, 0);
    expect(Math.abs(r.engineVsWallPpm)).toBeLessThan(2);
  });
  it('flags an engine that runs against the wall clock', () => {
    expect(analyzeClocks(make(90, 1.002, 1.002)).verdict).toBe('mismatch');
  });
  it('does not cry wolf when the mic count moves in 0.1 s steps', () => {
    const s = make(90, 1, 1.0005).map((p) => ({ ...p, mic: Math.floor(p.mic * 10) / 10 }));
    expect(analyzeClocks(s).verdict).not.toBe('mismatch');
  });
  it('says unclear for too little data', () => {
    expect(analyzeClocks(make(3, 1, 1)).verdict).toBe('unclear');
  });
  it('shrugs off a little noise', () => {
    expect(analyzeClocks(make(90, 1, 1, 0.002)).verdict).toBe('agree');
  });
});
