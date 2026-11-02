/** Plain-text drum tab, for copying into chats, notes or lesson sheets. */
import { INSTRUMENTS, barGrid, countLabel, type Idea, type Instrument, type NoteState } from '../groove';

const ch = (i: Instrument, v: NoteState) =>
  !v ? '-' : v === 2 ? (i.x ? 'X' : 'O') : v === 3 ? (i.alt === 'open' ? 'o' : 'g') : i.x ? 'x' : 'o';

export function textTab(idea: Idea): string {
  const g = idea.grid;
  const used = INSTRUMENTS.filter((i) => idea.bars.some((b) => b.n[i.id].some((v) => v)));
  const mixed = idea.bars.some((_, b) => barGrid(idea, b) !== g);
  const gridName = mixed ? 'mixed grid' : g === 4 ? '16ths' : g === 2 ? '8ths' : g === 8 ? '32nds' : 'triplets';
  const swing = idea.swing && g !== 3 ? `, swing ${idea.swing}%` : '';
  let out = `${idea.name} — ${idea.bpm} BPM, ${idea.beats}/4, ${gridName}${swing}\n\n`;
  out += '   |' + idea.bars.map((_, b) => { const bg = barGrid(idea, b); return Array.from({ length: idea.beats * bg }, (_, s) => countLabel(s, bg, 'en')).join(''); }).join('|') + '|\n';
  for (const i of used) out += i.short.padEnd(3) + '|' + idea.bars.map((b) => b.n[i.id].map((v) => ch(i, v)).join('')).join('|') + '|\n';
  out += '\nx/o = hit · X/O = accent · g = ghost note · o on HH = open hi-hat\n';
  return out;
}
