/**
 * Notation styles: where each instrument sits on the staff, which notehead it gets, and whether hands and feet
 * are written as two voices (hands stems up, feet stems down) or one. Switching style only redraws the score.
 */
import { tr } from './i18n';
import { INSTRUMENTS, type InstrumentId } from './groove';

export type Notehead = 'x' | 'note';
/** Staff position: 0 = bottom line (E4), 8 = top line (F5); odd numbers are spaces. */
export interface StaffPlace { step: number; head: Notehead }
export interface NotationStyle { id: string; name: string; blurb: string; voices: 1 | 2; map: Record<InstrumentId, StaffPlace> }

const base = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, { step: i.step, head: i.x ? 'x' : 'note' }])) as Record<InstrumentId, StaffPlace>;
const withMap = (patch: Partial<Record<InstrumentId, StaffPlace>>) => ({ ...base, ...patch });

export const NOTATION_STYLES: NotationStyle[] = [
  {
    id: 'weinberg', name: 'Weinberg (PAS)', voices: 2, map: base,
    blurb: 'The common American key: kick in the bottom space, snare in the third space, hi-hat x above the staff, ride x on the top line.',
  },
  {
    id: 'european', name: 'Hi-hat on the top line', voices: 2,
    map: withMap({ hh: { step: 8, head: 'x' }, rd: { step: 9, head: 'x' } }),
    blurb: 'Seen in many European method books: hi-hat x on the top line, ride x just above it.',
  },
  {
    id: 'lowkick', name: 'Kick on the bottom line', voices: 2,
    map: withMap({ bd: { step: 0, head: 'note' }, ft: { step: 2, head: 'note' } }),
    blurb: 'Older European style: kick on the bottom line, floor tom on the second line.',
  },
  {
    id: 'onevoice', name: 'One voice', voices: 1, map: base,
    blurb: 'Weinberg positions, but every note stems up in one rhythm. Easier for beginners to count.',
  },
];

export const DEFAULT_STYLE = NOTATION_STYLES[0];

export interface CustomStyle { voices: 1 | 2; map: Partial<Record<InstrumentId, StaffPlace>> }

/** Resolve a style id ('custom' uses the user's own mapping on top of Weinberg). */
export function notationStyle(id: string, custom?: CustomStyle | null): NotationStyle {
  if (id === 'custom' && custom) {
    return { id: 'custom', name: 'Custom', blurb: 'Your own key.', voices: custom.voices, map: { ...base, ...custom.map } };
  }
  return NOTATION_STYLES.find((s) => s.id === id) ?? DEFAULT_STYLE;
}

/** Name of a staff position, for the custom editor (E4 … C6). */
export function staffName(step: number): string {
  const letters = 'EFGABCD';
  const idx = step + 0; // 0 = E4
  const letter = letters[((idx % 7) + 7) % 7];
  const octave = 4 + Math.floor((idx + 2) / 7);
  return `${letter}${octave} · ${tr(step % 2 === 0 ? 'line' : 'space')}`;
}
