import { describe, expect, it } from 'vitest';
import { RUDIMENTS, expectedNotes, exerciseToIdea, gradeExercise, graceSteps, passLength, type PlayedHit } from '../src';

const ex = (id: string) => RUDIMENTS.find((r) => r.id === id)!;
/** a player: every expected main note, `lean` ms late, with velocity by type */
function play(id: string, passes = 1, lean = 0, opt: { skip?: number[]; vel?: (v: number) => number; extra?: number[] } = {}) {
  const e = ex(id), idea = exerciseToIdea(e, 100);
  const exp = expectedNotes(idea, passes, graceSteps(e));
  const hits: PlayedHit[] = [];
  exp.forEach((n, i) => {
    if (opt.skip?.includes(i)) return;
    hits.push({ t: n.t + lean / 1000, id: 'sn', vel: (opt.vel ?? ((v) => (v === 2 ? 110 : v === 3 ? 40 : 80)))(n.v) });
  });
  (opt.extra ?? []).forEach((t) => hits.push({ t, id: 'sn', vel: 80 }));
  return { exp, hits, idea };
}

describe('gradeExercise', () => {
  it('a perfect paradiddle scores 100', () => {
    const { exp, hits } = play('single-paradiddle');
    const g = gradeExercise(exp, hits);
    expect(g.total).toBe(16);
    expect(g.right).toBe(16);
    expect(g.score).toBe(100);
    expect(g.accents).toEqual({ n: 4, ok: 4 });
    expect(g.evenSdMs).toBeLessThan(1);
  });
  it('a constant lean shows in the mean, and a big one makes notes late', () => {
    const { exp, hits } = play('single-paradiddle', 1, 40);
    const g = gradeExercise(exp, hits, { tolMs: 25 });
    expect(Math.round(g.meanMs)).toBe(40);
    expect(g.notes.every((n) => n.verdict === 'late')).toBe(true);
    expect(g.right).toBe(0);
  });
  it('missed notes and extra hits are counted separately', () => {
    const { exp, hits } = play('single-stroke-roll', 1, 0, { skip: [3, 9], extra: [0.05 + 0.12] });
    const g = gradeExercise(exp, hits);
    expect(g.missed).toBe(2);
    expect(g.extras).toBe(1);
    expect(g.right).toBe(14);
  });
  it('weak accents are flagged against the player\'s own plain hits', () => {
    const { exp, hits } = play('single-paradiddle', 1, 0, { vel: () => 80 });
    const g = gradeExercise(exp, hits);
    expect(g.accents.ok).toBe(0);
    expect(g.notes.filter((n) => n.verdict === 'weak').length).toBe(4);
  });
  it('hits on another instrument do not answer snare notes', () => {
    const { exp, hits } = play('single-stroke-roll');
    const g = gradeExercise(exp, hits.map((h) => ({ ...h, id: 'bd' })));
    expect(g.missed).toBe(g.total);
  });
  it('rim hits count as snare', () => {
    const { exp, hits } = play('single-stroke-roll');
    expect(gradeExercise(exp, hits.map((h) => ({ ...h, id: 'rim' }))).score).toBe(100);
  });
  it('flams: grace note 30 ms before the main note passes, no grace note fails', () => {
    const e = ex('flam'), idea = exerciseToIdea(e, 70);
    const exp = expectedNotes(idea, 1, graceSteps(e));
    const mains = exp.filter((n) => n.kind === 'main');
    expect(mains.length).toBe(4);
    const good: PlayedHit[] = mains.flatMap((m) => [{ t: m.t - 0.03, id: 'sn', vel: 40 }, { t: m.t, id: 'sn', vel: 90 }]);
    const g = gradeExercise(exp, good);
    expect(g.graces).toEqual({ n: 4, ok: 4 });
    expect(g.extras).toBe(0);
    expect(Math.round(g.notes[0].graceMs!)).toBe(30);
    const bad = gradeExercise(exp, mains.map((m) => ({ t: m.t, id: 'sn', vel: 90 })));
    expect(bad.graces).toEqual({ n: 4, ok: 0 });
  });
  it('drags need two grace notes', () => {
    const e = ex('drag'), idea = exerciseToIdea(e, 70);
    const exp = expectedNotes(idea, 1, graceSteps(e));
    const mains = exp.filter((n) => n.kind === 'main');
    const one = mains.flatMap((m) => [{ t: m.t - 0.03, id: 'sn', vel: 40 }, { t: m.t, id: 'sn', vel: 90 }]);
    expect(gradeExercise(exp, one).graces.ok).toBe(0);
    const two = mains.flatMap((m) => [{ t: m.t - 0.06, id: 'sn', vel: 40 }, { t: m.t - 0.03, id: 'sn', vel: 40 }, { t: m.t, id: 'sn', vel: 90 }]);
    expect(gradeExercise(exp, two).graces.ok).toBe(4);
  });
  it('uneven rolls show in the evenness', () => {
    const { exp, hits } = play('single-stroke-roll');
    const wobble = hits.map((h, i) => ({ ...h, t: h.t + (i % 2 ? 0.012 : -0.012) }));
    const g = gradeExercise(exp, wobble);
    expect(g.evenSdMs).toBeGreaterThan(10);
  });
  it('several passes line up end to end', () => {
    const { exp, hits, idea } = play('single-paradiddle', 3);
    expect(exp.length).toBe(48);
    expect(exp[16].t).toBeCloseTo(passLength(idea), 6);
    expect(gradeExercise(exp, hits).score).toBe(100);
  });
});

import { gradeByPass } from '../src';
describe('gradeByPass', () => {
  it('reports each pass and marks the latest one', () => {
    const e = ex('single-paradiddle'), idea = exerciseToIdea(e, 100);
    const exp = expectedNotes(idea, 3, graceSteps(e));
    // pass 0 perfect, pass 1 with two misses, pass 2 perfect
    const hits: PlayedHit[] = exp.filter((_, i) => !(i >= 16 && i < 32 && (i === 20 || i === 21))).map((n) => ({ t: n.t, id: 'sn', vel: n.v === 2 ? 110 : 80 }));
    const g = gradeByPass(idea, exp, hits, 3);
    expect(g.passes.map((p) => Math.round(p.score))).toEqual([100, 88, 100]);
    expect(g.passes[1].missed).toBe(2);
    expect(Object.keys(g.marks).length).toBe(16);
    expect(g.marks['0:0']).toBe('ok');
  });
  it('a late hit at a pass boundary is not counted twice', () => {
    const e = ex('flam'), idea = exerciseToIdea(e, 70);
    const exp = expectedNotes(idea, 2, graceSteps(e));
    const hits: PlayedHit[] = exp.filter((n) => n.kind === 'main').flatMap((m) => [{ t: m.t - 0.03, id: 'sn', vel: 40 }, { t: m.t, id: 'sn', vel: 90 }]);
    const g = gradeByPass(idea, exp, hits, 2);
    expect(g.passes.every((p) => p.extras === 0 && p.graces.ok === p.graces.n)).toBe(true);
  });
});
