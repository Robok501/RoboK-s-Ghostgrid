import { readFileSync } from 'fs';
/** Mono samples of a PCM/float WAV. */
export function readWav(p: string): { x: Float32Array; sr: number } {
  const b = readFileSync(p);
  let o = 12, fmt = 1, ch = 1, bits = 16, sr = 44100;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') { fmt = b.readUInt16LE(o + 8); ch = b.readUInt16LE(o + 10); sr = b.readUInt32LE(o + 12); bits = b.readUInt16LE(o + 22); }
    if (id === 'data') {
      const n = Math.floor(size / (bits / 8) / ch), x = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < ch; c++) {
          const at = o + 8 + (i * ch + c) * (bits / 8);
          s += fmt === 3 ? b.readFloatLE(at) : bits === 16 ? b.readInt16LE(at) / 32768 : bits === 8 ? (b.readUInt8(at) - 128) / 128 : b.readInt32LE(at) / 2147483648;
        }
        x[i] = s / ch;
      }
      return { x, sr };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error('no data in ' + p);
}
