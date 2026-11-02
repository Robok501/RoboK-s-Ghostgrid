/**
 * Tempo trainer ("tempo ear"): learn to judge how fast music is.
 * A graded ladder from "which one is faster?" up to naming a tempo and playing it cold.
 * Pure data and functions: clips are rendered to timed drum events, the app plays them.
 */
import { tr } from './i18n';

export type Groove = 'click' | 'rock' | 'funk' | 'shuffle' | 'halftime' | 'busy';
/** Sounds the engine can play for clips. The index is what the native engine receives. */
export const DRUM_SOUNDS = ['kick', 'snare', 'ghost', 'hat', 'hatAcc', 'open', 'click', 'clickAcc', 'tom1', 'tom2', 'ftom', 'ride', 'crash', 'hhFoot', 'rim'] as const;
export type DrumSound = (typeof DRUM_SOUNDS)[number];

export const GROOVE_NAMES: Record<Groove, string> = {
  click: 'Click', rock: 'Rock', funk: 'Funk', shuffle: 'Shuffle', halftime: 'Half-time', busy: 'Busy 16ths',
};

/** One bar of 4/4: steps per beat, and which steps each sound plays on. */
const PATTERNS: Record<Groove, { grid: number; parts: [DrumSound, number[]][] }> = {
  click: { grid: 1, parts: [['clickAcc', [0]], ['click', [1, 2, 3]]] },
  rock: { grid: 2, parts: [['hatAcc', [0, 2, 4, 6]], ['hat', [1, 3, 5, 7]], ['kick', [0, 4, 5]], ['snare', [2, 6]]] },
  funk: {
    grid: 4,
    parts: [['hatAcc', [0, 2, 4, 6, 8, 10, 12, 14]], ['hat', [1, 3, 5, 9, 11, 13, 15]], ['open', [7]], ['kick', [0, 3, 10]], ['snare', [4, 12]], ['ghost', [7, 9, 15]]],
  },
  shuffle: { grid: 3, parts: [['hatAcc', [0, 3, 6, 9]], ['hat', [2, 5, 8, 11]], ['kick', [0, 6, 8]], ['snare', [3, 9]]] },
  halftime: { grid: 4, parts: [['hat', [0, 2, 4, 6, 8, 10, 12, 14]], ['kick', [0, 3, 6]], ['snare', [8]], ['ghost', [13]]] },
  busy: {
    grid: 4,
    parts: [['hatAcc', [0, 4, 8, 12]], ['hat', [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 15]], ['open', [14]], ['kick', [0, 3, 6, 10, 11]], ['snare', [4, 12]], ['ghost', [2, 7, 9, 15]]],
  },
};

export interface Clip {
  bpm: number;
  groove: Groove;
  bars: number;
  /** Tempo glides to this BPM, starting at bar `driftFrom` (0-based). */
  driftTo?: number;
  driftFrom?: number;
  /** Live-player wander: random walk per bar, as a fraction (0.015 = ±1.5 % steps). */
  wander?: number;
  seed?: number;
}
export interface ClipEvent { t: number; sound: DrumSound }
export interface RenderedClip { events: ClipEvent[]; beats: { t: number; bpm: number }[]; length: number; avgBpm: number }

/** Small seeded random generator, so a clip sounds the same every time it is replayed. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Tempo for every beat of the clip. */
function beatTempos(c: Clip): number[] {
  const n = c.bars * 4, out: number[] = [];
  const rand = seeded(c.seed ?? 7);
  let w = 1;
  const from = (c.driftFrom ?? 0) * 4;
  for (let b = 0; b < n; b++) {
    if (c.wander && b % 4 === 0 && b > 0) w = Math.max(1 - 3 * c.wander, Math.min(1 + 3 * c.wander, w + (rand() * 2 - 1) * c.wander));
    let bpm = c.bpm;
    if (c.driftTo !== undefined && b >= from) bpm = c.bpm + (c.driftTo - c.bpm) * ((b - from + 1) / Math.max(1, n - from));
    out.push(bpm * w);
  }
  return out;
}

/** Turn a clip into timed drum events (seconds from the clip start). */
export function renderClip(c: Clip): RenderedClip {
  const p = PATTERNS[c.groove];
  const tempos = beatTempos(c);
  const events: ClipEvent[] = [], beats: RenderedClip['beats'] = [];
  let t = 0;
  tempos.forEach((bpm, b) => {
    const len = 60 / bpm;
    beats.push({ t, bpm });
    const inBar = b % 4;
    for (const [sound, steps] of p.parts) {
      for (const st of steps) {
        if (Math.floor(st / p.grid) !== inBar) continue;
        events.push({ t: t + ((st % p.grid) / p.grid) * len, sound });
      }
    }
    t += len;
  });
  events.sort((a, b) => a.t - b.t);
  return { events, beats, length: t, avgBpm: (tempos.length * 60) / t };
}

/** The tempo being played at time `t` (seconds from the clip start). */
export function tempoAt(r: RenderedClip, t: number): number {
  let bpm = r.beats[0]?.bpm ?? 0;
  for (const b of r.beats) { if (b.t > t) break; bpm = b.bpm; }
  return bpm;
}

/** Tempo of played hits: median interval, ignoring double triggers. */
export function bpmFromHits(times: number[]): { bpm: number; spreadMs: number } | null {
  const iv: number[] = [];
  for (let i = 1; i < times.length; i++) { const d = times[i] - times[i - 1]; if (d > 0.15 && d < 2.5) iv.push(d); }
  if (iv.length < 3) return null;
  const sorted = iv.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
  const sd = Math.sqrt(iv.reduce((a, b) => a + (b - mean) ** 2, 0) / iv.length);
  return { bpm: 60 / med, spreadMs: sd * 1000 };
}

// ---------------------------------------------------------------- the ladder

export type Task = 'compare' | 'anchor' | 'choose' | 'range' | 'name' | 'drift' | 'hold' | 'memory' | 'cold';

export interface Question {
  task: Task;
  prompt: string;
  /** Played one after the other (compare: A then B). Empty for cold count-offs. */
  clips: Clip[];
  choices?: string[];
  answer?: number;
  /** BPM to name or to play. */
  target?: number;
  /** Allowed error: BPM for naming, percent for playing. */
  tol?: number;
  /** Shown after answering. */
  reveal: string;
}

export interface Rung { id: string; tier: 1 | 2 | 3 | 4; name: string; blurb: string; task: Task; make: (rand: () => number) => Question }

export const ANCHORS = [60, 90, 120, 160];
export const TIER_NAMES = ['', 'First Sticks', 'Groove', 'Chops', 'Session Pro'];
export const ROUND = 8;
export const PASS = 6;
/** Hits asked for in playing tasks. */
export const PLAY_HITS = 8;

const pick = <T,>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length) % xs.length];
const between = (rand: () => number, lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));
const seedOf = (rand: () => number) => Math.floor(rand() * 1e9);
const shuffle = <T,>(rand: () => number, xs: T[]) => {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

function compare(rand: () => number, gap: [number, number], grooves: Groove[], opts: { same?: boolean; mixGrooves?: boolean } = {}): Question {
  const same = opts.same && rand() < 0.25;
  const d = same ? 0 : between(rand, gap[0], gap[1]) * (rand() < 0.5 ? -1 : 1);
  const a = between(rand, 72 + Math.max(0, -d), 168 - Math.max(0, d));
  const b = a + d;
  const g1 = pick(rand, grooves), g2 = opts.mixGrooves ? pick(rand, grooves.filter((g) => g !== g1).length ? grooves.filter((g) => g !== g1) : grooves) : g1;
  const choices = opts.same ? ['Slower', 'Same', 'Faster'] : ['Slower', 'Faster'];
  const answer = d < 0 ? 0 : d === 0 ? 1 : choices.length - 1;
  return {
    task: 'compare', prompt: tr('Is the second one slower or faster than the first?'),
    clips: [{ bpm: a, groove: g1, bars: 2 }, { bpm: b, groove: g2, bars: 2 }],
    choices, answer, reveal: tr('First {{a}} · second {{b}} BPM', { a, b }),
  };
}

function choose(rand: () => number, spacing: [number, number], grooves: Groove[], feel = false): Question {
  const groove = pick(rand, grooves);
  const sp = between(rand, spacing[0], spacing[1]);
  const slot = Math.floor(rand() * 4);
  const lo = between(rand, 66, 170 - 3 * sp) ;
  let options = [0, 1, 2, 3].map((i) => lo + i * sp);
  let bpm = options[slot];
  if (feel) {
    // half-time and busy grooves: offer the half and the double as traps
    bpm = between(rand, 120, 170);
    options = shuffle(rand, [bpm, Math.round(bpm / 2), Math.round(bpm * 0.75), bpm + between(rand, 12, 20)]);
  }
  return {
    task: 'choose',
    prompt: tr(feel ? 'What tempo is this, counted in quarter notes on the hi-hat?' : 'Which tempo is this?'),
    clips: [{ bpm, groove, bars: 2 }],
    choices: options.map((o) => `${o}`), answer: options.indexOf(bpm),
    reveal: `${bpm} BPM · ${GROOVE_NAMES[groove]}`,
  };
}

export const LADDER: Rung[] = [
  {
    id: 'compare-big', tier: 1, name: 'Faster or slower', task: 'compare',
    blurb: 'Two clicks, far apart in tempo. Which one is faster?',
    make: (r) => compare(r, [20, 35], ['click']),
  },
  {
    id: 'anchors', tier: 1, name: 'Anchor tempos', task: 'anchor',
    blurb: 'Learn four reference tempos by heart: 60, 90, 120 and 160. Hear one, name it.',
    make: (r) => {
      const bpm = pick(r, ANCHORS);
      return { task: 'anchor', prompt: tr('Which anchor tempo is this?'), clips: [{ bpm, groove: pick(r, ['click', 'rock'] as Groove[]), bars: 2 }], choices: ANCHORS.map(String), answer: ANCHORS.indexOf(bpm), reveal: `${bpm} BPM` };
    },
  },
  {
    id: 'compare-med', tier: 1, name: 'Closer calls', task: 'compare',
    blurb: 'Two rock grooves, 10 to 15 BPM apart.',
    make: (r) => compare(r, [10, 15], ['rock']),
  },
  {
    id: 'choose4', tier: 2, name: 'Pick the tempo', task: 'choose',
    blurb: 'Hear a groove, pick its tempo from four options.',
    make: (r) => choose(r, [12, 16], ['rock', 'funk', 'shuffle']),
  },
  {
    id: 'genres', tier: 2, name: 'Groove disguise', task: 'compare',
    blurb: 'Different grooves fool your ear. Slower, same or faster? Gaps of 5 to 10 BPM.',
    make: (r) => compare(r, [5, 10], ['rock', 'funk', 'shuffle'], { same: true, mixGrooves: true }),
  },
  {
    id: 'bracket', tier: 2, name: 'Bracket it', task: 'range',
    blurb: 'Short clips. Which 10-BPM range is it in?',
    make: (r) => {
      const base = between(r, 7, 13) * 10; // lowest bracket start 70..130
      const slot = Math.floor(r() * 4);
      const bpm = base + slot * 10 + between(r, 1, 8);
      const groove = pick(r, ['rock', 'funk', 'shuffle'] as Groove[]);
      return {
        task: 'range', prompt: tr('Which range is this tempo in?'), clips: [{ bpm, groove, bars: 2 }],
        choices: [0, 1, 2, 3].map((i) => `${base + i * 10}–${base + i * 10 + 9}`), answer: slot, reveal: `${bpm} BPM`,
      };
    },
  },
  {
    id: 'hold', tier: 2, name: 'Hold it', task: 'hold',
    blurb: 'A count-off and one bar of click, then silence. Keep playing quarter notes at that tempo.',
    make: (r) => {
      const bpm = between(r, 70, 150);
      return { task: 'hold', prompt: tr('Listen, then keep playing {{n}} quarter notes when the click stops.', { n: PLAY_HITS }), clips: [{ bpm, groove: 'click', bars: 2 }], target: bpm, tol: 5, reveal: `${bpm} BPM` };
    },
  },
  {
    id: 'drift', tier: 3, name: 'Spot the drift', task: 'drift',
    blurb: 'The groove starts steady, then slowly speeds up or slows down. Press as soon as you notice.',
    make: (r) => {
      const bpm = between(r, 80, 140);
      const up = r() < 0.5;
      const to = Math.round(bpm * (up ? 1.12 : 0.88));
      return {
        task: 'drift', prompt: tr('Press “Drifting!” the moment you hear the tempo move.'),
        clips: [{ bpm, groove: pick(r, ['click', 'rock', 'funk'] as Groove[]), bars: 12, driftFrom: between(r, 2, 4), driftTo: to }],
        choices: ['Slower', 'Faster'], answer: up ? 1 : 0, target: bpm, tol: 5, reveal: `${bpm} → ${to} BPM`,
      };
    },
  },
  {
    id: 'memory', tier: 3, name: 'Tempo memory', task: 'memory',
    blurb: 'Hear a groove, wait ten seconds in silence, then play the tempo back from memory.',
    make: (r) => {
      const bpm = between(r, 70, 160);
      const groove = pick(r, ['rock', 'funk', 'shuffle'] as Groove[]);
      return { task: 'memory', prompt: tr('Remember this tempo. After the countdown, play {{n}} quarter notes.', { n: PLAY_HITS }), clips: [{ bpm, groove, bars: 2 }], target: bpm, tol: 5, reveal: `${bpm} BPM` };
    },
  },
  {
    id: 'name', tier: 3, name: 'Name it', task: 'name',
    blurb: 'Guess the exact tempo, within 5 BPM. Tap along if it helps, the tap result shows after you answer.',
    make: (r) => {
      const bpm = between(r, 66, 172);
      const groove = pick(r, ['rock', 'funk', 'shuffle', 'click'] as Groove[]);
      return { task: 'name', prompt: tr('What tempo is this?'), clips: [{ bpm, groove, bars: 4 }], target: bpm, tol: 5, reveal: `${bpm} BPM · ${tr(GROOVE_NAMES[groove])}` };
    },
  },
  {
    id: 'hair', tier: 4, name: 'Hair’s breadth', task: 'compare',
    blurb: 'Only 2 to 4 BPM apart, in any groove. Slower, same or faster?',
    make: (r) => compare(r, [2, 4], ['click', 'rock', 'funk', 'shuffle', 'busy'], { same: true }),
  },
  {
    id: 'feel', tier: 4, name: 'Feel vs. tempo', task: 'choose',
    blurb: 'Half-time and busy grooves feel slower or faster than they are. Name the real tempo.',
    make: (r) => choose(r, [0, 0], ['halftime', 'busy'], true),
  },
  {
    id: 'live', tier: 4, name: 'Live band', task: 'name',
    blurb: 'A live-feel groove that wanders a little. Name its average tempo, within 4 BPM.',
    make: (r) => {
      const c: Clip = { bpm: between(r, 80, 160), groove: pick(r, ['rock', 'funk', 'shuffle'] as Groove[]), bars: 4, wander: 0.015, seed: seedOf(r) };
      const avg = Math.round(renderClip(c).avgBpm);
      return { task: 'name', prompt: tr('What is the average tempo?'), clips: [c], target: avg, tol: 4, reveal: tr('Average {{avg}} BPM (started at {{start}})', { avg, start: c.bpm }) };
    },
  },
  {
    id: 'cold', tier: 4, name: 'Cold count-off', task: 'cold',
    blurb: 'No click at all. You get a number, you play it.',
    make: (r) => {
      const bpm = between(r, 66, 180);
      return { task: 'cold', prompt: tr('Play {{n}} quarter notes at {{bpm}} BPM.', { n: PLAY_HITS, bpm }), clips: [], target: bpm, tol: 3, reveal: `${bpm} BPM` };
    },
  },
];

export const rungIndex = (id: string) => LADDER.findIndex((r) => r.id === id);

// ---------------------------------------------------------------- grading

export interface Grade { ok: boolean; text: string; /** signed error in BPM, where it applies */ error?: number }

export function gradeChoice(q: Question, picked: number): Grade {
  const ok = picked === q.answer;
  return { ok, text: ok ? tr('Right') : tr('It was {{x}}', { x: tr(q.choices?.[q.answer ?? 0] ?? '') }) };
}

export function gradeName(q: Question, guess: number): Grade {
  const error = guess - (q.target ?? 0);
  const ok = Math.abs(error) <= (q.tol ?? 5);
  return { ok, error, text: error === 0 ? tr('Spot on') : tr(error > 0 ? '{{n}} BPM too fast' : '{{n}} BPM too slow', { n: Math.abs(error) }) };
}

/** Hits played back (seconds). Within `tol` percent of the target passes. */
export function gradePlayback(q: Question, hits: number[]): Grade & { bpm?: number; spreadMs?: number } {
  const r = bpmFromHits(hits);
  if (!r) return { ok: false, text: tr('Not enough hits to measure') };
  const target = q.target ?? 0;
  const error = r.bpm - target;
  const pct = (Math.abs(error) / target) * 100;
  const ok = pct <= (q.tol ?? 5);
  const bpm = Math.round(r.bpm);
  return {
    ok, error, bpm, spreadMs: r.spreadMs,
    text: tr('You played {{bpm}} BPM ({{how}}), spread ±{{ms}} ms', { bpm, ms: Math.round(r.spreadMs), how: pct < 0.5 ? tr('spot on') : tr(error > 0 ? '{{pct}} % fast' : '{{pct}} % slow', { pct: pct.toFixed(1) }) }),
  };
}

/**
 * Drift: `pressedAt` is seconds from the clip start (null = never pressed), `dir` the direction picked.
 * Passes when the direction is right and the tempo had moved no more than `tol` percent when you pressed.
 */
export function gradeDrift(q: Question, r: RenderedClip, pressedAt: number | null, dir: number | null): Grade {
  if (pressedAt === null) return { ok: false, text: tr('You didn’t catch it') };
  const start = q.target ?? r.beats[0].bpm;
  const driftFrom = (q.clips[0].driftFrom ?? 0) * 4;
  if (pressedAt < (r.beats[driftFrom]?.t ?? 0)) return { ok: false, text: tr('Too early: it was still steady') };
  const moved = tempoAt(r, pressedAt) - start;
  const pct = (Math.abs(moved) / start) * 100;
  const rightDir = dir === q.answer;
  const ok = rightDir && pct <= (q.tol ?? 5);
  return {
    ok, error: moved,
    text: (rightDir ? '' : tr('Wrong direction.') + ' ') + tr('Caught it after {{n}} BPM of drift ({{pct}} %)', { n: Math.abs(Math.round(moved)), pct: pct.toFixed(1) }),
  };
}

/** Next unlocked rung after a round: pass = at least PASS of ROUND. */
export function afterRound(unlocked: number, rung: number, score: number): number {
  return score >= PASS ? Math.max(unlocked, Math.min(LADDER.length - 1, rung + 1)) : unlocked;
}
