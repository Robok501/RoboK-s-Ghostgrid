/** Run Ghostgrid's beat map on every WAV in a lab folder; writes <name>.gg.json. Usage: vite-node beats_ours.ts <dir> */
import { readFileSync, writeFileSync } from 'fs';
import { barStarts, beatMap } from '../../packages/core/src/beatmap';
import { envelope } from '../../packages/core/test/lab/audio';
import { readWav } from './wav';

const dir = process.argv[2];
const names: string[] = JSON.parse(readFileSync(`${dir}/index.json`, 'utf8'));
for (const n of names) {
  const { x, sr } = readWav(`${dir}/${n}.wav`);
  const m = beatMap(envelope(x, sr), 4);
  writeFileSync(`${dir}/${n}.gg.json`, JSON.stringify({ beats: m.beats, downbeats: barStarts(m), bpm: m.bpm }));
  console.log(n, m.bpm, 'BPM', m.beats.length, 'beats');
}
