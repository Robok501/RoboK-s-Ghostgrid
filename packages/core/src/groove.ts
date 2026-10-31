/** Grooves: instruments, bars on a step grid, and edits that keep the music consistent. */

export type InstrumentId = 'cr' | 'hh' | 'rd' | 't1' | 't2' | 'sn' | 'ft' | 'bd' | 'hf';
/** 0 = off, 1 = hit, 2 = accent, 3 = alternative (open hi-hat or ghost snare) */
export type NoteState = 0 | 1 | 2 | 3;
/** 2 = eighths, 4 = sixteenths, 3 = eighth-note triplets */
export type Grid = 2 | 3 | 4;

export interface Instrument {
  id: InstrumentId;
  name: string;
  short: string;
  /** staff position: 0 = bottom line (E4), 8 = top line (F5) */
  step: number;
  /** cymbal: drawn with an x notehead */
  x: boolean;
  /** hands voice (stems up) or feet voice (stems down) */
  up: boolean;
  alt?: 'open' | 'ghost';
  noAccent?: boolean;
  /** hidden in the compact grid unless "all instruments" is on */
  more?: boolean;
  midi: number;
  midiAlt?: number;
}

export const INSTRUMENTS: Instrument[] = [
  { id: 'cr', name: 'Crash', short: 'CR', step: 10, x: true, up: true, midi: 49, more: true },
  { id: 'hh', name: 'Hi-hat', short: 'HH', step: 9, x: true, up: true, alt: 'open', midi: 42, midiAlt: 46 },
  { id: 'rd', name: 'Ride', short: 'RD', step: 8, x: true, up: true, midi: 51 },
  { id: 't1', name: 'Tom 1', short: 'T1', step: 7, x: false, up: true, midi: 50 },
  { id: 't2', name: 'Tom 2', short: 'T2', step: 6, x: false, up: true, midi: 47, more: true },
  { id: 'sn', name: 'Snare', short: 'SN', step: 5, x: false, up: true, alt: 'ghost', midi: 38 },
  { id: 'ft', name: 'Floor tom', short: 'FT', step: 3, x: false, up: true, midi: 43 },
  { id: 'bd', name: 'Kick', short: 'BD', step: 1, x: false, up: false, midi: 36 },
  { id: 'hf', name: 'Hi-hat foot', short: 'HF', step: -1, x: true, up: false, midi: 44, more: true, noAccent: true },
];
export const INSTRUMENT = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i])) as Record<InstrumentId, Instrument>;

export interface Bar { n: Record<InstrumentId, NoteState[]> }
export interface Idea {
  id: string;
  name: string;
  bpm: number;
  beats: number;
  grid: Grid;
  /** 0–50: delay of every off-beat note, as % of a grid step (not used with triplets) */
  swing: number;
  bars: Bar[];
}

export const MAX_BARS = 8;
export const steps = (idea: Pick<Idea, 'beats' | 'grid'>) => idea.beats * idea.grid;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export const newId = () => Math.random().toString(36).slice(2, 9);

export function emptyBar(n: number): Bar {
  const b = { n: {} } as Bar;
  for (const i of INSTRUMENTS) b.n[i.id] = new Array(n).fill(0);
  return b;
}

export function newIdea(name = 'Idea', bpm = 96): Idea {
  return { id: newId(), name, bpm, beats: 4, grid: 4, swing: 0, bars: [emptyBar(16)] };
}

/** The example shown on first start: a rock groove and a fill. */
export function exampleIdea(): Idea {
  const I: Idea = { id: newId(), name: 'Example: rock groove + fill', bpm: 96, beats: 4, grid: 4, swing: 0, bars: [emptyBar(16), emptyBar(16)] };
  const a = I.bars[0].n;
  for (let s = 0; s < 16; s += 2) a.hh[s] = 1;
  a.hh[0] = 2; a.sn[4] = 1; a.sn[12] = 1; a.sn[7] = 3; a.sn[15] = 3; a.bd[0] = 1; a.bd[8] = 1; a.bd[10] = 1;
  const b = I.bars[1].n;
  for (let s = 0; s < 8; s += 2) b.hh[s] = 1;
  b.bd[0] = 1; b.bd[6] = 1; b.sn[4] = 1; [8, 9, 10, 11].forEach((s) => (b.sn[s] = 1));
  b.sn[8] = 2; b.t1[12] = 1; b.t1[13] = 1; b.ft[14] = 1; b.ft[15] = 1; b.bd[12] = 1; b.bd[14] = 1;
  return I;
}

export const maxState = (i: Instrument): NoteState => (i.noAccent ? 1 : i.alt ? 3 : 2);
/** Tap cycle: off → hit → accent → open/ghost → off (skipping states an instrument doesn't have). */
export function cycleState(i: Instrument, v: NoteState): NoteState {
  return ((v + 1) % (maxState(i) + 1)) as NoteState;
}
export function stateName(i: Instrument, v: NoteState): string {
  return ['off', 'hit', 'accent', i.alt === 'open' ? 'open' : 'ghost'][v];
}

/** Set one note; returns a new idea. */
export function setNote(idea: Idea, bar: number, inst: InstrumentId, step: number, v: NoteState): Idea {
  const out = clone(idea);
  out.bars[bar].n[inst][step] = v;
  return out;
}

/** Change beats per bar, cutting or padding every bar. */
export function setBeats(idea: Idea, beats: number): Idea {
  const out = clone(idea);
  const n = beats * out.grid;
  for (const bar of out.bars) for (const i of INSTRUMENTS) {
    const a = bar.n[i.id];
    a.length = Math.min(a.length, n);
    while (a.length < n) a.push(0);
  }
  out.beats = beats;
  return out;
}

/** Change the grid. Notes that have no exact place on the new grid are removed and counted. */
export function setGrid(idea: Idea, grid: Grid): { idea: Idea; lost: number } {
  const out = clone(idea);
  const og = out.grid;
  if (grid === og) return { idea: out, lost: 0 };
  let lost = 0;
  for (const bar of out.bars) for (const i of INSTRUMENTS) {
    const na: NoteState[] = new Array(out.beats * grid).fill(0);
    bar.n[i.id].forEach((v, s) => {
      if (!v) return;
      const pos = s / og, ns = Math.round(pos * grid);
      if (Math.abs(ns / grid - pos) < 1e-6) na[ns] = v; else lost++;
    });
    bar.n[i.id] = na;
  }
  out.grid = grid;
  return { idea: out, lost };
}

export function addBar(idea: Idea): Idea {
  if (idea.bars.length >= MAX_BARS) return idea;
  const out = clone(idea); out.bars.push(emptyBar(steps(out))); return out;
}
export function duplicateBar(idea: Idea, bar: number): Idea {
  if (idea.bars.length >= MAX_BARS) return idea;
  const out = clone(idea); out.bars.splice(bar + 1, 0, clone(out.bars[bar])); return out;
}
export function clearBar(idea: Idea, bar: number): Idea {
  const out = clone(idea); out.bars[bar] = emptyBar(steps(out)); return out;
}
export function deleteBar(idea: Idea, bar: number): Idea {
  if (idea.bars.length < 2) return idea;
  const out = clone(idea); out.bars.splice(bar, 1); return out;
}

/** Count labels per grid step: 1 e & a, 1 &, or 1 & a for triplets. */
export function countLabel(step: number, grid: Grid): string {
  const SUB: Record<Grid, string[]> = { 4: ['', 'e', '&', 'a'], 2: ['', '&'], 3: ['', '&', 'a'] };
  return step % grid ? SUB[grid][step % grid] : String(step / grid + 1);
}

/** Time in seconds of a grid step from the start of the idea, with swing applied. */
export function stepTime(idea: Idea, bar: number, step: number): number {
  const sd = 60 / idea.bpm / idea.grid;
  const swing = idea.grid !== 3 && step % 2 === 1 ? (sd * idea.swing) / 100 : 0;
  return (bar * steps(idea) + step) * sd + swing;
}

/** Simple undo stack of idea snapshots. */
export class UndoStack {
  private s: string[] = [];
  constructor(private max = 40) {}
  push(idea: Idea) { this.s.push(JSON.stringify(idea)); if (this.s.length > this.max) this.s.shift(); }
  pop(): Idea | null { const v = this.s.pop(); return v ? JSON.parse(v) : null; }
  get size() { return this.s.length; }
  clear() { this.s = []; }
}
