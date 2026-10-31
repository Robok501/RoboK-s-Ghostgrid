/** Minimal ZIP writer (stored, no compression) for bundling exports, e.g. a .mid where only .zip may be saved. */
import { utf8 } from './midi';

export function crc32(u: Uint8Array): number {
  let crc = -1;
  for (let i = 0; i < u.length; i++) {
    let c = (crc ^ u[i]) & 255;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ -1) >>> 0;
}

export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const nm = utf8(f.name), crc = crc32(f.data), L = f.data.length;
    const lh = new Uint8Array(30 + nm.length), a = new DataView(lh.buffer);
    a.setUint32(0, 0x04034b50, true); a.setUint16(4, 20, true); a.setUint16(12, 0x21, true);
    a.setUint32(14, crc, true); a.setUint32(18, L, true); a.setUint32(22, L, true); a.setUint16(26, nm.length, true); lh.set(nm, 30);
    const ch = new Uint8Array(46 + nm.length), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, L, true); c.setUint32(24, L, true); c.setUint16(28, nm.length, true); c.setUint32(42, offset, true); ch.set(nm, 46);
    locals.push(lh, f.data); centrals.push(ch);
    offset += lh.length + L;
  }
  const cdSize = centrals.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end], out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}
