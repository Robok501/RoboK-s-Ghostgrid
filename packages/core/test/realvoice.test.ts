/**
 * Recognition on real beatbox recordings. The recordings are personal voice data, so they are NOT in this public
 * repository: put kick.f32, snare.f32, hihat.f32 (teaching takes) and groove.f32 (boom–ts–tak–ts on 8ths) as raw
 * 48 kHz mono float files in a folder and run with GHOSTGRID_VOICE_DIR=/that/folder. Skipped otherwise.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { addSamples, analyze, type Samples } from '../src/voice';

const DIR = process.env.GHOSTGRID_VOICE_DIR ?? '';
const has = !!DIR && ['kick', 'snare', 'hihat', 'groove'].every((n) => existsSync(`${DIR}/${n}.f32`));
const load = (n: string) => { const b = readFileSync(`${DIR}/${n}.f32`); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const SR = 48000;

describe.skipIf(!has)('real voice (local recordings)', () => {
  it('finds each taught boom once (no double triggers)', () => {
    expect(analyze(load('kick'), SR, {}, 45, 5).hits.length).toBe(6);
  });
  it('recognises a boom–ts–tak–ts groove after teaching', () => {
    let s: Samples = {};
    for (const [n, k] of [['kick', 'bd'], ['snare', 'sn'], ['hihat', 'hh']] as const) {
      const a = analyze(load(n), SR, {}, 45, 5);
      const loud = Math.max(...a.hits.map((h) => h.peak));
      s = addSamples(s, k, a.hits.filter((h) => h.peak >= loud * 0.2).sort((x, y) => y.peak - x.peak).slice(0, 6).map((h) => h.f.v));
    }
    const hits = analyze(load('groove'), SR, s, 45, 5).hits.filter((h) => h.t > 2.6);
    const step = (11.27 - 2.79) / 25, truth = ['bd', 'hh', 'sn', 'hh'], used = new Set<number>();
    let right = 0, extra = 0;
    for (const h of hits) {
      const j = Math.round((h.t - 2.79) / step);
      if (j >= 0 && j < 26 && Math.abs(h.t - (2.79 + j * step)) < 0.07 && !used.has(j)) { used.add(j); if (truth[j % 4] === h.cls) right++; } else extra++;
    }
    expect(right).toBeGreaterThanOrEqual(24);
    expect(extra).toBeLessThanOrEqual(3);
  });
});
