import { describe, expect, it } from 'vitest';
import { exampleIdea } from '../src/groove';
import { PPQ, buildMidi, readMidi, utf8 } from '../src/export/midi';
import { textTab } from '../src/export/texttab';
import { crc32, zip } from '../src/export/zip';

describe('MIDI', () => {
  const idea = exampleIdea();
  const m = readMidi(buildMidi(idea));
  it('writes header, tempo and one note-on per note on channel 10', () => {
    expect(m.ppq).toBe(PPQ);
    expect(Math.round(6e7 / m.tempoUs)).toBe(96);
    const ons = m.events.filter((e) => e.on);
    const notes = idea.bars.flatMap((b) => Object.values(b.n).flat()).filter((v) => v).length;
    expect(ons.length).toBe(notes);
    expect(ons.every((e) => e.channel === 9)).toBe(true);
  });
  it('uses GM drum notes, accent and ghost velocities, and the open hi-hat note', () => {
    const first = m.events.filter((e) => e.on && e.tick === 0).map((e) => [e.note, e.vel]);
    expect(first).toContainEqual([42, 120]); // accented hi-hat
    expect(first).toContainEqual([36, 92]); // kick
    const ghost = m.events.find((e) => e.on && e.note === 38 && e.vel === 36);
    expect(ghost?.tick).toBe(7 * (PPQ / 4));
  });
  it('shifts off-beats with swing', () => {
    const sw = readMidi(buildMidi({ ...idea, swing: 50 }));
    const ghost = sw.events.find((e) => e.on && e.note === 38 && e.vel === 36)!;
    expect(ghost.tick).toBe(7 * 120 + 60);
  });
  it('encodes names as UTF-8', () => expect(Array.from(utf8('é♩'))).toEqual([0xc3, 0xa9, 0xe2, 0x99, 0xa9]));
});

describe('ZIP', () => {
  it('computes CRC-32', () => expect(crc32(utf8('hello'))).toBe(0x3610a686));
  it('stores files with local headers, central directory and end record', () => {
    const z = zip([{ name: 'a.mid', data: new Uint8Array([1, 2, 3]) }, { name: 'b.txt', data: utf8('hi') }]);
    const dv = new DataView(z.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    expect(dv.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(dv.getUint16(z.length - 22 + 10, true)).toBe(2);
  });
});

describe('text tab', () => {
  it('lists used instruments with counts and symbols', () => {
    const t = textTab(exampleIdea());
    const lines = t.split('\n');
    expect(lines[0]).toBe('Example: rock groove + fill — 96 BPM, 4/4, 16ths');
    expect(lines.find((l) => l.startsWith('   |'))).toContain('1e&a2e&a');
    expect(lines.find((l) => l.startsWith('HH '))).toMatch(/^HH \|X-x-x-x-/);
    expect(lines.find((l) => l.startsWith('SN '))).toContain('g');
    expect(lines.find((l) => l.startsWith('CR '))).toBeUndefined();
  });
});
