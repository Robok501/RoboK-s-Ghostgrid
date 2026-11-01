/** Standard MIDI File (type 0, drum channel 10) from an idea. */
import { INSTRUMENTS, barGrid, barSteps, type Idea } from '../groove';

export function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    let c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else { c -= 0; out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  }
  return new Uint8Array(out);
}

export function vlq(n: number): number[] {
  const b = [n & 127];
  while ((n >>= 7)) b.unshift((n & 127) | 128);
  return b;
}

export const PPQ = 480;

/** Velocities: accent 120, ghost 36, plain 92. Open hi-hat uses note 46. Swing shifts off-beat ticks. */
export function buildMidi(idea: Idea): Uint8Array {
  const ev: [number, number, number[]][] = [];
  idea.bars.forEach((bar, b) => {
    const g = barGrid(idea, b), n = barSteps(idea, b), tpS = PPQ / g;
    for (let s = 0; s < n; s++) for (const i of INSTRUMENTS) {
      const v = bar.n[i.id][s];
      if (!v) continue;
      const note = i.id === 'hh' && v === 3 ? i.midiAlt! : i.midi;
      const vel = v === 2 ? 120 : v === 3 && i.id === 'sn' ? 36 : 92;
      const sw = g !== 3 && s % 2 === 1 ? Math.round((tpS * idea.swing) / 100) : 0;
      const t = b * idea.beats * PPQ + Math.round(s * tpS) + sw;
      ev.push([t, 1, [0x99, note, vel]], [t + 60, 0, [0x89, note, 0]]);
    }
  });
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const us = Math.round(6e7 / idea.bpm), nm = utf8(idea.name || 'Groove');
  const tr: number[] = [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255, 0, 0xff, 0x58, 4, idea.beats, 2, 24, 8, 0, 0xff, 3, ...vlq(nm.length), ...nm];
  let last = 0;
  for (const [t, , bytes] of ev) { tr.push(...vlq(t - last), ...bytes); last = t; }
  const end = idea.bars.length * idea.beats * PPQ;
  tr.push(...vlq(Math.max(0, end - last)), 0xff, 0x2f, 0);
  const L = tr.length;
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255, 0x4d, 0x54, 0x72, 0x6b, (L >>> 24) & 255, (L >>> 16) & 255, (L >>> 8) & 255, L & 255, ...tr]);
}

export interface MidiNoteEvent { tick: number; on: boolean; channel: number; note: number; vel: number }
export interface MidiControlEvent { tick: number; channel: number; cc: number; value: number }
export interface MidiFile {
  ppq: number;
  /** first tempo in the file (µs per quarter note) */
  tempoUs: number;
  /** time signature (first one), default 4/4 */
  num: number;
  den: number;
  events: MidiNoteEvent[];
  controls: MidiControlEvent[];
}

/** Read a Standard MIDI File (type 0 or 1, any number of tracks). Events from all tracks are merged by tick. */
export function readMidi(data: Uint8Array): MidiFile {
  const u32 = (o: number) => ((data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3]) >>> 0;
  const tag = (o: number) => String.fromCharCode(data[o], data[o + 1], data[o + 2], data[o + 3]);
  if (data.length < 14 || tag(0) !== 'MThd') throw new Error('Not a MIDI file');
  const hlen = u32(4), ntr = (data[10] << 8) | data[11], div = (data[12] << 8) | data[13];
  if (div & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');
  const out: MidiFile = { ppq: div, tempoUs: 0, num: 4, den: 4, events: [], controls: [] };
  let p = 8 + hlen, sig = false;
  for (let t = 0; t < ntr && p + 8 <= data.length; t++) {
    const len = u32(p + 4), start = p + 8, end = Math.min(data.length, start + len);
    const isTrack = tag(p) === 'MTrk';
    p = start;
    if (!isTrack) { p = end; t--; continue; }
    let tick = 0, status = 0;
    const readVlq = () => { let v = 0, b: number; do { b = data[p++]; v = (v << 7) | (b & 127); } while (b & 128 && p < end); return v; };
    while (p < end) {
      tick += readVlq();
      let st = data[p];
      if (st & 0x80) p++; else st = status;
      if (st === 0xff) {
        const type = data[p++], l = readVlq();
        if (type === 0x51 && !out.tempoUs) out.tempoUs = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
        if (type === 0x58 && !sig) { out.num = data[p]; out.den = 2 ** data[p + 1]; sig = true; }
        p += l;
        if (type === 0x2f) break;
        continue;
      }
      if (st === 0xf0 || st === 0xf7) { p += readVlq(); continue; }
      status = st;
      const kind = st & 0xf0, ch = st & 0x0f;
      if (kind === 0xc0 || kind === 0xd0) { p += 1; continue; }
      const a = data[p++], b = data[p++];
      if (kind === 0x90 || kind === 0x80) out.events.push({ tick, on: kind === 0x90 && b > 0, channel: ch, note: a, vel: b });
      else if (kind === 0xb0) out.controls.push({ tick, channel: ch, cc: a, value: b });
    }
    p = end;
  }
  if (!out.tempoUs) out.tempoUs = 500000;
  out.events.sort((x, y) => x.tick - y.tick);
  out.controls.sort((x, y) => x.tick - y.tick);
  return out;
}
