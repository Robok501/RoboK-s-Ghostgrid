/** Plain-text drum tab, for copying into chats, notes or lesson sheets. */
import { INSTRUMENTS, countLabel, steps, type Idea, type Instrument, type NoteState } from '../groove';

const ch = (i: Instrument, v: NoteState) =>
  !v ? '-' : v === 2 ? (i.x ? 'X' : 'O') : v === 3 ? (i.alt === 'open' ? 'o' : 'g') : i.x ? 'x' : 'o';

export function textTab(idea: Idea): string {
  const g = idea.grid, n = steps(idea);
  const used = INSTRUMENTS.filter((i) => idea.bars.some((b) => b.n[i.id].some((v) => v)));
  const gridName = g === 4 ? '16ths' : g === 2 ? '8ths' : 'triplets';
  const swing = idea.swing && g !== 3 ? `, swing ${idea.swing}%` : '';
  let out = `${idea.name} — ${idea.bpm} BPM, ${idea.beats}/4, ${gridName}${swing}\n\n`;
  out += '   |' + idea.bars.map(() => Array.from({ length: n }, (_, s) => countLabel(s, g)).join('')).join('|') + '|\n';
  for (const i of used) out += i.short.padEnd(3) + '|' + idea.bars.map((b) => b.n[i.id].map((v) => ch(i, v)).join('')).join('|') + '|\n';
  out += '\nx/o = hit · X/O = accent · g = ghost note · o on HH = open hi-hat\n';
  return out;
}
