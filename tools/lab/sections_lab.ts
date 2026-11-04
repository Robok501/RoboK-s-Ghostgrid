/** Section lab: run the song-part finder on real songs and compare with a reference (e.g. Moises) the way we agreed:
 *  adjacent reference parts with the same name are merged; our boundaries inside such a block are neutral;
 *  we score (1) reference name changes found within ±1 bar, (2) our parts being "pure" (one reference name).
 *  Usage: vite-node sections_lab.ts <songs.json> <ref.json> <outdir>   songs.json: { "<ref key>": "<audio path>" } */
import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync } from 'fs';
import { barStarts, beatMap } from '../../packages/core/src/beatmap';
import { barBands, barTimbre, barVectors, findSections, joinVectors, noveltyCurve } from '../../packages/core/src/sections';
import { envelope } from '../../packages/core/test/lab/audio';
import { readWav } from './wav';

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
/** Same as GGStems.musicFeatures (Swift). */
function musicFeatures(x: Float32Array, sr: number) {
  const N = 4096, hop = Math.floor(sr / 10);
  const win = Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const pc = new Int8Array(N / 2).fill(-1), isBass = new Uint8Array(N / 2);
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N;
    if (f >= 55 && f <= 2000) pc[k] = ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12;
    isBass[k] = f >= 40 && f <= 150 ? 1 : 0;
  }
  const NB = 24, edges = Array.from({ length: NB + 2 }, (_, i) => { const m0 = 2595 * Math.log10(1 + 40 / 700), m1 = 2595 * Math.log10(1 + 8000 / 700); return 700 * (10 ** ((m0 + ((m1 - m0) * i) / (NB + 1)) / 2595) - 1); });
  const mel: number[] = [];
  const chroma: number[] = [], bass: number[] = [];
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let s = 0; s + N <= x.length; s += hop) {
    for (let i = 0; i < N; i++) { re[i] = x[s + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const c = new Array(12).fill(0);
    let b = 0;
    for (let k = 1; k < N / 2; k++) {
      const m = re[k] * re[k] + im[k] * im[k];
      if (pc[k] >= 0) c[pc[k]] += Math.sqrt(m);
      if (isBass[k]) b += m;
    }
    chroma.push(...c); bass.push(Math.sqrt(b));
    const mb = new Array(NB).fill(0);
    for (let k = 1; k < N / 2; k++) { const f = (k * sr) / N; for (let j = 0; j < NB; j++) if (f >= edges[j] && f < edges[j + 2]) { const w = f < edges[j + 1] ? (f - edges[j]) / (edges[j + 1] - edges[j]) : (edges[j + 2] - f) / (edges[j + 2] - edges[j + 1]); mb[j] += w * (re[k] * re[k] + im[k] * im[k]); } }
    for (let j = 0; j < NB; j++) mel.push(Math.log(1e-8 + mb[j]));
  }
  return { rate: 10, chroma, bass, mel };
}

const [songsP, refP, out] = process.argv.slice(2);
const songs: Record<string, string> = JSON.parse(readFileSync(songsP, 'utf8'));
const refs: Record<string, [number, string][]> = JSON.parse(readFileSync(refP, 'utf8'));
mkdirSync(out, { recursive: true });
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

for (const [key, path] of Object.entries(songs)) {
  const wav = `${out}/${key.replace(/[^a-z0-9]+/gi, '_')}.wav`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', '44100', wav]);
  const { x, sr } = readWav(wav);
  const dur = x.length / sr;
  const music = musicFeatures(x, sr);
  const m = beatMap(envelope(x, sr), 4, music);
  const bars = barStarts(m);
  const barLen = (60 / m.bpm) * m.beatsPerBar;
  const chromaV = barVectors(music, bars, dur);
  const env = envelope(x, sr);
  const bandsV = barBands(env, bars, dur);
  const wc = Number(process.env.WC ?? 1), wb = Number(process.env.WB ?? 0);
  const timbreV = barTimbre(music.mel, 24, 10, bars, dur);
  const wt = Number(process.env.WT ?? 0);
  const base = wb > 0 ? joinVectors(chromaV, wc, bandsV, wb) : chromaV;
  const vec = wt > 0 ? joinVectors(base, 1, timbreV, wt) : base;
  const nov = noveltyCurve(vec);
  console.log(`\n== ${key}  ${dur.toFixed(0)} s, ${m.bpm} BPM, ${bars.length} bars (1 bar ≈ ${barLen.toFixed(1)} s)`);
  const ref = refs[key];
  for (const cfg of (process.env.CFG ?? '4:0.3').split(',')) {
    const [minB, zz] = cfg.split(':').map(Number);
    const secs = findSections(vec, { z: zz, floor: 0, minBars: minB });
    let line = `  [min ${minB} bars, z ${zz}] ${secs.length} parts: ` + secs.map((s) => `${s.letter}[${mmss(bars[s.from])}]`).join(' ');
    console.log(line);
    if (!ref) continue;
    const blocks: { t: number; name: string }[] = [];
    for (const [t, name] of ref) if (name !== 'end' && name !== 'end?' && (!blocks.length || blocks[blocks.length - 1].name !== name)) blocks.push({ t, name });
    const endT = ref[ref.length - 1][0];
    const mine = secs.map((s) => bars[s.from]);
    const tol = barLen * 1.1 * Number(process.env.TOL ?? 1);
    const found = blocks.slice(1).filter((b) => mine.some((t) => Math.abs(t - b.t) <= tol)).length;
    const inside = mine.filter((t, i) => i > 0 && !blocks.some((b) => Math.abs(b.t - t) <= tol)).length;
    let pureNum = 0, pureDen = 0;
    secs.forEach((s, i) => {
      const a = bars[s.from], b = i + 1 < secs.length ? bars[secs[i + 1].from] : Math.min(dur, endT);
      const cover: Record<string, number> = {};
      blocks.forEach((bl, k) => { const e = blocks[k + 1]?.t ?? endT; const ov = Math.max(0, Math.min(b, e) - Math.max(a, bl.t)); cover[bl.name] = (cover[bl.name] ?? 0) + ov; });
      const tot = Object.values(cover).reduce((p, q) => p + q, 0), best = Math.max(0, ...Object.values(cover));
      pureNum += best; pureDen += tot;
    });
    console.log(`RESULT ${key}|${cfg}|${found}|${blocks.length - 1}|${inside}|${(100 * pureNum / Math.max(1e-9, pureDen)).toFixed(0)}|${secs.length}`);
  }
}
