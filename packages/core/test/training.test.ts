import { describe, expect, it } from 'vitest';
import { ClickPlan, DEFAULT_CONFIG, applyLevel, modesForLevel, programLength, type ClickStep, type TrainingConfig } from '../src/training';

const cfg = (o: Partial<TrainingConfig>): TrainingConfig => ({ ...DEFAULT_CONFIG, ...o });
const take = (p: ClickPlan, n: number) => { const out: ClickStep[] = []; for (let i = 0; i < n; i++) { const s = p.next(); if (!s) break; out.push(s); } return out; };
/** deterministic random: cycles through the given values */
const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]; };

describe('basic', () => {
  it('plays accents and subdivisions with the right durations', () => {
    const s = take(new ClickPlan(cfg({ bpm: 120, beats: 3, sub: 2, levels: [3, 2, 0] })), 6);
    expect(s.map((x) => [x.beat, x.sub, x.level])).toEqual([[0, 0, 3], [0, 1, 1], [1, 0, 2], [1, 1, 1], [2, 0, 0], [2, 1, 0]]);
    expect(s[0].duration).toBeCloseTo(0.25);
    expect(s.every((x) => x.audible)).toBe(true);
  });
});

describe('gap', () => {
  it('alternates bars with click and silent bars', () => {
    const s = take(new ClickPlan(cfg({ mode: 'gap', beats: 4, gapOn: 2, gapOff: 1 })), 4 * 6);
    const perBar = [0, 1, 2, 3, 4, 5].map((b) => s.filter((x) => x.bar === b).every((x) => x.audible));
    expect(perBar).toEqual([true, true, false, true, true, false]);
  });
});

describe('drop', () => {
  it('drops single beats only after the warm-up', () => {
    const p = new ClickPlan(cfg({ mode: 'drop', dropUnit: 'beats', dropChance: 50, dropWarm: 1 }), seq([0.1, 0.9]));
    const s = take(p, 12);
    expect(s.slice(0, 4).every((x) => x.audible)).toBe(true);
    expect(s.slice(4, 8).map((x) => x.audible)).toEqual([false, true, false, true]);
    expect(p.drops).toBe(4);
  });
  it('drops whole bars for the set length', () => {
    const p = new ClickPlan(cfg({ mode: 'drop', dropUnit: 'bars', dropChance: 50, dropLen: 2, dropWarm: 1 }), seq([0.1, 0.9]));
    const s = take(p, 4 * 5);
    const perBar = [0, 1, 2, 3, 4].map((b) => s.filter((x) => x.bar === b).every((x) => x.audible));
    expect(perBar).toEqual([true, false, false, true, false]);
  });
});

describe('ramp', () => {
  it('steps the tempo every N bars up to the target', () => {
    const s = take(new ClickPlan(cfg({ mode: 'ramp', bpm: 100, rampStep: 5, rampEvery: 2, rampTarget: 108 })), 4 * 8);
    const bpmPerBar = [0, 2, 4, 6].map((b) => s.find((x) => x.bar === b)!.bpm);
    expect(bpmPerBar).toEqual([100, 105, 108, 108]);
  });
});

describe('program', () => {
  const program = [{ bars: 1, bpm: 90, beats: 4 }, { bars: 2, bpm: 120, beats: 7 }];
  it('runs the sections in order and stops when not looping', () => {
    const s = take(new ClickPlan(cfg({ mode: 'program', program, loop: false })), 100);
    expect(s.length).toBe(4 + 7 * 2);
    expect(s[0].bpm).toBe(90);
    expect(s[4]).toMatchObject({ section: 1, sectionBar: 0, bpm: 120, beats: 7 });
    expect(s[s.length - 1]).toMatchObject({ section: 1, sectionBar: 1, beat: 6 });
  });
  it('loops and can start from a later section', () => {
    const s = take(new ClickPlan(cfg({ mode: 'program', program, loop: true }), Math.random, 1), 7 * 2 + 4 + 1);
    expect(s[0].section).toBe(1);
    expect(s[14].section).toBe(0);
    expect(s[18].section).toBe(1);
  });
  it('reports length', () => expect(programLength(program)).toEqual({ bars: 3, seconds: 4 * 60 / 90 + 14 * 60 / 120 }));
});

describe('player levels', () => {
  it('unlocks modes per level', () => {
    expect(modesForLevel(1)).toEqual(['basic', 'coach']);
    expect(modesForLevel(3)).toContain('drop');
    expect(modesForLevel(2)).not.toContain('drop');
  });
  it('resets settings a lower level hides', () => {
    expect(applyLevel({ sub: 4, mode: 'drop', unit: 8, groups: [2, 2, 3] }, 1)).toEqual({ sub: 1, mode: 'basic', unit: 4, groups: null });
    expect(applyLevel({ sub: 4, mode: 'gap' as const }, 2)).toMatchObject({ sub: 4, mode: 'gap' });
  });
});
