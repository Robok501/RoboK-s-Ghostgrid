/** Bluetooth LE MIDI packets (the standard BLE-MIDI service): split a notification into MIDI messages with their device timestamps. */

export interface BleMidiMessage { /** milliseconds on the device's 13-bit clock (wraps at 8192) */ ts: number; data: number[] }

const dataLen = (status: number): number => {
  const k = status & 0xf0;
  if (k === 0xc0 || k === 0xd0) return 1;
  if (k >= 0x80 && k <= 0xe0) return 2;
  if (status === 0xf2) return 2;
  if (status === 0xf1 || status === 0xf3) return 1;
  return 0;
};

export function parseBleMidi(d: ArrayLike<number>): BleMidiMessage[] {
  const out: BleMidiMessage[] = [];
  if (d.length < 3 || !(d[0] & 0x80)) return out;
  const high = d[0] & 0x3f;
  let ts = high << 7;
  let running = 0, i = 1;
  while (i < d.length) {
    const b = d[i];
    if (b & 0x80) {
      // timestamp byte
      ts = (high << 7) | (b & 0x7f);
      i++;
      if (i >= d.length) break;
      if (d[i] & 0x80) { running = d[i]; i++; }
    }
    if (!running) { i++; continue; }
    if (running === 0xf0) { // sysex: skip to the end marker
      while (i < d.length && d[i] !== 0xf7) i++;
      i++; running = 0; continue;
    }
    const n = dataLen(running);
    if (running >= 0xf8 || n === 0) { out.push({ ts, data: [running] }); running = 0; continue; }
    const data: number[] = [running];
    while (data.length <= n && i < d.length && !(d[i] & 0x80)) data.push(d[i++]);
    if (data.length === n + 1) out.push({ ts, data });
    else break;
    if (running >= 0xf0) running = 0;
  }
  return out;
}

/**
 * Turns device timestamps into steady local times: the arrival of a notification is jittery (radio, phone busy), the
 * device's own timestamp is not. The offset between the two clocks is tracked as the smallest seen, with a slow drift allowance.
 */
export class BleClock {
  private last = -1; private wraps = 0; private offset = Infinity; private lastArrival = 0;
  /** `ts` device ms (13 bit), `arrival` local ms (performance.now style); returns local ms */
  map(ts: number, arrival: number): number {
    if (this.last >= 0 && ts < this.last - 4096) this.wraps++;
    this.last = ts;
    const dev = ts + this.wraps * 8192;
    const cand = arrival - dev;
    if (this.offset === Infinity) this.offset = cand;
    // a slow upward creep (1 ms per 10 s) so a drifting clock is followed
    else this.offset = Math.min(this.offset + Math.max(0, arrival - this.lastArrival) * 1e-4, cand);
    this.lastArrival = arrival;
    return dev + this.offset;
  }
  reset() { this.last = -1; this.wraps = 0; this.offset = Infinity; }
}
