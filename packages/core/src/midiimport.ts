/**
 * MIDI to score: read a MIDI file (for example a groove played on an e-drum and saved by the module or a DAW),
 * map the notes to instruments, and write them as an idea. The exact positions are kept as raw notes, so the
 * grid (8ths, 16ths, triplets; per bar) can be changed afterwards and the score redraws without loss.
 */
import { MAX_BARS, newId, withRaw, type Grid, type Idea, type RawNote } from './groove';
import { HH_PEDAL_CC, resolveNote, stateFor, type PadSettings } from './edrum';
import { readMidi } from './export/midi';

/** How far notes sit from a grid, in beats (lower = fits better). */
export function gridError(beats: number[], grid: Grid): number {
  if (!beats.length) return 0;
  return beats.reduce((e, b) => e + Math.abs(b * grid - Math.round(b * grid)) / grid, 0) / beats.length;
}

/** True when nearly all notes (95 %) sit within `tol` beats of the grid. Played MIDI is never exact. */
function fits(beats: number[], grid: Grid, tol = 0.07): boolean {
  const ok = beats.filter((b) => Math.abs(b * grid - Math.round(b * grid)) / grid <= tol).length;
  return ok >= beats.length * 0.95;
}

/**
 * Suggested grid: the coarsest that fits; otherwise whichever of 16ths and triplets fits best.
 * 32nds only when they fit tightly and triplets don't (a triplet sits close to a 32nd, so it would pass too).
 */
export function suggestGrid(beats: number[]): Grid {
  if (fits(beats, 2)) return 2;
  if (fits(beats, 4)) return 4;
  if (fits(beats, 3)) return 3;
  if (fits(beats, 8, 0.03)) return 8;
  return gridError(beats, 3) < gridError(beats, 4) ? 3 : 4;
}

const PREF: Record<Grid, number> = { 2: 0, 4: 1, 3: 2, 8: 3 };

export interface MidiImport {
  idea: Idea;
  notes: number;
  /** notes whose MIDI number isn't mapped to an instrument */
  unmapped: number;
  /** bars cut off past the limit */
  truncated: boolean;
}

export function importMidi(data: Uint8Array, pads: PadSettings, name = 'Imported'): MidiImport {
  const f = readMidi(data);
  const ons = f.events.filter((e) => e.on);
  // prefer the drum channel when the file has one
  const drums = ons.some((e) => e.channel === 9) ? ons.filter((e) => e.channel === 9) : ons;
  const quarters = (tick: number) => tick / f.ppq;
  let beats = Math.round((f.num * 4) / f.den);
  if (beats < 1 || beats > 16 || Math.abs((f.num * 4) / f.den - beats) > 1e-6) beats = 4;

  const pedal = f.controls.filter((c) => c.cc === HH_PEDAL_CC);
  let pi = 0, pos: number | null = null;
  const raw: RawNote[] = [];
  let unmapped = 0;
  for (const e of drums) {
    while (pi < pedal.length && pedal[pi].tick <= e.tick) pos = pedal[pi++].value;
    const h = resolveNote(pads, e.note, e.vel, pos);
    if (!h.id) { unmapped++; continue; }
    raw.push({ beat: quarters(e.tick), id: h.id, v: stateFor(pads, h) });
  }
  // skip empty bars at the start
  const first = raw.length ? Math.min(...raw.map((r) => r.beat)) : 0;
  const shift = Math.floor((first + 0.02) / beats) * beats;
  for (const r of raw) r.beat = Math.max(0, r.beat - shift);

  // a grid per bar; the most common one becomes the idea's grid, the others stay on their bars
  const lastBeat = raw.reduce((m, r) => Math.max(m, r.beat), 0);
  const truncated = lastBeat >= MAX_BARS * beats;
  const nb = Math.min(MAX_BARS, Math.floor(lastBeat / beats + 1e-6) + 1);
  const perBar = Array.from({ length: nb }, (_, b) => {
    const inBar = raw.filter((r) => r.beat >= b * beats - 0.1 && r.beat < (b + 1) * beats - 0.1).map((r) => r.beat - b * beats);
    return inBar.length >= 2 ? suggestGrid(inBar) : null;
  });
  const votes = new Map<Grid, number>();
  for (const g of perBar) if (g) votes.set(g, (votes.get(g) ?? 0) + 1);
  const grid: Grid = [...votes.entries()].sort((x, y) => y[1] - x[1] || PREF[x[0]] - PREF[y[0]])[0]?.[0] ?? suggestGrid(raw.map((r) => r.beat));
  const base: Idea = { id: newId(), name, bpm: Math.round(6e7 / f.tempoUs), beats, grid, swing: 0, bars: [] };
  base.bars = perBar.map((g) => ({ n: {} as Idea['bars'][number]['n'], ...(g && g !== grid ? { grid: g } : {}) }));
  const idea = withRaw(base, raw);
  return { idea: { ...idea, rows: undefined }, notes: raw.length, unmapped, truncated };
}
