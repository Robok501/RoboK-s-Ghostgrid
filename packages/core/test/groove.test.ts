import { describe, expect, it } from 'vitest';
import {
  INSTRUMENT, MAX_BARS, UndoStack, addBar, clearBar, countLabel, cycleState, deleteBar, duplicateBar, exampleIdea, newIdea, setBeats, setGrid, setNote, stepTime,
} from '../src/groove';

describe('note states', () => {
  it('cycles per instrument', () => {
    const cycle = (id: keyof typeof INSTRUMENT) => { const out = []; let v: 0 | 1 | 2 | 3 = 0; for (let i = 0; i < 4; i++) { v = cycleState(INSTRUMENT[id], v); out.push(v); } return out; };
    expect(cycle('sn')).toEqual([1, 2, 3, 0]); // hit, accent, ghost, off
    expect(cycle('bd')).toEqual([1, 2, 0, 1]); // no alternative
    expect(cycle('hf')).toEqual([1, 0, 1, 0]); // hi-hat foot: no accent
  });
});

describe('edits are immutable', () => {
  it('setNote returns a new idea', () => {
    const a = newIdea();
    const b = setNote(a, 0, 'sn', 4, 1);
    expect(a.bars[0].n.sn[4]).toBe(0);
    expect(b.bars[0].n.sn[4]).toBe(1);
  });
});

describe('beats and grid', () => {
  it('pads and cuts bars when beats change', () => {
    const a = setNote(newIdea(), 0, 'bd', 15, 1);
    expect(setBeats(a, 3).bars[0].n.bd.length).toBe(12);
    expect(setBeats(a, 5).bars[0].n.bd.length).toBe(20);
  });
  it('keeps notes that fit the new grid and counts the rest', () => {
    const { idea, lost } = setGrid(exampleIdea(), 2);
    expect(idea.grid).toBe(2);
    expect(idea.bars[0].n.hh.slice(0, 4)).toEqual([2, 1, 1, 1]); // 8th hi-hats survive
    expect(lost).toBeGreaterThan(0); // ghost notes and 16th fills do not
  });
  it('maps quarter notes into triplets exactly', () => {
    const a = setNote(newIdea(), 0, 'bd', 4, 1);
    const { idea, lost } = setGrid(a, 3);
    expect(lost).toBe(0);
    expect(idea.bars[0].n.bd[3]).toBe(1);
  });
});

describe('bars', () => {
  it('adds, duplicates, clears and deletes', () => {
    let a = exampleIdea();
    a = duplicateBar(a, 0);
    expect(a.bars.length).toBe(3);
    expect(a.bars[1]).toEqual(a.bars[0]);
    a = clearBar(a, 1);
    expect(Object.values(a.bars[1].n).flat().every((v) => v === 0)).toBe(true);
    a = deleteBar(a, 1);
    expect(a.bars.length).toBe(2);
    for (let i = 0; i < 200; i++) a = addBar(a);
    expect(a.bars.length).toBe(MAX_BARS);
  });
});

describe('counting and time', () => {
  it('labels counts per grid', () => {
    expect([0, 1, 2, 3, 4].map((s) => countLabel(s, 4)).join(' ')).toBe('1 e & a 2');
    expect([0, 1, 2, 3].map((s) => countLabel(s, 3)).join(' ')).toBe('1 & a 2');
  });
  it('applies swing to off-beat steps only', () => {
    const a = { ...newIdea(), bpm: 120, swing: 50 };
    expect(stepTime(a, 0, 1)).toBeCloseTo(0.125 + 0.0625);
    expect(stepTime(a, 1, 0)).toBeCloseTo(2);
  });
});

describe('undo', () => {
  it('restores snapshots', () => {
    const u = new UndoStack(2), a = newIdea();
    u.push(a); u.push(setNote(a, 0, 'sn', 0, 1)); u.push(setNote(a, 0, 'sn', 1, 1));
    expect(u.size).toBe(2);
    expect(u.pop()!.bars[0].n.sn[1]).toBe(1);
  });
});
