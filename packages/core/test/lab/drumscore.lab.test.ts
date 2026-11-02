/** Drums to score on audio built from real drum samples (local only: GHOSTGRID_KITS_DIR). */
import { describe, expect, it } from 'vitest';
import { barStarts, beatMap } from '../../src/beatmap';
import { drumHits, hitsToIdea } from '../../src/drumscore';
import { ideaToRaw } from '../../src/groove';
import { envelope, hasKits, KITS, loadF32, sampleSong, type Drum } from './audio';

const key = (r: { id: string; v: number }) => (r.id === 'sn' && r.v === 3 ? 'sng' : r.id === 'hh' && r.v === 3 ? 'hho' : r.id);
const rock: [number, Drum][] = [[0, 'bd'], [2, 'bd'], [2.5, 'bd'], [1, 'sn'], [3, 'sn'], ...[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((x) => [x, 'hh'] as [number, Drum])];
const funk: [number, Drum][] = [[0, 'bd'], [0.75, 'bd'], [2.5, 'bd'], [1, 'sn'], [3, 'sn'], [1.75, 'sng'], [2.25, 'sng'], [3.75, 'sng'],
  ...[0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25].map((x) => [x, 'hh'] as [number, Drum]), [3.5, 'hho']];

describe.skipIf(!hasKits)('drums to score, real samples', () => {
  for (const kit of ['Kit8', 'Kit3', 'LINN']) for (const [name, pat, bpm] of [['rock', rock, 104], ['funk', funk, 92]] as const) for (const dirty of [0, 0.3, 0.6, 1]) {
    it(`${kit} ${name} dirty ${dirty}`, () => {
      const { audio, truth } = sampleSong(kit, pat as [number, Drum][], 8, bpm, { dirty });
      const env = envelope(audio);
      const m = beatMap(env, 4);
      const hits = drumHits(env);
      // hits in time (before the beat map): how many of the truth are found with the right drum
      const tk = (k: Drum) => (k === 'sng' ? 'sn' : k === 'hho' ? 'hh' : k);
      const found = truth.filter((t) => hits.some((h) => Math.abs(h.t - t.t - 0.005) < 0.035 && h.id === tk(t.k))).length;
      const extraH = hits.filter((h) => !truth.some((t) => Math.abs(h.t - t.t - 0.005) < 0.035 && h.id === tk(t.k)));
      const r = hitsToIdea(hits, m, 0, 1e9, 'x');
      const raw = ideaToRaw(r.idea);
      const first = barStarts(m)[0], one = truth[0].t;
      console.log(kit, name, dirty, `bpm ${m.bpm} first bar ${first?.toFixed(2)} (true ${one.toFixed(2)}) bars ${r.bars} grid ${r.idea.grid}`,
        `| hits ${found}/${truth.length} extra ${extraH.length} ${JSON.stringify(extraH.reduce((o, h) => ({ ...o, [h.id]: (o[h.id] ?? 0) + 1 }), {} as Record<string, number>))}`,
        `| notes ${raw.length}: ${raw.filter((x) => x.beat < 4).map((x) => `${key(x)}${x.beat.toFixed(2)}`).join(' ')}`);
      expect(found / truth.length).toBeGreaterThan(0.85);
    });
  }
  it('breakbeat', () => {
    const env = envelope(loadF32(`${KITS}/breakbeat.f32`));
    const m = beatMap(env, 4), hits = drumHits(env), r = hitsToIdea(hits, m, 0, 1e9, 'x');
    console.log('BREAK', m.bpm, m.beats.length, hits.length, hits.map((h) => `${h.id}${h.t.toFixed(2)}`).join(' '));
    console.log('BREAK notes', ideaToRaw(r.idea).map((x) => `${key(x)}${x.beat.toFixed(2)}`).join(' '));
  });
});
