import { describe, expect, it } from 'vitest';
import { accentGroupStarts, autoGroups, cycleLevel, groupOptions, groupsFor, levelsFor, tapTempo, tempoMarking } from '../src/meter';

describe('autoGroups', () => {
  it.each([
    [4, 4, '4'], [5, 4, '3+2'], [6, 4, '3+3'], [7, 4, '4+3'], [8, 4, '4+4'], [9, 4, '3+3+3'], [10, 4, '4+4+2'], [13, 4, '4+4+3+2'],
    [5, 8, '3+2'], [6, 8, '3+3'], [7, 8, '3+2+2'], [8, 8, '3+3+2'], [12, 8, '3+3+3+3'], [10, 8, '3+3+2+2'],
  ] as const)('%i/%i → %s', (beats, unit, expected) => {
    expect(autoGroups(beats, unit).join('+')).toBe(expected);
  });
  it('always sums to the beat count', () => {
    for (let n = 1; n <= 16; n++) for (const u of [4, 8] as const) expect(autoGroups(n, u).reduce((a, b) => a + b, 0)).toBe(n);
  });
});

describe('groupOptions', () => {
  it('puts the automatic grouping first and lists alternatives for 7/8', () => {
    const opts = groupOptions(7, 8).map((g) => g.join('+'));
    expect(opts[0]).toBe('3+2+2');
    expect(opts).toContain('2+2+3');
    expect(opts).toContain('4+3');
    expect(new Set(opts).size).toBe(opts.length);
  });
  it('respects a chosen grouping only when it fits', () => {
    expect(groupsFor(7, 8, [2, 2, 3])).toEqual([2, 2, 3]);
    expect(groupsFor(8, 8, [2, 2, 3])).toEqual([3, 3, 2]);
  });
});

describe('levels', () => {
  it('accents group starts', () => expect(accentGroupStarts([2, 2, 3])).toEqual([3, 1, 2, 1, 2, 1, 1]));
  it('resizes levels', () => expect(levelsFor([3, 0, 1], 5)).toEqual([3, 0, 1, 2, 2]));
  it('cycles accent → normal → soft → mute → accent', () => {
    expect([3, 2, 1, 0].map((l) => cycleLevel(l as 0 | 1 | 2 | 3))).toEqual([2, 1, 0, 3]);
  });
});

describe('tempo helpers', () => {
  it('names tempos', () => {
    expect(tempoMarking(70)).toBe('Adagio');
    expect(tempoMarking(100)).toBe('Andante');
    expect(tempoMarking(130)).toBe('Allegro');
  });
  it('averages taps and restarts after a pause', () => {
    expect(tapTempo([0, 500, 1000, 1500])).toBeCloseTo(120);
    expect(tapTempo([0, 600, 5000, 5500, 6000])).toBeCloseTo(120);
    expect(tapTempo([0])).toBeNull();
  });
});
