import { describe, expect, it } from 'vitest';
import { LIBRARY, RUDIMENTS, exerciseToIdea, stickingLine } from '../src';

describe('practice library', () => {
  it('every exercise builds a valid idea', () => {
    for (const e of LIBRARY) {
      const idea = exerciseToIdea(e);
      expect(idea.bars.length).toBe(e.bars.length);
      expect(idea.bars[0].n.sn.length).toBe(e.beats * e.grid);
      expect(idea.bpm).toBeGreaterThanOrEqual(e.bpm[0]);
      expect(idea.bpm).toBeLessThanOrEqual(e.bpm[1]);
      expect(stickingLine(e).length).toBeGreaterThan(0);
    }
  });
  it('ids are unique and everything is credited as own work', () => {
    expect(new Set(LIBRARY.map((e) => e.id)).size).toBe(LIBRARY.length);
    expect(LIBRARY.every((e) => e.credit.startsWith('Ghostgrid'))).toBe(true);
  });
  it('single paradiddle: 16 notes, accents on every 4th', () => {
    const e = RUDIMENTS.find((r) => r.id === 'single-paradiddle')!;
    const s = exerciseToIdea(e).bars[0].n.sn;
    expect(s.filter(Boolean).length).toBe(16);
    expect(s.map((v, i) => (v === 2 ? i : -1)).filter((i) => i >= 0)).toEqual([0, 4, 8, 12]);
  });
  it('a flam puts its grace note before the beat, and the first one wraps to the end so the loop has no gap', () => {
    const e = RUDIMENTS.find((r) => r.id === 'flam')!;
    const s = exerciseToIdea(e).bars[0].n.sn;
    expect(s[0]).toBe(1);
    expect(s[7]).toBe(3);   // grace of the second flam (on step 8)
    expect(s[31]).toBe(3);  // grace of the first flam wraps to the last step
  });
  it('a drag has two graces', () => {
    const s = exerciseToIdea(RUDIMENTS.find((r) => r.id === 'drag')!).bars[0].n.sn;
    expect([s[6], s[7], s[8]]).toEqual([3, 3, 1]);
  });
  it('rejects a bar of the wrong length', () => {
    const bad = { ...RUDIMENTS[0], bars: ['xxx'] };
    expect(() => exerciseToIdea(bad)).toThrow();
  });
});
