/** Run Ghostgrid's current drums-to-score detector on WAV files. Usage: vite-node ours.ts <dir> */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { drumHits, modelDrumHits } from '../../packages/core/src/drumscore';
import { envelope } from '../../packages/core/test/lab/audio';

function readWav(p: string): Float32Array {
  const b = readFileSync(p);
  let o = 12, fmt = 1, ch = 1, bits = 16;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') { fmt = b.readUInt16LE(o + 8); ch = b.readUInt16LE(o + 10); bits = b.readUInt16LE(o + 22); }
    if (id === 'data') {
      const n = size / (bits / 8) / ch, x = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < ch; c++) {
          const at = o + 8 + (i * ch + c) * (bits / 8);
          s += fmt === 3 ? b.readFloatLE(at) : bits === 16 ? b.readInt16LE(at) / 32768 : b.readInt32LE(at) / 2147483648;
        }
        x[i] = s / ch;
      }
      return x;
    }
    o += 8 + size + (size & 1);
  }
  throw new Error('no data in ' + p);
}

const dir = process.argv[2];
const names: string[] = JSON.parse(readFileSync(`${dir}/index.json`, 'utf8'));
for (const n of names) {
  const env = envelope(readWav(`${dir}/${n}.wav`));
  const hits = drumHits(env);
  writeFileSync(`${dir}/${n}.ours.json`, JSON.stringify(hits.map((h) => ({ t: h.t, id: h.id, v: h.v }))));
  // the app's hybrid (model + our hi-hat), when the model has run
  if (existsSync(`${dir}/${n}.oafraw.json`)) {
    const app = modelDrumHits(JSON.parse(readFileSync(`${dir}/${n}.oafraw.json`, 'utf8')), env);
    writeFileSync(`${dir}/${n}.app.json`, JSON.stringify(app.map((h) => ({ t: h.t, id: h.id, v: h.v }))));
  }
  console.log(n, hits.length, 'hits');
}
