/** Meter: beats per bar, beat unit, grouping and accent levels. */

/** Accent level per beat: 0 = mute, 1 = soft, 2 = normal, 3 = accent. */
export type Level = 0 | 1 | 2 | 3;
export type BeatUnit = 4 | 8;

/**
 * Default grouping of the beats in a bar.
 * Quarter-note meters count in 4s (or 3s when that divides evenly), eighth-note meters in 3s;
 * leftovers become 2s and a lone 1 is avoided: 5 = 3+2, 7/4 = 4+3, 7/8 = 3+2+2, 8/8 = 3+3+2.
 */
export function autoGroups(beats: number, unit: BeatUnit): number[] {
  if (beats <= 4) return [beats];
  const big = unit === 8 ? 3 : beats % 4 === 0 ? 4 : beats % 3 === 0 ? 3 : 4;
  if (beats % big === 0) return Array(beats / big).fill(big);
  const g: number[] = Array(Math.floor(beats / big)).fill(big);
  const r = beats % big;
  if (r === 1) {
    g.pop();
    g.push(...(big === 4 ? [3, 2] : [2, 2]));
  } else g.push(r);
  return g;
}

/** Up to `max` groupings to choose from: the automatic one first, then compositions of 2s, 3s and 4s. */
export function groupOptions(beats: number, unit: BeatUnit, max = 8): number[][] {
  const auto = autoGroups(beats, unit);
  const seen = new Set([auto.join('+')]);
  const res = [auto];
  const all: number[][] = [];
  const rec = (rest: number, acc: number[]) => {
    if (all.length > 300) return;
    if (rest === 0) { all.push(acc); return; }
    for (const p of [2, 3, 4]) if (p <= rest) rec(rest - p, [...acc, p]);
  };
  rec(beats, []);
  if (beats <= 4) all.push([beats]);
  all.sort((a, b) => a.length - b.length || b[0] - a[0]);
  for (const g of all) {
    const k = g.join('+');
    if (!seen.has(k)) { seen.add(k); res.push(g); }
    if (res.length >= max) break;
  }
  return res;
}

/** Use a chosen grouping only when it still sums to the beat count. */
export function groupsFor(beats: number, unit: BeatUnit, chosen?: number[] | null): number[] {
  return chosen && chosen.reduce((a, b) => a + b, 0) === beats ? chosen : autoGroups(beats, unit);
}

/** Default levels: accent on 1, normal elsewhere. */
export function defaultLevels(beats: number): Level[] {
  return Array.from({ length: beats }, (_, i) => (i === 0 ? 3 : 2));
}

/** Resize a level list to `beats`, keeping what exists and filling with normal. */
export function levelsFor(levels: Level[], beats: number): Level[] {
  const l = levels.slice(0, beats);
  while (l.length < beats) l.push(2);
  return l;
}

/** Accent on 1, normal on the start of each other group, soft elsewhere. */
export function accentGroupStarts(groups: number[]): Level[] {
  const out: Level[] = [];
  groups.forEach((size, gi) => {
    for (let k = 0; k < size; k++) out.push(k ? 1 : gi ? 2 : 3);
  });
  return out;
}

/** Cycle a beat's level the way a tap on the beat does: accent → normal → soft → mute → accent. */
export function cycleLevel(l: Level): Level {
  return ((l + 3) % 4) as Level;
}

const MARKINGS: [number, string][] = [
  [40, 'Grave'], [60, 'Largo'], [66, 'Larghetto'], [76, 'Adagio'], [108, 'Andante'],
  [120, 'Moderato'], [156, 'Allegro'], [176, 'Vivace'], [200, 'Presto'], [Infinity, 'Prestissimo'],
];
/** Classical tempo marking for a BPM value. */
export function tempoMarking(bpm: number): string {
  return MARKINGS.find(([max]) => bpm < max)![1];
}

/** Average BPM from tap times in ms (last up to 5 taps; a gap over 2 s starts again). */
export function tapTempo(tapsMs: number[]): number | null {
  const taps: number[] = [];
  for (const t of tapsMs) {
    if (taps.length && t - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(t);
    if (taps.length > 5) taps.shift();
  }
  if (taps.length < 2) return null;
  return 60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1));
}
