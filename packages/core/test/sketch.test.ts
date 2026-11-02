import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAD_SETTINGS, addRow, buildMidi, engrave, exampleIdea, ideaToRaw, importMidi, newIdea, nextGrid, notationStyle, setBarGrid,
  setGrid, setNote, stepTime, suggestGrid, textTab, tidyRows, visibleRows, vlq, withRaw, readMidi, type PadSettings,
} from '../src';

const roland: PadSettings = { ...DEFAULT_PAD_SETTINGS, preset: 'roland' };

/** Type-1 MIDI file: track 1 = tempo + meter, track 2 = notes [quarters, note, velocity] on channel 10. */
function midi(notes: [number, number, number][], bpm = 100, num = 4, extra: number[] = []): Uint8Array {
  const ppq = 480, us = Math.round(6e7 / bpm);
  const t1 = [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255, 0, 0xff, 0x58, 4, num, 2, 24, 8, 0, 0xff, 0x2f, 0];
  const ev: [number, number[]][] = [];
  for (const [q, n, v] of notes) { const t = Math.round(q * ppq); ev.push([t, [0x99, n, v]], [t + 30, [0x89, n, 0]]); }
  ev.sort((a, b) => a[0] - b[0]);
  const t2: number[] = [0, 0xc9, 0, ...extra];
  let last = 0;
  for (const [t, b] of ev) { t2.push(...vlq(t - last), ...b); last = t; }
  t2.push(0, 0xff, 0x2f, 0);
  const chunk = (tr: number[]) => [0x4d, 0x54, 0x72, 0x6b, (tr.length >>> 24) & 255, (tr.length >>> 16) & 255, (tr.length >>> 8) & 255, tr.length & 255, ...tr];
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, (ppq >> 8) & 255, ppq & 255, ...chunk(t1), ...chunk(t2)]);
}

describe('rows', () => {
  it('starts with kick, snare and hi-hat', () => expect(visibleRows(newIdea())).toEqual(['hh', 'sn', 'bd']));
  it('keeps an emptied row until it is tidied', () => {
    let i = addRow(newIdea(), 't1');
    i = setNote(i, 0, 't1', 0, 1);
    i = setNote(i, 0, 't1', 0, 0);
    expect(visibleRows(i)).toContain('t1');
    i = setNote(i, 0, 'sn', 4, 1);
    expect(visibleRows(tidyRows(i))).toEqual(['sn']);
    expect(visibleRows(tidyRows(newIdea()))).toEqual(['hh', 'sn', 'bd']);
  });
});

describe('grid per bar', () => {
  it('cycles 8ths → 16ths → 32nds → triplets', () => expect([nextGrid(2), nextGrid(4), nextGrid(8), nextGrid(3)]).toEqual([4, 8, 3, 2]));
  it('32nds: a 16th groove keeps every note, and a 32nd fill needs them', async () => {
    const { setGrid: sg, ideaToRaw: toRaw, countLabel: cl } = await import('../src/groove');
    const { suggestGrid } = await import('../src/midiimport');
    const ex = exampleIdea();
    const r = sg(ex, 8);
    expect(r.lost).toBe(0);
    expect(toRaw(r.idea).length).toBe(toRaw(ex).length);
    expect(cl(2, 8)).toBe('e');
    expect(suggestGrid([0, 0.125, 0.25, 0.375, 1, 1.5, 2, 2.125, 2.25])).toBe(8);
    expect(suggestGrid([0, 1 / 3, 2 / 3, 1, 4 / 3])).toBe(3);
  });
  it('gives one bar triplets and keeps the others straight', () => {
    const ex = exampleIdea();
    const { idea } = setBarGrid(ex, 1, 3);
    expect(idea.bars[1].grid).toBe(3);
    expect(idea.bars[1].n.sn.length).toBe(12);
    expect(idea.bars[0].n.sn.length).toBe(16);
    expect(stepTime(idea, 1, 1)).toBeCloseTo(4 * 60 / 96 + 60 / 96 / 3);
    expect(engrave(idea, { width: 900 }).bars[1].slotW).toBeGreaterThan(engrave(idea, { width: 900 }).bars[0].slotW);
    expect(textTab(idea)).toMatch(/mixed grid/);
    const back = readMidi(buildMidi(idea));
    expect(back.events.filter((e) => e.on).length).toBeGreaterThan(0);
  });
  it('re-quantises from raw notes without losing them', () => {
    const raw = [{ beat: 0, id: 'bd' as const, v: 1 as const }, { beat: 1 / 3, id: 'sn' as const, v: 1 as const }, { beat: 0.5, id: 'hh' as const, v: 1 as const }];
    let i = withRaw(newIdea(), raw);
    expect(i.bars[0].n.hh[2]).toBe(1);
    i = setGrid(i, 3).idea;
    expect(i.bars[0].n.sn[1]).toBe(1);
    i = setGrid(i, 4).idea;
    expect(i.bars[0].n.hh[2]).toBe(1);
    expect(i.bars[0].n.sn[1]).toBe(1); // 1/3 beat rounds to the nearest 16th
    expect(ideaToRaw(i)).toHaveLength(3);
  });
});

describe('notation styles', () => {
  it('moves the hi-hat to the top line', () => {
    const ex = exampleIdea();
    const a = engrave(ex, { width: 900, style: notationStyle('weinberg') }).svg;
    const b = engrave(ex, { width: 900, style: notationStyle('european') }).svg;
    expect(a).not.toBe(b);
  });
  it('one voice draws no feet rests and all stems up', () => {
    const one = engrave(newIdea(), { width: 600, style: notationStyle('onevoice') }).svg;
    const two = engrave(newIdea(), { width: 600 }).svg;
    expect((one.match(/class="ink" x=.*?width="12" height="4.5"/g) || []).length).toBe(1);
    expect((two.match(/width="12" height="4.5"/g) || []).length).toBe(2);
  });
  it('custom style overrides positions', () => {
    const s = notationStyle('custom', { voices: 2, map: { bd: { step: -2, head: 'note' } } });
    expect(s.map.bd.step).toBe(-2);
    expect(s.map.sn.step).toBe(5);
  });
});

describe('MIDI import', () => {
  it('writes a played groove as a score, with ghosts from soft hits', () => {
    const notes: [number, number, number][] = [];
    for (let k = 0; k < 8; k++) notes.push([k / 2, 42, 80]);
    notes.push([0, 36, 100], [2, 36, 100], [1, 38, 100], [3, 38, 100], [1.75, 38, 25], [3.5, 99, 90]);
    const r = importMidi(midi(notes, 92), roland, 'Take 1');
    expect(r.idea.bpm).toBe(92);
    expect(r.unmapped).toBe(1);
    expect(r.idea.grid).toBe(4);
    const b = r.idea.bars[0].n;
    expect(b.sn[7]).toBe(3);
    expect(b.sn[4]).toBe(1);
    expect(b.bd[8]).toBe(1);
  });
  it('suggests 8ths for a plain groove and finds a triplet fill bar', () => {
    const notes: [number, number, number][] = [];
    for (let k = 0; k < 8; k++) notes.push([k / 2, 42, 80]);
    notes.push([0, 36, 100], [1, 38, 100], [2, 36, 100], [3, 38, 100]);
    for (let k = 0; k < 12; k++) notes.push([4 + k / 3, 38, 100]);
    const r = importMidi(midi(notes), roland);
    expect(r.idea.grid).toBe(2);
    expect(r.idea.bars[1].grid).toBe(3);
    expect(r.idea.bars[1].n.sn.filter(Boolean).length).toBe(12);
  });
  it('skips silent bars at the start and reads the time signature', () => {
    const r = importMidi(midi([[9, 36, 100], [10, 38, 100]], 120, 3), roland);
    expect(r.idea.beats).toBe(3);
    expect(r.idea.bars[0].n.bd[0]).toBe(1);
  });
  it('uses the hi-hat pedal (CC 4) in the file for open or closed', () => {
    const r = importMidi(midi([[0, 26, 80], [1, 26, 80]], 100, 4, [0, 0xb9, 4, 127]), roland);
    expect(r.idea.bars[0].n.hh[0]).toBe(1);
  });
  it('suggests grids', () => {
    expect(suggestGrid([0, 0.5, 1])).toBe(2);
    expect(suggestGrid([0, 0.25, 0.75])).toBe(4);
    expect(suggestGrid([0, 1 / 3, 2 / 3, 1])).toBe(3);
  });
});
