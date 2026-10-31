import { describe, expect, it } from 'vitest';
import { DEFAULT_PAD_SETTINGS, learnPad, notesFor, parseControl, parseNoteOn, resolveNote, stateFor, type PadSettings } from '../src/edrum';

const gm = DEFAULT_PAD_SETTINGS, roland: PadSettings = { ...gm, preset: 'roland' };

describe('note mapping', () => {
  it('maps General MIDI notes', () => {
    expect(resolveNote(gm, 36, 100)).toMatchObject({ id: 'bd', open: false });
    expect(resolveNote(gm, 46, 100)).toMatchObject({ id: 'hh', open: true });
    expect(resolveNote(gm, 26, 100).id).toBeNull();
  });
  it('adds Roland TD hi-hat edges and floor-tom rim', () => {
    expect(resolveNote(roland, 26, 90)).toMatchObject({ id: 'hh', open: true });
    expect(resolveNote(roland, 22, 90)).toMatchObject({ id: 'hh', open: false });
    expect(resolveNote(roland, 58, 90).id).toBe('ft');
  });
  it('learned pads override presets and replace earlier learned notes', () => {
    let s = learnPad(gm, 99, 't2');
    expect(resolveNote(s, 99, 80).id).toBe('t2');
    s = learnPad(s, 98, 't2');
    expect(resolveNote(s, 99, 80).id).toBeNull();
    expect(notesFor(s, 't2')).toEqual([45, 47, 98]);
  });
  it('hi-hat may learn several notes', () => {
    const s = learnPad(learnPad(gm, 100, 'hh'), 101, 'hh');
    expect(notesFor(s, 'hh')).toEqual([42, 100, 101]);
  });
});

describe('hi-hat pedal position (CC 4)', () => {
  it('decides open or closed when the module sends one note for both (TD-27 edge = 26)', () => {
    expect(resolveNote(roland, 26, 90, 0)).toMatchObject({ id: 'hh', open: true });
    expect(resolveNote(roland, 26, 90, 127)).toMatchObject({ id: 'hh', open: false });
    expect(resolveNote(roland, 46, 90, 127).open).toBe(false); // bow note says open, pedal says closed
    expect(resolveNote(roland, 42, 90, 10).open).toBe(true);
  });
  it('keeps the note map when the pedal position is unknown, and ignores it for other pads', () => {
    expect(resolveNote(roland, 26, 90).open).toBe(true);
    expect(resolveNote(roland, 22, 90, null).open).toBe(false);
    expect(resolveNote(roland, 38, 90, 0).open).toBe(false);
  });
  it('uses the configurable closed threshold', () => {
    expect(resolveNote({ ...roland, hhClosedAt: 120 }, 26, 90, 100).open).toBe(true);
  });
  it('parses control changes', () => {
    expect(parseControl([0xb9, 4, 127])).toEqual({ cc: 4, value: 127, channel: 9 });
    expect(parseControl([0x99, 38, 100])).toBeNull();
  });
});

describe('velocity to note state', () => {
  it('turns soft snares into ghosts, hard hits into accents', () => {
    expect(stateFor(gm, resolveNote(gm, 38, 30))).toBe(3);
    expect(stateFor(gm, resolveNote(gm, 38, 80))).toBe(1);
    expect(stateFor(gm, resolveNote(gm, 51, 120))).toBe(2);
    expect(stateFor(gm, resolveNote(gm, 44, 127))).toBe(1); // hi-hat foot never accents
    expect(stateFor(gm, resolveNote(gm, 46, 60))).toBe(3); // open hi-hat
  });
});

describe('MIDI parsing', () => {
  it('accepts note-on on any channel and ignores note-off and zero velocity', () => {
    expect(parseNoteOn([0x99, 38, 100])).toEqual({ note: 38, vel: 100, channel: 9 });
    expect(parseNoteOn([0x89, 38, 0])).toBeNull();
    expect(parseNoteOn([0x99, 38, 0])).toBeNull();
    expect(parseNoteOn([0xb9, 4, 64])).toBeNull();
  });
});
