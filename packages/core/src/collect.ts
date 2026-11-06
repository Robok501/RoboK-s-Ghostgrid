/**
 * Data collection: packing a recorded take (mic audio + the e-drum hits that went with it) into files that the lab and
 * training scripts can use directly: a WAV, a MIDI file, Audacity labels and a JSON with the exact times, all in one zip.
 */

export interface TakeHit {
  /** seconds after the first audio sample of the take */
  t: number;
  note: number;
  vel: number;
  /** pad key as Ghostgrid knows it (bd, sn, hh, …) */
  key: string;
  name: string;
  mapped: boolean;
  /** position in the song (seconds) when the hit was played, or null when no song was playing */
  song: number | null;
}

const enc = new TextEncoder();

/** Mono 16-bit PCM WAV. */
export function wavBytes(samples: Float32Array, sampleRate: number): Uint8Array {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), d = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, Math.round(sampleRate), true);
  d.setUint32(28, Math.round(sampleRate) * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); str(36, 'data'); d.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) d.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return new Uint8Array(buf);
}

const vlq = (n: number): number[] => {
  const out = [n & 0x7f];
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
};

/** Standard MIDI file (format 0) of the hits on channel 10 with the pad's note numbers and velocities; 120 bpm, so 1 s = 960 ticks. */
export function hitsToMidi(hits: TakeHit[]): Uint8Array {
  const TPS = 960, OFF = Math.round(0.06 * TPS);
  const ev: { tick: number; order: number; bytes: number[] }[] = [];
  for (const h of hits) {
    const tick = Math.max(0, Math.round(h.t * TPS)), note = Math.max(0, Math.min(127, h.note)), vel = Math.max(1, Math.min(127, h.vel));
    ev.push({ tick, order: 1, bytes: [0x99, note, vel] }, { tick: tick + OFF, order: 0, bytes: [0x89, note, 0] });
  }
  ev.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track: number[] = [0, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20];
  let last = 0;
  for (const e of ev) { track.push(...vlq(e.tick - last), ...e.bytes); last = e.tick; }
  track.push(0, 0xff, 0x2f, 0);
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
  const len = track.length;
  return new Uint8Array([...head, 0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...track]);
}

/** Audacity label track (File ▸ Import ▸ Labels): one label per hit, with the pad name. */
export function audacityLabels(hits: TakeHit[]): string {
  return hits.map((h) => `${h.t.toFixed(4)}\t${h.t.toFixed(4)}\t${h.mapped ? h.key : `note${h.note}`} ${h.vel}`).join('\n') + (hits.length ? '\n' : '');
}
