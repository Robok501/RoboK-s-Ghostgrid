/**
 * E-drum pad mapping: MIDI note → instrument, for any module.
 * General MIDI covers most kits; the Roland TD extension adds hi-hat edges and floor-tom rim;
 * learned pads (custom) override both. Platform glue (Web MIDI, CoreMIDI, Android MIDI) lives outside the core.
 */
import type { InstrumentId, NoteState } from './groove';

/** Instrument key; 'hh+o' is the open hi-hat. */
export type PadKey = InstrumentId | 'hh+o';
export type Preset = 'gm' | 'roland';

export const PAD_NAMES: Record<PadKey, string> = {
  bd: 'Kick', sn: 'Snare', hh: 'Hi-hat', 'hh+o': 'Hi-hat open', hf: 'Hi-hat foot',
  t1: 'Tom 1', t2: 'Tom 2', ft: 'Floor tom', cr: 'Crash', rd: 'Ride',
};
export const GM_MAP: Record<number, PadKey> = {
  35: 'bd', 36: 'bd', 37: 'sn', 38: 'sn', 39: 'sn', 40: 'sn', 41: 'ft', 43: 'ft', 45: 't2', 47: 't2', 48: 't1', 50: 't1',
  42: 'hh', 44: 'hf', 46: 'hh+o', 49: 'cr', 52: 'cr', 55: 'cr', 57: 'cr', 51: 'rd', 53: 'rd', 59: 'rd',
};
export const ROLAND_MAP: Record<number, PadKey> = { ...GM_MAP, 22: 'hh', 26: 'hh+o', 58: 'ft' };

export interface PadSettings {
  preset: Preset;
  /** learned pads: note → instrument */
  custom: Record<number, PadKey>;
  /** velocity at or above which a hit is an accent */
  acc: number;
  /** snare velocity below which a hit is a ghost note */
  ghost: number;
  /** hi-hat pedal position (MIDI CC 4, 0 = open … 127 = closed) at or above which the hi-hat counts as closed */
  hhClosedAt: number;
}
export const DEFAULT_PAD_SETTINGS: PadSettings = { preset: 'gm', custom: {}, acc: 110, ghost: 40, hhClosedAt: 90 };

/** MIDI controller that carries the hi-hat pedal position on most e-drum modules. */
export const HH_PEDAL_CC = 4;

export function noteTable(s: PadSettings): Record<number, PadKey> {
  return { ...(s.preset === 'roland' ? ROLAND_MAP : GM_MAP), ...s.custom };
}

export interface PadHit { note: number; vel: number; id: InstrumentId | null; open: boolean }

/**
 * Resolve a note-on to an instrument (or null when the note isn't mapped).
 * Many modules (e.g. the Roland TD-27 on the hi-hat edge) send the same note open or closed and report the
 * pedal position separately as CC 4. When that position is known, it decides open versus closed for hi-hat hits.
 */
export function resolveNote(s: PadSettings, note: number, vel: number, hhPedal?: number | null): PadHit {
  const m = noteTable(s)[note];
  const id = m ? (m.split('+')[0] as InstrumentId) : null;
  let open = !!m && m.endsWith('+o');
  if (id === 'hh' && hhPedal !== undefined && hhPedal !== null) open = hhPedal < (s.hhClosedAt ?? 90);
  return { note, vel, id, open };
}

/** Parse a control change; returns controller, value and channel, or null. */
export function parseControl(data: ArrayLike<number>): { cc: number; value: number; channel: number } | null {
  if (!data || data.length < 3 || (data[0] & 0xf0) !== 0xb0) return null;
  return { cc: data[1], value: data[2], channel: data[0] & 0x0f };
}

/** Parse a raw MIDI message; returns a note-on (velocity > 0) or null. */
export function parseNoteOn(data: ArrayLike<number>): { note: number; vel: number; channel: number } | null {
  if (!data || data.length < 3) return null;
  if ((data[0] & 0xf0) !== 0x90 || data[2] === 0) return null;
  return { note: data[1], vel: data[2], channel: data[0] & 0x0f };
}

/** Note state from velocity: open hi-hat, ghost snare, accent or plain hit. */
export function stateFor(s: PadSettings, h: PadHit): NoteState {
  if (h.open) return 3;
  if (h.id === 'sn' && h.vel < s.ghost) return 3;
  if (h.id !== 'hf' && h.vel >= s.acc) return 2;
  return 1;
}

/**
 * Learn a pad: the note now plays `key`. Other learned notes for the same single-note instruments are dropped,
 * except the hi-hat, which often sends several notes (bow, edge, open, closed).
 */
export function learnPad(s: PadSettings, note: number, key: PadKey): PadSettings {
  const custom = { ...s.custom };
  if (key !== 'hh' && key !== 'hh+o') for (const n of Object.keys(custom)) if (custom[+n] === key) delete custom[+n];
  custom[note] = key;
  return { ...s, custom };
}

export function notesFor(s: PadSettings, key: PadKey): number[] {
  return Object.entries(noteTable(s)).filter(([, v]) => v === key).map(([n]) => +n).sort((a, b) => a - b);
}
