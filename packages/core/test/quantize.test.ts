import { describe, expect, it } from 'vitest';
import { MAX_BARS, exampleIdea, newIdea } from '../src/groove';
import { guessTempo, quantize, writeHits, type TimedHit } from '../src/quantize';

const sd = 60 / 100 / 4; // 16th at 100 BPM
const hits: TimedHit[] = [
  { t: 1 + 0 * sd, cls: 'bd' }, { t: 1 + 2 * sd + 0.01, cls: 'hh' }, { t: 1 + 4 * sd - 0.012, cls: 'sn', acc: true },
  { t: 1 + 6 * sd, cls: 'hh', v: 3 }, { t: 1 + 8 * sd + 0.005, cls: 'bd' }, { t: 1 + 12 * sd, cls: 'sn' }, { t: 1 + 17 * sd, cls: 'bd' },
];

describe('guessTempo', () => {
  it('recovers the tempo from slightly loose hits', () => expect(guessTempo(hits.map((h) => h.t), 4)).toBe(100));
  it('needs at least three hits', () => expect(guessTempo([0, 1], 4)).toBeNull());
});

describe('quantize', () => {
  it('snaps to the nearest step and wraps into bars', () => {
    const p = quantize(hits, 1, { bpm: 100, beats: 4, grid: 4 });
    expect(p.map((x) => [x.bar, x.step])).toEqual([[0, 0], [0, 2], [0, 4], [0, 6], [0, 8], [0, 12], [1, 1]]);
  });
  it('drops hits before beat 1 and past the bar limit', () => {
    expect(quantize([{ t: 0.5, cls: 'bd' }], 1, { bpm: 100, beats: 4, grid: 4 })).toEqual([]);
    expect(quantize([{ t: 1 + 16 * MAX_BARS * sd, cls: 'bd' }], 1, { bpm: 100, beats: 4, grid: 4 })).toEqual([]);
  });
});

describe('writeHits', () => {
  it('adds bars as needed and keeps accents, open hi-hats and plain hits', () => {
    const { idea, written } = writeHits({ ...newIdea(), bpm: 100 }, hits, 1, 'replace');
    expect(written).toBe(7);
    expect(idea.bars.length).toBe(2);
    expect(idea.bars[0].n.sn[4]).toBe(2);
    expect(idea.bars[0].n.hh[6]).toBe(3);
    expect(idea.bars[1].n.bd[1]).toBe(1);
  });
  it('replace clears voice instruments in written bars; merge keeps them', () => {
    const base = { ...exampleIdea(), bpm: 100 };
    const one: TimedHit[] = [{ t: 0, cls: 'bd' }];
    expect(writeHits(base, one, 0, 'replace').idea.bars[0].n.hh.some((v) => v)).toBe(false);
    expect(writeHits(base, one, 0, 'merge').idea.bars[0].n.hh.some((v) => v)).toBe(true);
    expect(writeHits(base, one, 0, 'replace').idea.bars[1]).toEqual(base.bars[1]);
  });
  it('e-drum replace clears every instrument', () => {
    const base = { ...exampleIdea(), bpm: 100 };
    base.bars[0].n.rd[0] = 1;
    expect(writeHits(base, [{ t: 0, cls: 'bd' }], 0, 'replace', true).idea.bars[0].n.rd[0]).toBe(0);
  });
});
