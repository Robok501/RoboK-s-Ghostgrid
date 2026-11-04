import { describe, expect, it } from 'vitest';
import { findSections, songSections } from '../src/sections';

// a fake song, 1 bar = 2 s = 20 frames: A(8 bars, chord set 1) B(8, chord set 2, louder) A(8) B(8) C(8, set 3)
function song(plan: [number, number][]) {
  const chroma: number[] = [], bass: number[] = [], bars: number[] = [];
  let t = 0;
  for (const [kind, nb] of plan) for (let b = 0; b < nb; b++) {
    bars.push(t);
    for (let f = 0; f < 20; f++) {
      const prog = [0, 4, 7, 9][Math.floor(b / 2) % 4] + kind * 2; // the chord changes every 2 bars
      for (let k = 0; k < 12; k++) chroma.push((k === prog % 12 || k === (prog + 4) % 12 ? 0.8 : 0.02) + ((k + 12 - kind * 5) % 12 === 0 || (k + 12 - kind * 5) % 12 === 7 ? 0.9 : 0) + 0.03 * Math.sin(f + b + k));
      bass.push(kind === 1 ? 0.8 : 0.3);
    }
    t += 2;
  }
  return { music: { rate: 10, chroma, bass }, bars, end: t };
}

describe('sections', () => {
  it('finds the parts and gives repeats the same letter', () => {
    const s = song([[0, 8], [1, 8], [0, 8], [1, 8], [2, 8]]);
    const r = songSections(s.music, s.bars, s.end);
    expect(r.map((x) => x.letter).join('')).toBe('ABABC');
    expect(r.map((x) => x.from)).toEqual([0, 8, 16, 24, 32]);
  });
  it('leaves a short or flat song as one section', () => {
    expect(findSections([[1, 0], [1, 0], [1, 0]])).toHaveLength(1);
    const s = song([[0, 24]]);
    expect(songSections(s.music, s.bars, s.end).map((x) => x.letter).join('')).toBe('A');
  });
});
