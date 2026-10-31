import { describe, expect, it } from 'vitest';
import { engrave, scoreDocument } from '../src/engrave';
import { emptyBar, exampleIdea, newIdea, setNote, type Idea, type InstrumentId, type NoteState } from '../src/groove';

const count = (svg: string, needle: RegExp) => (svg.match(needle) || []).length;
function idea(grid: 2 | 3 | 4, notes: [InstrumentId, number, NoteState?][], beats = 4): Idea {
  const a: Idea = { ...newIdea(), grid, beats, bars: [emptyBar(beats * grid)] };
  for (const [i, s, v] of notes) a.bars[0].n[i][s] = v ?? 1;
  return a;
}

describe('layout', () => {
  it('fits bars per line by width and reports a box per bar', () => {
    const e = exampleIdea();
    const wide = engrave(e, { width: 900 }), narrow = engrave(e, { width: 380 });
    expect(wide.bars.length).toBe(2);
    expect(wide.bars[0].top).toBe(wide.bars[1].top); // one system
    expect(narrow.bars[1].top).toBeGreaterThan(narrow.bars[0].top); // two systems
    expect(narrow.height).toBeGreaterThan(wide.height);
  });
  it('highlights only the selected bar', () => {
    expect(count(engrave(exampleIdea(), { width: 900, selectedBar: 1 }).svg, /class="selr"/g)).toBe(1);
    expect(count(engrave(exampleIdea(), { width: 900 }).svg, /class="selr"/g)).toBe(0);
  });
});

describe('notation details', () => {
  it('draws whole-bar rests for empty voices', () => {
    const svg = engrave(idea(4, []), { width: 600 }).svg;
    expect(count(svg, /width="12" height="4.5"/g)).toBe(2);
  });
  it('rests: 8th and dotted-8th leading rests, quarter rest for an empty beat', () => {
    // beat 1: hi-hat + snare (no rest) · beat 2: snare on "&" (8th rest) · beat 3: snare on "a" (8th + 16th rest) · beat 4: empty
    const svg = engrave(idea(4, [['hh', 0], ['sn', 1], ['sn', 6], ['sn', 11]]), { width: 600 }).svg;
    expect(count(svg, /class="rest8"/g)).toBe(2);
    expect(count(svg, /class="rest16"/g)).toBe(1);
    expect(count(svg, /class="stk rq"/g)).toBe(1);
    expect(count(svg, /width="12" height="4.5"/g)).toBe(1); // feet voice empty → whole rest
  });
  it('rests: a 16th rest before "e"', () => {
    const svg = engrave(idea(4, [['hh', 1]]), { width: 600 }).svg;
    expect(count(svg, /class="rest16"/g)).toBe(1);
  });
  it('beams 16ths with a secondary beam and dots a dotted 8th', () => {
    const svg = engrave(idea(4, [['hh', 0], ['hh', 3]]), { width: 600 }).svg; // dotted 8th + 16th
    expect(count(svg, /class="ink dot"/g)).toBe(1);
    expect(count(svg, /width="7.6" height="4"/g)).toBe(1); // 16th stub
  });
  it('flags single off-beat notes', () => {
    const svg = engrave(idea(2, [['bd', 1]]), { width: 600 }).svg; // 8th rest + flagged 8th
    expect(count(svg, /class="ink flag"/g)).toBe(1);
  });
  it('marks accents, ghost notes, open hi-hat and crash ledger lines', () => {
    const svg = engrave(idea(4, [['hh', 0, 2], ['sn', 4, 3], ['hh', 8, 3], ['cr', 12]]), { width: 700 }).svg;
    expect(count(svg, /class="stk acc"/g)).toBe(1);
    expect(count(svg, /Q/g)).toBeGreaterThanOrEqual(2); // ghost brackets are curves
    expect(count(svg, /class="stk open"/g)).toBe(1);
    expect(svg).toMatch(/x1="[\d.]+" x2="[\d.]+" y1="56" y2="56"/); // ledger line at A5 (top 64 − 8)
  });
  it('numbers triplets', () => {
    const svg = engrave(idea(3, [['sn', 0], ['sn', 1], ['sn', 2]]), { width: 600 }).svg;
    expect(count(svg, /class="trip"/g)).toBe(1);
  });
  it('shows counting only when asked', () => {
    expect(engrave(exampleIdea(), { width: 900, count: true }).svg).toContain('>e<');
    expect(engrave(exampleIdea(), { width: 900, count: false }).svg).not.toContain('>e<');
  });
});

describe('export document', () => {
  it('is a self-styled SVG with title and tempo', () => {
    const doc = scoreDocument(setNote(newIdea('Fill <1>', 88), 0, 'sn', 0, 1));
    expect(doc.startsWith('<?xml')).toBe(true);
    expect(doc).toContain('Fill &lt;1&gt;');
    expect(doc).toContain('♩ = 88');
    expect(doc).toContain('<style>');
  });
});
