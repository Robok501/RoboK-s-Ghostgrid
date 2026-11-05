/**
 * Grading a practice exercise against its score: which notes you hit, how early or late, accents, flams, roll evenness.
 * Pure functions on times in seconds (same origin for the expected notes and the hits), so they are testable without a phone.
 */
import { barSteps, stepTime, type Idea, type InstrumentId, type NoteState } from './groove';

export interface ExpectedNote {
  /** seconds from the start of the first pass */
  t: number;
  id: InstrumentId;
  /** 1 hit, 2 accent, 3 ghost (grace notes: 3) */
  v: NoteState;
  pass: number;
  bar: number;
  step: number;
  kind: 'main' | 'grace';
  /** for a grace note: index (into the same list) of the main note it belongs to */
  main?: number;
}
export interface PlayedHit { t: number; id: string; vel: number }

/** A kit voice for matching: the rim counts as snare, the open hi-hat as hi-hat. */
export const voiceOf = (id: string): string => (id === 'rim' ? 'sn' : id === 'hh+o' ? 'hh' : id);

/** Length in seconds of one pass over the idea. */
export function passLength(idea: Idea): number {
  const last = idea.bars.length;
  return stepTime(idea, last, 0);
}

/**
 * The notes to play over `passes` passes of the idea. A note that is a grace note in the exercise (a ghost note one or two steps
 * before a main note of the same instrument, and not itself on a beat of its own) is marked as such so flams and drags can be graded as a pair.
 * `graces` lists the steps of the exercise that are grace notes (from `exerciseToIdea`'s pattern); without it all notes are main notes.
 */
export function expectedNotes(idea: Idea, passes = 1, graces?: Set<string>): ExpectedNote[] {
  const out: ExpectedNote[] = [];
  const len = passLength(idea);
  for (let p = 0; p < passes; p++) {
    const first = out.length;
    idea.bars.forEach((bar, b) => {
      for (let s = 0; s < barSteps(idea, b); s++) for (const id of Object.keys(bar.n) as InstrumentId[]) {
        const v = bar.n[id][s];
        if (!v) continue;
        const isGrace = !!graces?.has(`${b}:${s}:${id}`);
        out.push({ t: p * len + stepTime(idea, b, s), id, v, pass: p, bar: b, step: s, kind: isGrace ? 'grace' : 'main' });
      }
    });
    // link each grace note to the next main note of the same instrument, wrapping around the loop
    const mine = out.slice(first).map((n, i) => ({ n, i: first + i }));
    for (const g of mine.filter((m) => m.n.kind === 'grace')) {
      let best = -1, bestDt = Infinity;
      for (const m of mine) {
        if (m.n.kind !== 'main' || m.n.id !== g.n.id) continue;
        let dt = m.n.t - g.n.t;
        if (dt <= 0) dt += len;
        if (dt < bestDt) { bestDt = dt; best = m.i; }
      }
      if (best >= 0) out[g.i].main = best;
    }
  }
  return out;
}

export type NoteVerdict = 'ok' | 'early' | 'late' | 'missed' | 'weak' | 'loud';
export interface NoteResult {
  /** index into the expected list */
  exp: number;
  verdict: NoteVerdict;
  /** ms, + = late; only for matched main notes */
  dtMs?: number;
  /** index of the matched hit */
  hit?: number;
  /** for a main note that has grace notes: were they played, and the spacing in ms before the main note */
  graceOk?: boolean;
  graceMs?: number;
}
export interface ExerciseGrade {
  notes: NoteResult[];
  /** hits that matched nothing */
  extra: number[];
  right: number;
  total: number;
  missed: number;
  extras: number;
  accents: { n: number; ok: number };
  graces: { n: number; ok: number };
  meanMs: number;
  sdMs: number;
  /** spread of the gaps between consecutive matched notes, ms (0 when fewer than 3 matched) */
  evenSdMs: number;
  /** 0–100: notes right and on time, minus extras */
  score: number;
}

export interface GradeOptions {
  /** on-time window in ms (default 25) */
  tolMs?: number;
  /** how far from an expected note a hit may still count as that note, ms (default: 40% of the shortest gap, at most 110) */
  reachMs?: number;
  /** grace note spacing window before the main note, ms */
  graceMs?: [number, number];
  /** accent must be at least this many times the median plain hit; ghost at most this fraction */
  accentRatio?: number;
  ghostRatio?: number;
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

export function gradeExercise(expected: ExpectedNote[], hits: PlayedHit[], opt: GradeOptions = {}): ExerciseGrade {
  const tol = opt.tolMs ?? 25;
  const [gLo, gHi] = opt.graceMs ?? [8, 80];
  const accentRatio = opt.accentRatio ?? 1.2, ghostRatio = opt.ghostRatio ?? 0.75;
  const mains = expected.map((e, i) => ({ e, i })).filter((m) => m.e.kind === 'main');
  // reach: how far a hit may be from the note it answers
  let minGap = Infinity;
  const ts = mains.map((m) => m.e.t).sort((a, b) => a - b);
  for (let k = 1; k < ts.length; k++) if (ts[k] - ts[k - 1] > 0.001) minGap = Math.min(minGap, ts[k] - ts[k - 1]);
  const reach = (opt.reachMs ?? Math.min(110, Number.isFinite(minGap) ? minGap * 400 : 110)) / 1000;

  // 1. match hits to main notes, closest pairs first, one hit per note
  const cand: { h: number; m: number; d: number }[] = [];
  hits.forEach((h, hi) => mains.forEach((m, mi) => {
    if (voiceOf(h.id) !== voiceOf(m.e.id)) return;
    const d = h.t - m.e.t;
    if (Math.abs(d) <= reach) cand.push({ h: hi, m: mi, d });
  }));
  cand.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
  const hitOf = new Map<number, number>(), noteOf = new Map<number, number>();
  for (const c of cand) {
    if (hitOf.has(c.m) || noteOf.has(c.h)) continue;
    hitOf.set(c.m, c.h); noteOf.set(c.h, c.m);
  }

  // 2. accent and ghost strength relative to this player's plain hits
  const plain = mains.flatMap((m, mi) => (m.e.v === 1 && hitOf.has(mi) ? [hits[hitOf.get(mi)!].vel] : []));
  const ref = median(plain);

  const notes: NoteResult[] = [];
  const used = new Set(noteOf.keys());
  const dts: number[] = [];
  let right = 0, aN = 0, aOk = 0, gN = 0, gOk = 0;
  const matchedT: number[] = [];
  mains.forEach((m, mi) => {
    const hi = hitOf.get(mi);
    if (hi === undefined) { notes.push({ exp: m.i, verdict: 'missed' }); return; }
    const dtMs = (hits[hi].t - m.e.t) * 1000;
    dts.push(dtMs); matchedT.push(hits[hi].t);
    let verdict: NoteVerdict = Math.abs(dtMs) <= tol ? 'ok' : dtMs < 0 ? 'early' : 'late';
    if (ref > 0 && m.e.v === 2) { aN++; if (hits[hi].vel >= ref * accentRatio) aOk++; else if (verdict === 'ok') verdict = 'weak'; }
    else if (ref > 0 && m.e.v === 3) { if (hits[hi].vel > ref * ghostRatio && verdict === 'ok') verdict = 'loud'; }
    if (verdict === 'ok') right++;
    notes.push({ exp: m.i, verdict, dtMs, hit: hi });
  });

  // 3. grace notes: leftover hits of the same instrument shortly before a matched main note
  const graceOf = new Map<number, ExpectedNote[]>();
  expected.forEach((e) => { if (e.kind === 'grace' && e.main !== undefined) (graceOf.get(e.main) ?? graceOf.set(e.main, []).get(e.main)!).push(e); });
  for (const r of notes) {
    const gs = graceOf.get(r.exp);
    if (!gs || r.hit === undefined) continue;
    const mainT = hits[r.hit].t;
    const found = hits.map((h, hi) => ({ h, hi })).filter(({ h, hi }) => !used.has(hi) && voiceOf(h.id) === voiceOf(expected[r.exp].id)
      && mainT - h.t >= gLo / 1000 && mainT - h.t <= gHi / 1000).sort((a, b) => b.h.t - a.h.t);
    gN++;
    if (found.length >= gs.length) {
      const take = found.slice(0, gs.length);
      take.forEach((f) => used.add(f.hi));
      r.graceOk = true; r.graceMs = (mainT - take[take.length - 1].h.t) * 1000; gOk++;
    } else r.graceOk = false;
  }

  const extra = hits.map((_, hi) => hi).filter((hi) => !used.has(hi));
  const mean = dts.length ? dts.reduce((a, b) => a + b, 0) / dts.length : 0;
  const sd = dts.length ? Math.sqrt(dts.reduce((a, b) => a + (b - mean) ** 2, 0) / dts.length) : 0;
  matchedT.sort((a, b) => a - b);
  const gaps = matchedT.slice(1).map((t, k) => (t - matchedT[k]) * 1000);
  const gm = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const evenSd = gaps.length >= 2 ? Math.sqrt(gaps.reduce((a, b) => a + (b - gm) ** 2, 0) / gaps.length) : 0;
  const total = mains.length;
  return {
    notes, extra, right, total, missed: notes.filter((n) => n.verdict === 'missed').length, extras: extra.length,
    accents: { n: aN, ok: aOk }, graces: { n: gN, ok: gOk }, meanMs: mean, sdMs: sd, evenSdMs: evenSd,
    score: total ? Math.max(0, (right / (total + extra.length)) * 100) : 0,
  };
}

export interface PassSummary {
  pass: number;
  right: number;
  total: number;
  missed: number;
  extras: number;
  /** 0–100 */
  score: number;
  meanMs: number;
  sdMs: number;
  accents: { n: number; ok: number };
  graces: { n: number; ok: number };
}
export interface PracticeGrade extends ExerciseGrade { passes: PassSummary[]; marks: Record<string, NoteVerdict> }

/**
 * Grade several passes at once (so a note played a little late at a pass boundary is never counted twice) and report each pass
 * separately. `marks` colours the notes of the latest pass on the score, keyed `bar:step`.
 */
export function gradeByPass(idea: Idea, expected: ExpectedNote[], hits: PlayedHit[], passes: number, opt: GradeOptions = {}): PracticeGrade {
  const g = gradeExercise(expected, hits, opt);
  const len = passLength(idea);
  const per: PassSummary[] = Array.from({ length: passes }, (_, pass) => ({
    pass, right: 0, total: 0, missed: 0, extras: 0, score: 0, meanMs: 0, sdMs: 0, accents: { n: 0, ok: 0 }, graces: { n: 0, ok: 0 },
  }));
  const dts: number[][] = per.map(() => []);
  const marks: Record<string, NoteVerdict> = {};
  for (const r of g.notes) {
    const e = expected[r.exp], p = per[e.pass];
    if (!p) continue;
    p.total++;
    if (r.verdict === 'ok') p.right++;
    if (r.verdict === 'missed') p.missed++;
    if (r.dtMs !== undefined) dts[e.pass].push(r.dtMs);
    if (e.v === 2 && r.dtMs !== undefined) { p.accents.n++; if (r.verdict !== 'weak') p.accents.ok++; }
    if (r.graceOk !== undefined) { p.graces.n++; if (r.graceOk) p.graces.ok++; }
    if (e.pass === passes - 1) marks[`${e.bar}:${e.step}`] = r.verdict;
  }
  for (const hi of g.extra) {
    const p = Math.min(passes - 1, Math.max(0, Math.floor((hits[hi].t + 0.1) / len)));
    per[p].extras++;
  }
  per.forEach((p, i) => {
    const d = dts[i];
    p.meanMs = d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0;
    p.sdMs = d.length ? Math.sqrt(d.reduce((a, b) => a + (b - p.meanMs) ** 2, 0) / d.length) : 0;
    p.score = p.total ? Math.max(0, (p.right / (p.total + p.extras)) * 100) : 0;
  });
  return { ...g, passes: per, marks };
}
