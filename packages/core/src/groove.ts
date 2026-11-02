/** Grooves: instruments, bars on a step grid, and edits that keep the music consistent. */

export type InstrumentId = 'cr' | 'hh' | 'rd' | 't1' | 't2' | 'sn' | 'ft' | 'bd' | 'hf';
/** 0 = off, 1 = hit, 2 = accent, 3 = alternative (open hi-hat or ghost snare) */
export type NoteState = 0 | 1 | 2 | 3;
/** 2 = eighths, 4 = sixteenths, 3 = eighth-note triplets */
/** steps per beat: 8ths, triplets, 16ths, 32nds */
export type Grid = 2 | 3 | 4 | 8;

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

/** A bar of notes. `grid` overrides the idea's grid for this bar (e.g. a triplet fill in a straight groove). */
export interface Bar { n: Record<InstrumentId, NoteState[]>; grid?: Grid }
/** A note at an exact position, kept from imports and recordings so the grid can be changed without loss. */
export interface RawNote { beat: number; id: InstrumentId; v: NoteState }
export interface Idea {
  id: string;
  name: string;
  bpm: number;
  beats: number;
  grid: Grid;
  /** 0–50: delay of every off-beat note, as % of a grid step (not used with triplets) */
  swing: number;
  bars: Bar[];
  /** Instrument rows shown in the editor (in INSTRUMENTS order). Missing = all rows that have notes, plus kick/snare/hi-hat. */
  rows?: InstrumentId[];
  /** Unquantised notes from a MIDI import or recording, in beats from the start. */
  raw?: RawNote[];
}

export const MAX_BARS = 64;
export const steps = (idea: Pick<Idea, 'beats' | 'grid'>) => idea.beats * idea.grid;
/** Grid and number of steps of one bar. */
export const barGrid = (idea: Pick<Idea, 'grid' | 'bars'>, b: number): Grid => idea.bars[b]?.grid ?? idea.grid;
export const barSteps = (idea: Pick<Idea, 'beats' | 'grid' | 'bars'>, b: number) => idea.beats * barGrid(idea, b);
export const GRID_NAMES: Record<Grid, string> = { 2: '8ths', 4: '16ths', 8: '32nds', 3: 'Triplets' };
/** The big grid button cycles 8ths → 16ths → triplets. */
export const nextGrid = (g: Grid): Grid => (g === 2 ? 4 : g === 4 ? 8 : g === 8 ? 3 : 2);

export const DEFAULT_ROWS: InstrumentId[] = ['hh', 'sn', 'bd'];
const ORDER = INSTRUMENTS.map((i) => i.id);
const byOrder = (ids: InstrumentId[]) => ORDER.filter((id) => ids.includes(id));
const used = (idea: Idea) => ORDER.filter((id) => idea.bars.some((b) => b.n[id].some((v) => v)));
/** Rows shown in the editor. Rows that become empty while editing stay until tidied. */
export function visibleRows(idea: Idea): InstrumentId[] {
  return byOrder(idea.rows ?? [...new Set([...DEFAULT_ROWS, ...used(idea)])]);
}
export function addRow(idea: Idea, id: InstrumentId): Idea {
  return { ...idea, rows: byOrder([...visibleRows(idea), id]) };
}
/** Clean up: keep only rows with notes (or kick, snare and hi-hat when the sketch is empty). */
export function tidyRows(idea: Idea): Idea {
  const u = used(idea);
  return { ...idea, rows: u.length ? u : DEFAULT_ROWS.slice() };
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export const newId = () => Math.random().toString(36).slice(2, 9);

export function emptyBar(n: number): Bar {
  const b = { n: {} } as Bar;
  for (const i of INSTRUMENTS) b.n[i.id] = new Array(n).fill(0);
  return b;
}

export function newIdea(name = 'Idea', bpm = 96): Idea {
  return { id: newId(), name, bpm, beats: 4, grid: 4, swing: 0, bars: [emptyBar(16)], rows: DEFAULT_ROWS.slice() };
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
  delete out.raw;
  return out;
}

/** Change beats per bar, cutting or padding every bar. */
export function setBeats(idea: Idea, beats: number): Idea {
  const out = clone(idea);
  for (const bar of out.bars) for (const i of INSTRUMENTS) {
    const n = beats * (bar.grid ?? out.grid);
    const a = bar.n[i.id];
    a.length = Math.min(a.length, n);
    while (a.length < n) a.push(0);
  }
  out.beats = beats;
  return out;
}

/** Re-place one bar's notes on a new grid. Notes without an exact place are dropped and counted. */
function regridBar(bar: Bar, from: Grid, to: Grid, beats: number): number {
  let lost = 0;
  for (const i of INSTRUMENTS) {
    const na: NoteState[] = new Array(beats * to).fill(0);
    bar.n[i.id].forEach((v, s) => {
      if (!v) return;
      const pos = s / from, ns = Math.round(pos * to);
      if (Math.abs(ns / to - pos) < 1e-6) na[ns] = v; else lost++;
    });
    bar.n[i.id] = na;
  }
  return lost;
}

/** Bar b filled from raw notes (imports and recordings), quantised to its grid. */
function fillFromRaw(idea: Idea, b: number) {
  const g = barGrid(idea, b), n = idea.beats * g, bar = emptyBar(n);
  bar.grid = idea.bars[b].grid;
  for (const r of idea.raw ?? []) {
    const s = Math.round((r.beat - b * idea.beats) * g);
    if (s < 0 || s >= n) continue;
    const cur = bar.n[r.id][s];
    bar.n[r.id][s] = (cur === 2 || r.v === 2 ? 2 : Math.max(cur, r.v)) as NoteState;
  }
  idea.bars[b] = bar;
}

/** Every note of the idea as a raw note (beats from the start). */
export function ideaToRaw(idea: Idea): RawNote[] {
  if (idea.raw) return idea.raw.slice();
  const out: RawNote[] = [];
  idea.bars.forEach((bar, b) => {
    const g = barGrid(idea, b);
    for (const i of INSTRUMENTS) bar.n[i.id].forEach((v, s) => { if (v) out.push({ beat: b * idea.beats + s / g, id: i.id, v }); });
  });
  return out;
}

/** Set the raw notes and rebuild every bar from them (adding bars as needed, up to MAX_BARS). */
export function withRaw(idea: Idea, raw: RawNote[], minBars = 1): Idea {
  const out = clone(idea);
  const last = raw.reduce((m, r) => Math.max(m, r.beat), 0);
  const nb = Math.min(MAX_BARS, Math.max(minBars, Math.floor(last / out.beats + 1e-6) + 1));
  out.raw = raw.filter((r) => r.beat < nb * out.beats - 0.5 / out.grid);
  out.bars = Array.from({ length: nb }, (_, b) => {
    const bar = emptyBar(barSteps(out, b));
    const g = idea.bars[b]?.grid;
    if (g) bar.grid = g;
    return bar;
  });
  out.bars.forEach((_, b) => fillFromRaw(out, b));
  return out;
}

/** Change the grid of the whole idea. Notes that have no exact place on the new grid are removed and counted. */
export function setGrid(idea: Idea, grid: Grid): { idea: Idea; lost: number } {
  const out = clone(idea);
  let lost = 0;
  out.bars.forEach((bar, b) => {
    const from = bar.grid ?? out.grid;
    delete bar.grid;
    if (out.raw?.length) return;
    if (from !== grid) lost += regridBar(bar, from, grid, out.beats);
  });
  out.grid = grid;
  if (out.raw?.length) out.bars.forEach((_, b) => fillFromRaw(out, b));
  return { idea: out, lost };
}

/** Change the grid of one bar (a triplet fill in a straight groove). Re-quantises from raw notes when there are any. */
export function setBarGrid(idea: Idea, b: number, grid: Grid): { idea: Idea; lost: number } {
  const out = clone(idea);
  const bar = out.bars[b], from = bar.grid ?? out.grid;
  if (grid === out.grid) delete bar.grid; else bar.grid = grid;
  if (out.raw?.length) { fillFromRaw(out, b); return { idea: out, lost: 0 }; }
  return { idea: out, lost: from === grid ? 0 : regridBar(bar, from, grid, out.beats) };
}

export function addBar(idea: Idea): Idea {
  if (idea.bars.length >= MAX_BARS) return idea;
  const out = clone(idea); out.bars.push(emptyBar(steps(out))); delete out.raw; return out;
}
export function duplicateBar(idea: Idea, bar: number): Idea {
  if (idea.bars.length >= MAX_BARS) return idea;
  const out = clone(idea); out.bars.splice(bar + 1, 0, clone(out.bars[bar])); delete out.raw; return out;
}
export function clearBar(idea: Idea, bar: number): Idea {
  const out = clone(idea), g = idea.bars[bar].grid;
  out.bars[bar] = emptyBar(barSteps(idea, bar));
  if (g) out.bars[bar].grid = g;
  delete out.raw;
  return out;
}
export function deleteBar(idea: Idea, bar: number): Idea {
  if (idea.bars.length < 2) return idea;
  const out = clone(idea); out.bars.splice(bar, 1); delete out.raw; return out;
}

/** Count labels per grid step: 1 e & a, 1 &, 1 & a for triplets; 32nds count like 16ths with a dot between. */
export function countLabel(step: number, grid: Grid): string {
  const SUB: Record<Grid, string[]> = { 4: ['', 'e', '&', 'a'], 2: ['', '&'], 3: ['', '&', 'a'], 8: ['', '·', 'e', '·', '&', '·', 'a', '·'] };
  return step % grid ? SUB[grid][step % grid] : String(step / grid + 1);
}

/** Time in seconds of a grid step from the start of the idea, with swing applied. */
export function stepTime(idea: Idea, bar: number, step: number): number {
  const beat = 60 / idea.bpm, g = barGrid(idea, bar), sd = beat / g;
  // swing moves the off-beat 8ths or 16ths; not used with triplets or 32nds
  const swing = g !== 3 && g !== 8 && step % 2 === 1 ? (sd * idea.swing) / 100 : 0;
  return bar * idea.beats * beat + step * sd + swing;
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

/** Sound and loudness for playing a note on the built-in kit (index into DRUM_SOUNDS). */
export function soundFor(id: InstrumentId, v: NoteState): { sound: string; gain: number } {
  const gain = v === 2 ? 1.25 : 1;
  switch (id) {
    case 'bd': return { sound: 'kick', gain };
    case 'sn': return v === 3 ? { sound: 'ghost', gain: 1 } : { sound: 'snare', gain };
    case 'hh': return v === 3 ? { sound: 'open', gain: 1 } : v === 2 ? { sound: 'hatAcc', gain: 1 } : { sound: 'hat', gain: 1 };
    case 'hf': return { sound: 'hhFoot', gain: 1 };
    case 't1': return { sound: 'tom1', gain };
    case 't2': return { sound: 'tom2', gain };
    case 'ft': return { sound: 'ftom', gain };
    case 'rd': return { sound: 'ride', gain };
    case 'cr': return { sound: 'crash', gain };
  }
}
