import { describe, expect, it } from 'vitest';
import {
  LADDER, PASS, afterRound, bpmFromHits, gradeChoice, gradeDrift, gradeName, gradePlayback, renderClip, seeded, tempoAt,
} from '../src/tempoear';

describe('clips', () => {
  it('renders a steady groove at the right tempo', () => {
    const r = renderClip({ bpm: 120, groove: 'rock', bars: 2 });
    expect(r.length).toBeCloseTo(4);
    expect(r.avgBpm).toBeCloseTo(120);
    expect(r.events.filter((e) => e.sound === 'snare').map((e) => e.t)).toEqual([0.5, 1.5, 2.5, 3.5]);
    expect(r.events.filter((e) => e.sound.startsWith('hat')).length).toBe(16);
  });
  it('swings the shuffle on triplets', () => {
    const r = renderClip({ bpm: 60, groove: 'shuffle', bars: 1 });
    const hats = r.events.filter((e) => e.sound.startsWith('hat')).map((e) => +e.t.toFixed(3));
    expect(hats.slice(0, 2)).toEqual([0, 0.667]);
  });
  it('drifts after the steady bars', () => {
    const r = renderClip({ bpm: 100, groove: 'click', bars: 6, driftFrom: 2, driftTo: 112 });
    expect(r.beats[7].bpm).toBe(100);
    expect(r.beats[8].bpm).toBeGreaterThan(100);
    expect(r.beats[23].bpm).toBeCloseTo(112);
    expect(tempoAt(r, r.beats[23].t + 0.1)).toBeCloseTo(112);
  });
  it('wanders the same way every time for the same seed', () => {
    const c = { bpm: 120, groove: 'funk' as const, bars: 4, wander: 0.015, seed: 42 };
    expect(renderClip(c).avgBpm).toBe(renderClip(c).avgBpm);
    expect(Math.abs(renderClip(c).avgBpm - 120)).toBeLessThan(8);
  });
});

describe('hits to tempo', () => {
  it('measures the tempo of played hits and ignores double triggers', () => {
    const hits = [0, 0.5, 0.51, 1.0, 1.5, 2.0, 2.5];
    expect(bpmFromHits(hits)!.bpm).toBeCloseTo(120);
  });
  it('needs a few hits', () => expect(bpmFromHits([0, 0.5])).toBeNull());
});

describe('ladder', () => {
  it('makes valid questions for every rung', () => {
    const rand = seeded(3);
    for (const rung of LADDER) {
      for (let i = 0; i < 40; i++) {
        const q = rung.make(rand);
        expect(q.task).toBe(rung.task);
        if (q.choices) {
          expect(q.answer).toBeGreaterThanOrEqual(0);
          expect(q.answer).toBeLessThan(q.choices.length);
          expect(new Set(q.choices).size).toBe(q.choices.length);
        }
        for (const c of q.clips) { expect(c.bpm).toBeGreaterThanOrEqual(40); expect(c.bpm).toBeLessThanOrEqual(200); }
        if (q.task === 'compare' && q.choices!.length === 2) expect(q.clips[0].bpm).not.toBe(q.clips[1].bpm);
      }
    }
  });
  it('gets harder: comparison gaps shrink up the ladder', () => {
    const rand = seeded(9);
    const gap = (id: string) => { const q = LADDER.find((r) => r.id === id)!.make(rand); return Math.abs(q.clips[0].bpm - q.clips[1].bpm); };
    for (let i = 0; i < 20; i++) { expect(gap('compare-big')).toBeGreaterThanOrEqual(20); expect(gap('hair')).toBeLessThanOrEqual(4); }
  });
  it('unlocks the next rung on a pass', () => {
    expect(afterRound(0, 0, PASS)).toBe(1);
    expect(afterRound(0, 0, PASS - 1)).toBe(0);
    expect(afterRound(5, 2, 8)).toBe(5);
  });
});

describe('grading', () => {
  it('grades choices and named tempos', () => {
    const q = LADDER[0].make(seeded(1));
    expect(gradeChoice(q, q.answer!).ok).toBe(true);
    const n = { task: 'name' as const, prompt: '', clips: [], target: 120, tol: 5, reveal: '' };
    expect(gradeName(n, 124)).toMatchObject({ ok: true, error: 4 });
    expect(gradeName(n, 110).ok).toBe(false);
  });
  it('grades played-back tempo in percent', () => {
    const q = { task: 'memory' as const, prompt: '', clips: [], target: 100, tol: 5, reveal: '' };
    const hits = Array.from({ length: 8 }, (_, i) => i * 0.585); // ~102.6 BPM
    expect(gradePlayback(q, hits)).toMatchObject({ ok: true, bpm: 103 });
    expect(gradePlayback(q, Array.from({ length: 8 }, (_, i) => i * 0.5)).ok).toBe(false); // 120
  });
  it('grades drift: direction and how early you heard it', () => {
    const rung = LADDER.find((r) => r.id === 'drift')!;
    const q = rung.make(seeded(5));
    const r = renderClip(q.clips[0]);
    const from = q.clips[0].driftFrom! * 4;
    expect(gradeDrift(q, r, r.beats[from + 2].t, q.answer!).ok).toBe(true);
    expect(gradeDrift(q, r, r.beats[from + 2].t, 1 - q.answer!).ok).toBe(false);
    expect(gradeDrift(q, r, 0.2, q.answer!).text).toMatch(/Too early/);
    expect(gradeDrift(q, r, r.length - 0.1, q.answer!).ok).toBe(false);
    expect(gradeDrift(q, r, null, null).ok).toBe(false);
  });
});
