import { describe, expect, it } from 'vitest';
import { BleClock, parseBleMidi } from '../src';

describe('BLE MIDI', () => {
  it('parses a single note on', () => {
    // header (ts high 1), timestamp low 5, note on ch10 note 38 vel 100
    expect(parseBleMidi([0x81, 0x85, 0x99, 38, 100])).toEqual([{ ts: (1 << 7) | 5, data: [0x99, 38, 100] }]);
  });
  it('parses two messages with their own timestamps', () => {
    const m = parseBleMidi([0x80, 0x90, 0x99, 36, 90, 0x92, 0x99, 42, 50]);
    expect(m.map((x) => [x.ts, ...x.data])).toEqual([[16, 0x99, 36, 90], [18, 0x99, 42, 50]]);
  });
  it('running status after a timestamp', () => {
    const m = parseBleMidi([0x80, 0x90, 0x99, 36, 90, 0x91, 38, 80]);
    expect(m.map((x) => x.data)).toEqual([[0x99, 36, 90], [0x99, 38, 80]]);
  });
  it('control change (hi-hat pedal) has two data bytes', () => {
    expect(parseBleMidi([0x80, 0x80, 0xb9, 4, 77])[0].data).toEqual([0xb9, 4, 77]);
  });
  it('ignores garbage', () => { expect(parseBleMidi([1, 2])).toEqual([]); expect(parseBleMidi([0x00, 0x80, 0x90])).toEqual([]); });
  it('clock removes arrival jitter and follows the wrap', () => {
    const c = new BleClock();
    const out = [] as number[];
    // device sends every 100 ms; arrival jitters by up to 40 ms
    const jit = [0, 30, 5, 40, 10, 25, 0, 35];
    for (let k = 0; k < jit.length; k++) out.push(c.map((8000 + k * 100) % 8192, 1000 + k * 100 + jit[k]));
    const steps = out.slice(1).map((v, i) => v - out[i]);
    steps.forEach((s) => expect(s).toBeCloseTo(100, 0));
  });
});
