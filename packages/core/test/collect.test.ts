import { describe, expect, it } from 'vitest';
import { crc32, hitsToMidi, wavBytes, zip, audacityLabels, type TakeHit } from '../src';

const hit = (t: number, note = 38, vel = 90, key = 'sn'): TakeHit => ({ t, note, vel, key, name: 'Snare', mapped: true, song: null });

describe('collect', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('zip from export opens with the standard layout', () => {
    const a = new TextEncoder().encode('hello');
    const z = zip([{ name: 'a.txt', data: a }]);
    expect(new DataView(z.buffer).getUint32(0, true)).toBe(0x04034b50);
  });
  it('wav header and length', () => {
    const w = wavBytes(new Float32Array([0, 1, -1, 0.5]), 44100);
    expect(new TextDecoder().decode(w.slice(0, 4))).toBe('RIFF');
    const v = new DataView(w.buffer);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(40, true)).toBe(8);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32767);
  });
  it('midi: header, tempo, note on/off in time order', () => {
    const m = hitsToMidi([hit(1), hit(0.5, 36, 100, 'bd')]);
    expect(new TextDecoder().decode(m.slice(0, 4))).toBe('MThd');
    const body = Array.from(m.slice(22));
    // first event after the tempo: delta 480 ticks (0.5 s), note-on ch10 note 36 vel 100
    const i = body.findIndex((x, k) => x === 0x99 && body[k + 1] === 36);
    expect(i).toBeGreaterThan(0);
    expect(body[i + 2]).toBe(100);
    expect(body.slice(-3)).toEqual([0xff, 0x2f, 0]);
    expect(body.filter((x) => x === 0x99).length).toBe(2);
  });
  it('audacity labels', () => {
    expect(audacityLabels([hit(1.5)])).toBe('1.5000\t1.5000\tsn 90\n');
    expect(audacityLabels([])).toBe('');
  });
});
