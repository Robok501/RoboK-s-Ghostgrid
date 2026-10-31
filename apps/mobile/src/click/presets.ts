import type { Preset } from '../store';

/** Built-in starting points (same as the web prototype). Eighth-note meters appear from the Chops level. */
export const BUILTIN_PRESETS: Preset[] = [
  { name: 'Rock 4/4 · 8ths', bpm: 120, beats: 4, unit: 4, sub: 2, levels: [3, 2, 2, 2] },
  { name: 'Shuffle 12/8', bpm: 76, beats: 4, unit: 4, sub: 3, levels: [3, 2, 2, 2] },
  { name: 'Waltz 3/4', bpm: 96, beats: 3, unit: 4, sub: 1, levels: [3, 1, 1] },
  { name: 'Ballad 6/8', bpm: 132, beats: 6, unit: 8, sub: 1, levels: [3, 1, 1, 2, 1, 1] },
  { name: 'Prog 7/8 (2+2+3)', bpm: 240, beats: 7, unit: 8, sub: 1, levels: [3, 1, 2, 1, 2, 1, 1], groups: [2, 2, 3] },
  { name: 'Backbeat 2 & 4', bpm: 92, beats: 4, unit: 4, sub: 1, levels: [0, 3, 0, 3] },
];

export const SUB_NAMES = ['', '', '8ths', 'triplets', '16ths'];
