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
  it('keeps up with faster grooves (taught hits spliced at 8ths and 16ths, 90–140 BPM)', () => {
  let s: Samples = {};
  const cuts: Record<string, Float32Array[]> = {};
  for (const [n, k] of [['kick', 'bd'], ['snare', 'sn'], ['hihat', 'hh']] as const) {
    const d = load(n), a = analyze(d, SR, {}, 45, 5);
    const loud = Math.max(...a.hits.map((h) => h.peak));
    const good = a.hits.filter((h) => h.peak >= loud * 0.2).sort((x, y) => y.peak - x.peak).slice(0, 6);
    s = addSamples(s, k, good.map((h) => h.f.v));
    cuts[k] = good.map((h) => {
      const nx = a.hits.find((o) => o.t > h.t + 0.02)?.t ?? h.t + 1;
      const c = d.slice(Math.max(0, Math.round(h.t * SR) - 240), Math.round(Math.min(h.t + 0.2, nx - 0.01) * SR));
      const fade = Math.min(480, c.length); for (let j = 0; j < fade; j++) c[c.length - 1 - j] *= j / fade;
      return c;
    });
  }
  for (const [name, bpm, pat] of [['8ths 100', 100, 'bd hh sn hh'], ['16ths 90', 90, 'bd hh hh hh sn hh hh bd bd hh hh hh sn hh hh hh'], ['8ths 140', 140, 'bd hh sn hh bd bd sn hh'], ['16ths 110', 110, 'bd hh sn hh bd hh sn hh']] as const) {
    const step = 60 / bpm / (name.startsWith('16') ? 4 : 2), p = pat.split(' '), n = p.length * 4;
    const out = new Float32Array(Math.round((n * step + 1.5) * SR)), truth: [number, string][] = [];
    let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < n; i++) {
      const k = p[i % p.length], c = cuts[k][Math.floor(rnd() * cuts[k].length)], t0 = Math.round((0.5 + i * step) * SR), g = 0.5 + rnd() * 0.7;
      truth.push([0.5 + i * step + 0.005, k]);
      for (let j = 0; j < c.length && t0 + j < out.length; j++) out[t0 + j] += c[j] * g;
    }
    const hits = analyze(out, SR, s, 45, 5).hits;
    let right = 0, wrong = 0, extra = 0; const used = new Set<number>(); const conf: Record<string, number> = {};
    for (const h of hits) {
      const j = truth.findIndex(([t]) => Math.abs(t - h.t) < 0.04);
      if (j < 0 || used.has(j)) { extra++; continue; }
      used.add(j);
      if (truth[j][1] === h.cls) right++; else { wrong++; conf[`${truth[j][1]}→${h.cls}`] = (conf[`${truth[j][1]}→${h.cls}`] ?? 0) + 1; }
    }
    const missed = truth.filter((_, j) => !used.has(j)).map(([t, k]) => `${k}@${t.toFixed(2)}`).slice(0, 6).join(' ');
    expect(right, `${name}: ${JSON.stringify(conf)}`).toBeGreaterThanOrEqual(n * 0.9);
    expect(extra, name).toBeLessThanOrEqual(2);
    console.log(name, missed, '|', hits.slice(0, 10).map((h) => `${h.cls}@${h.t.toFixed(2)}`).join(' '));
    expect(right, `${name}: ${JSON.stringify(conf)}`).toBeGreaterThanOrEqual(n * 0.9);
    expect(extra, name).toBeLessThanOrEqual(2);
    console.log(name, `right ${right}/${n} wrong ${wrong} missed ${n - used.size} extra ${extra}`, JSON.stringify(conf));
  }
})});
