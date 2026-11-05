/**
 * Practice library: exercises that play in the Sketch player and later get scored against their expected notes.
 * Every exercise here is written from scratch for Ghostgrid (own notation, standard rudiment names only),
 * so nothing is copied from a published rudiment list; `credit` says where an exercise comes from.
 */
import { emptyBar, newId, type Grid, type Idea, type InstrumentId, type NoteState } from './groove';

export type LibraryCategory = 'rudiments';
export interface LibraryExercise {
  id: string;
  title: string;
  category: LibraryCategory;
  /** short family used for grouping inside the category */
  family: 'rolls' | 'diddles' | 'flams' | 'drags';
  level: 1 | 2 | 3;
  /** comfortable tempo range in bpm (the player can ramp inside it) */
  bpm: [number, number];
  beats: number;
  grid: Grid;
  /**
   * One string per bar, one character per grid step (spaces are ignored):
   * `.` rest, `x` hit, `X` accent, `g` ghost, `f`/`F` flam (grace note one step before, main note on the step; F = accent),
   * `D` drag (two grace notes on the two steps before the main note). A grace note before the first step of the
   * exercise falls at the end of the last bar, so the exercise loops without a gap.
   */
  bars: string[];
  /** sticking per bar for display only; lower case = grace notes (l R = left grace, right main) */
  sticking: string[];
  summary: string;
  credit: string;
}

const OWN = 'Ghostgrid (own notation)';
const ex = (e: Omit<LibraryExercise, 'category' | 'credit'>): LibraryExercise => ({ ...e, category: 'rudiments', credit: OWN });

export const RUDIMENTS: LibraryExercise[] = [
  ex({ id: 'single-stroke-roll-8ths', title: 'Single stroke roll (eighths)', family: 'rolls', level: 1, bpm: [50, 120], beats: 4, grid: 2,
    bars: ['xxxxxxxx'], sticking: ['R L R L R L R L'], summary: 'Alternate hands, one stroke per note. Keep both hands the same height and volume.' }),
  ex({ id: 'single-stroke-roll', title: 'Single stroke roll (sixteenths)', family: 'rolls', level: 1, bpm: [50, 120], beats: 4, grid: 4,
    bars: ['xxxxxxxxxxxxxxxx'], sticking: ['RLRL RLRL RLRL RLRL'], summary: 'Alternate hands, four notes to the beat. Aim for an even sound from the first note to the last.' }),
  ex({ id: 'double-stroke-roll-8ths', title: 'Double stroke roll (eighths)', family: 'rolls', level: 1, bpm: [50, 110], beats: 4, grid: 2,
    bars: ['xxxxxxxx'], sticking: ['RR LL RR LL'], summary: 'Two strokes per hand. The second stroke of each pair must be as loud as the first.' }),
  ex({ id: 'double-stroke-roll', title: 'Double stroke roll (sixteenths)', family: 'rolls', level: 2, bpm: [50, 110], beats: 4, grid: 4,
    bars: ['xxxxxxxxxxxxxxxx'], sticking: ['RRLL RRLL RRLL RRLL'], summary: 'Open double stroke roll at sixteenth notes: let the stick bounce for the second stroke.' }),
  ex({ id: 'single-paradiddle', title: 'Single paradiddle', family: 'diddles', level: 1, bpm: [50, 120], beats: 4, grid: 4,
    bars: ['XxxxXxxxXxxxXxxx'], sticking: ['RLRR LRLL RLRR LRLL'], summary: 'Accent the first note of every group of four. The accent switches hands every beat.' }),
  ex({ id: 'double-paradiddle', title: 'Double paradiddle', family: 'diddles', level: 2, bpm: [50, 100], beats: 4, grid: 3,
    bars: ['XxxxxxXxxxxx'], sticking: ['RLRLRR LRLRLL'], summary: 'Eighth-note triplets in groups of six. Accent the first note of each group.' }),
  ex({ id: 'triple-paradiddle', title: 'Triple paradiddle', family: 'diddles', level: 3, bpm: [50, 100], beats: 4, grid: 4,
    bars: ['XxxxxxxxXxxxxxxx'], sticking: ['RLRLRLRR LRLRLRLL'], summary: 'Groups of eight sixteenths, accent on the first note of each group.' }),
  ex({ id: 'paradiddle-diddle', title: 'Paradiddle-diddle', family: 'diddles', level: 2, bpm: [50, 100], beats: 4, grid: 3,
    bars: ['XxxxxxXxxxxx'], sticking: ['RLRRLL RLRRLL'], summary: 'Triplets in groups of six, always starting on the same hand. Accent the first note.' }),
  ex({ id: 'flam', title: 'Flam', family: 'flams', level: 2, bpm: [50, 90], beats: 4, grid: 8,
    bars: ['f....... f....... f....... f.......'], sticking: ['lR rL lR rL'], summary: 'A quiet grace note just before the main note, from a low stick. Alternate hands each flam.' }),
  ex({ id: 'flam-tap', title: 'Flam tap', family: 'flams', level: 3, bpm: [50, 90], beats: 4, grid: 8,
    bars: ['f.x.f.x. f.x.f.x. f.x.f.x. f.x.f.x.'], sticking: ['lR R rL L  lR R rL L  lR R rL L  lR R rL L'], summary: 'A flam followed by a tap with the same hand as the main note, in sixteenths.' }),
  ex({ id: 'drag', title: 'Drag (ruff)', family: 'drags', level: 3, bpm: [50, 90], beats: 4, grid: 8,
    bars: ['D....... D....... D....... D.......'], sticking: ['llR rrL llR rrL'], summary: 'Two quick grace notes (a double stroke) before the main note with the other hand.' }),
];

export const LIBRARY: LibraryExercise[] = [...RUDIMENTS];

/** The notes of an exercise as an Idea for the Sketch player, at the given tempo (default: the middle of its range). */
export function exerciseToIdea(e: LibraryExercise, bpm?: number): Idea {
  const n = e.beats * e.grid;
  const nb = e.bars.length;
  const idea: Idea = {
    id: newId(), name: e.title, bpm: bpm ?? Math.round((e.bpm[0] + e.bpm[1]) / 2 / 5) * 5,
    beats: e.beats, grid: e.grid, swing: 0, bars: e.bars.map(() => emptyBar(n)), rows: ['sn' as InstrumentId],
  };
  const put = (bar: number, step: number, v: NoteState) => {
    let b = bar, s = step;
    while (s < 0) { b = (b - 1 + nb) % nb; s += n; }
    const cur = idea.bars[b].n.sn[s];
    idea.bars[b].n.sn[s] = cur && cur > v ? cur : v;
  };
  e.bars.forEach((pat, b) => {
    const p = pat.replace(/\s+/g, '');
    if (p.length !== n) throw new Error(`${e.id}: bar ${b + 1} has ${p.length} steps, expected ${n}`);
    [...p].forEach((c, s) => {
      if (c === 'x') put(b, s, 1);
      else if (c === 'X') put(b, s, 2);
      else if (c === 'g') put(b, s, 3);
      else if (c === 'f' || c === 'F') { put(b, s - 1, 3); put(b, s, c === 'F' ? 2 : 1); }
      else if (c === 'D') { put(b, s - 2, 3); put(b, s - 1, 3); put(b, s, 1); }
      else if (c !== '.') throw new Error(`${e.id}: unknown symbol "${c}"`);
    });
  });
  return idea;
}

/** The sticking of an exercise on one line, for display. */
export const stickingLine = (e: LibraryExercise) => e.sticking.join('  |  ');
