import { describe, expect, it } from 'vitest';
import { Scheduler } from '../src/engine';
import { ClickPlan, DEFAULT_CONFIG, type ClickStep } from '../src/training';

describe('Scheduler', () => {
  it('keeps a lookahead window scheduled from a ClickPlan, sample-accurately spaced', () => {
    let clock = 0;
    const played: [number, number][] = [];
    const plan = new ClickPlan({ ...DEFAULT_CONFIG, bpm: 120, beats: 4 });
    const s = new Scheduler<ClickStep>({ now: () => clock }, plan, (st, t) => played.push([st.beat, t]), 0.12);
    s.start(0.1);
    expect(played).toEqual([[0, 0.1]]);
    for (clock = 0; clock < 2; clock += 0.025) s.pump();
    expect(played.slice(0, 5).map(([b]) => b)).toEqual([0, 1, 2, 3, 0]);
    played.forEach(([, t], i) => expect(t).toBeCloseTo(0.1 + i * 0.5, 9));
    expect(played[played.length - 1][1]).toBeLessThan(2 + 0.12);
  });
  it('stops by itself when the plan ends', () => {
    let clock = 0;
    const plan = new ClickPlan({ ...DEFAULT_CONFIG, mode: 'program', loop: false, program: [{ bars: 1, bpm: 240, beats: 2 }] });
    const s = new Scheduler<ClickStep>({ now: () => clock }, plan, () => {});
    s.start(0);
    for (clock = 0; clock < 2; clock += 0.025) s.pump();
    expect(s.isRunning).toBe(false);
  });
});
