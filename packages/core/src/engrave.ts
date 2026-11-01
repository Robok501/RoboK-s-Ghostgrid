/**
 * Drum notation engraver: lays out an idea as SVG on a five-line percussion staff.
 * Two voices (hands with stems up, feet with stems down), beams per beat, 16th stubs, dotted notes,
 * rests, triplet numbers, ledger lines, ghost-note brackets, accents and open hi-hat marks.
 * Output uses CSS classes (ln, ink, stk, …) so the host app styles it for its theme.
 */
import { INSTRUMENTS, barGrid, barSteps, countLabel, type Idea, type Instrument, type NoteState } from './groove';
import { DEFAULT_STYLE, type NotationStyle, type StaffPlace } from './notation';

export interface EngraveOptions {
  /** available width in px */
  width: number;
  /** bar highlighted as selected, or null */
  selectedBar?: number | null;
  /** count labels (1 e & a) under the staff */
  count?: boolean;
  /** staff positions, noteheads and voices */
  style?: NotationStyle;
}
export interface BarBox { x0: number; barW: number; top: number; slotW: number; h: number }
export interface Engraving { svg: string; width: number; height: number; bars: BarBox[] }

const SP = 8; // space between staff lines
const r1 = (v: number) => Math.round(v * 10) / 10;
let STYLE: NotationStyle = DEFAULT_STYLE;
const P = (i: Instrument): StaffPlace => STYLE.map[i.id];
const isUp = (i: Instrument) => STYLE.voices === 1 || i.up;

export function engrave(idea: Idea, opts: EngraveOptions): Engraving {
  STYLE = opts.style ?? DEFAULT_STYLE;
  const W = opts.width, nb = idea.bars.length, count = opts.count ?? true;
  const lead = 48, lead2 = 30;
  const minBar = Math.max(...idea.bars.map((_, b) => { const g = barGrid(idea, b); return barSteps(idea, b) * (g === 4 ? 19 : g === 3 ? 26 : 30); })) + 20;
  let bpl = Math.max(1, Math.min(4, Math.floor((W - lead) / minBar)));
  const lines = Math.ceil(nb / bpl);
  bpl = Math.ceil(nb / lines);
  const sysH = count ? 174 : 146, H = lines * sysH + 6;
  let o = '';
  const bars: BarBox[] = [];
  for (let L = 0; L < lines; L++) {
    const top = 12 + L * sysH + 52, Y = (st: number) => top + ((8 - st) * SP) / 2, ld = L === 0 ? lead : lead2;
    const first = L * bpl, last = Math.min(nb, first + bpl) - 1, barW = (W - ld - 4) / bpl, xEnd = ld + barW * (last - first + 1);
    for (let b = first; b <= last; b++) {
      const x0 = ld + (b - first) * barW;
      if (b === opts.selectedBar) o += `<rect class="selr" x="${r1(x0)}" y="${top - 44}" width="${r1(barW)}" height="${sysH - 14}" rx="8"/>`;
    }
    for (let k = 0; k < 5; k++) o += `<line class="ln" x1="4" x2="${r1(xEnd)}" y1="${top + k * SP}" y2="${top + k * SP}"/>`;
    o += `<rect class="ink" x="10" y="${Y(6) + 1}" width="3.4" height="${SP * 1.75}"/><rect class="ink" x="16.5" y="${Y(6) + 1}" width="3.4" height="${SP * 1.75}"/>`;
    if (L === 0) o += `<text class="ts" x="35" y="${Y(6) + 7}" text-anchor="middle">${idea.beats}</text><text class="ts" x="35" y="${Y(2) + 7}" text-anchor="middle">4</text>`;
    o += `<line class="stk" x1="4" x2="4" y1="${top}" y2="${top + 4 * SP}"/>`;
    for (let b = first; b <= last; b++) {
      const x0 = ld + (b - first) * barW, xb = x0 + barW;
      o += `<text class="bnum" x="${r1(x0 + 4)}" y="${top - 34}">${b + 1}</text>`;
      o += engraveBar(idea, b, x0, barW, top, count);
      if (b === nb - 1) o += `<line class="stk" x1="${r1(xb - 6)}" x2="${r1(xb - 6)}" y1="${top}" y2="${top + 4 * SP}"/><rect class="ink" x="${r1(xb - 3.5)}" y="${top}" width="3.5" height="${4 * SP}"/>`;
      else o += `<line class="stk" x1="${r1(xb)}" x2="${r1(xb)}" y1="${top}" y2="${top + 4 * SP}"/>`;
      bars[b] = { x0, barW, top, slotW: (barW - 16) / barSteps(idea, b), h: sysH - 26 };
      o += `<rect class="hitr" data-bar="${b}" x="${r1(x0)}" y="${top - 44}" width="${r1(barW)}" height="${sysH - 14}"/>`;
    }
  }
  return { svg: o, width: W, height: H, bars };
}

interface Head { i: Instrument; v: NoteState }
interface Note { s: number; v: number; x: number; hs: Head[]; yTop: number; yBot: number }

function engraveBar(idea: Idea, b: number, x0: number, barW: number, top: number, count: boolean): string {
  const bar = idea.bars[b], g = barGrid(idea, b), n = barSteps(idea, b), Y = (st: number) => top + ((8 - st) * SP) / 2;
  const slotW = (barW - 16) / n, X = (s: number) => x0 + 10 + slotW * (s + 0.5);
  let o = '';
  if (count) for (let s = 0; s < n; s++) o += `<text class="${s % g ? 'cnt' : 'cntb'}" x="${r1(X(s))}" y="${top + 32 + 60}" text-anchor="middle">${countLabel(s, g)}</text>`;
  for (const up of STYLE.voices === 1 ? [true] : [true, false]) {
    const ins = INSTRUMENTS.filter((i) => isUp(i) === up), has = (s: number) => ins.some((i) => bar.n[i.id][s] > 0);
    const restY = up ? Y(7) : Y(0.5);
    const all = Array.from({ length: n }, (_, s) => s);
    if (!all.some(has)) {
      const cx = x0 + barW / 2 - 4;
      o += `<rect class="ink" x="${r1(cx - 6)}" y="${up ? Y(6) : Y(2)}" width="12" height="4.5"/>`;
      continue;
    }
    for (let bt = 0; bt < idea.beats; bt++) {
      const base = bt * g, on = all.slice(base, base + g).filter(has);
      if (!on.length) { o += rest('q', X(base) + (slotW * (g - 1)) / 2, restY); continue; }
      const r = on[0] - base;
      if (r > 0) {
        if (g === 4) {
          if (r === 1) o += rest('s', X(base), restY);
          if (r === 2) o += rest('e', X(base) + slotW / 2, restY);
          if (r === 3) { o += rest('e', X(base) + slotW / 2, restY); o += rest('s', X(base + 2), restY); }
        }
        if (g === 2) o += rest('e', X(base), restY);
        if (g === 3) o += r === 1 ? rest('e', X(base), restY) : rest('q', X(base) + slotW / 2, restY);
      }
      const notes: Note[] = on.map((s, k) => {
        const d = (k < on.length - 1 ? on[k + 1] : base + g) - s;
        const v = g === 4 ? d : g === 2 ? 2 * d : d === 1 ? 2 : 4;
        const hs = ins.filter((i) => bar.n[i.id][s] > 0).map((i) => ({ i, v: bar.n[i.id][s] }));
        const ys = hs.map((h) => Y(P(h.i).step));
        return { s, v, x: X(s), hs, yTop: Math.min(...ys), yBot: Math.max(...ys) };
      });
      const tuplet = g === 3 && !(notes.length === 1 && notes[0].s === base);
      for (const nt of notes) o += heads(nt, up, Y, top);
      const beam = notes.length > 1 && notes.every((nt) => nt.v < 4);
      const stemLen = 3.5 * SP, sx = (nt: Note) => (up ? nt.x + 4.8 : nt.x - 4.8);
      if (beam) {
        const ey = up ? Math.min(...notes.map((nt) => nt.yTop)) - stemLen : Math.max(...notes.map((nt) => nt.yBot)) + stemLen;
        for (const nt of notes) o += `<line class="stk" x1="${r1(sx(nt))}" x2="${r1(sx(nt))}" y1="${up ? nt.yBot : nt.yTop}" y2="${ey}"/>`;
        const x1 = sx(notes[0]), x2 = sx(notes[notes.length - 1]);
        o += `<rect class="ink" x="${r1(x1 - 0.6)}" y="${up ? ey : ey - 4}" width="${r1(x2 - x1 + 1.2)}" height="4"/>`;
        const y2 = up ? ey + 6 : ey - 10;
        notes.forEach((nt, k) => {
          if (nt.v !== 1) return;
          const nx = notes[k + 1], pv = notes[k - 1];
          if (nx && nx.v === 1) o += `<rect class="ink" x="${r1(sx(nt) - 0.6)}" y="${y2}" width="${r1(sx(nx) - sx(nt) + 1.2)}" height="4"/>`;
          else if (!(pv && pv.v === 1)) {
            const to = nx ? sx(nt) + 7 : sx(nt) - 7;
            o += `<rect class="ink" x="${r1(Math.min(sx(nt), to) - 0.6)}" y="${y2}" width="7.6" height="4"/>`;
          }
        });
        if (tuplet) o += `<text class="trip" x="${r1((x1 + x2) / 2)}" y="${up ? ey - 5 : ey + 12}" text-anchor="middle">3</text>`;
      } else {
        let tipY: number | null = null;
        for (const nt of notes) {
          const ey = up ? nt.yTop - stemLen : nt.yBot + stemLen;
          o += `<line class="stk" x1="${r1(sx(nt))}" x2="${r1(sx(nt))}" y1="${up ? nt.yBot : nt.yTop}" y2="${ey}"/>`;
          const fl = nt.v === 1 ? 2 : nt.v === 2 || nt.v === 3 ? 1 : 0;
          for (let f = 0; f < fl; f++) o += flag(sx(nt), ey, up, f);
          tipY = tipY === null ? ey : up ? Math.min(tipY, ey) : Math.max(tipY, ey);
        }
        if (tuplet && tipY !== null) {
          const xa = notes[0].x, xb2 = X(base + g - 1);
          o += `<text class="trip" x="${r1((xa + xb2) / 2)}" y="${up ? tipY - 5 : tipY + 12}" text-anchor="middle">3</text>`;
        }
      }
    }
  }
  return o;
}

function heads(nt: Note, up: boolean, Y: (st: number) => number, top: number): string {
  let o = '';
  const hs = nt.hs.slice().sort((a, b) => P(a.i).step - P(b.i).step);
  let prev = -99, prevD = false;
  for (const h of hs) {
    const st = P(h.i).step, y = Y(st);
    let x = nt.x, d = false;
    // a second (adjacent staff steps) puts the upper head on the other side of the stem
    if (st - prev === 1 && !prevD) { d = true; x += up ? 9.6 : -9.6; }
    prev = st; prevD = d;
    for (let l = -2; l >= st; l -= 2) o += `<line class="stk" x1="${r1(x - 8)}" x2="${r1(x + 8)}" y1="${Y(l)}" y2="${Y(l)}"/>`;
    for (let l = 10; l <= st; l += 2) o += `<line class="stk" x1="${r1(x - 8)}" x2="${r1(x + 8)}" y1="${Y(l)}" y2="${Y(l)}"/>`;
    if (P(h.i).head === 'x') o += `<path class="stk xh" d="M${r1(x - 4.4)} ${r1(y - 3.9)}L${r1(x + 4.4)} ${r1(y + 3.9)}M${r1(x - 4.4)} ${r1(y + 3.9)}L${r1(x + 4.4)} ${r1(y - 3.9)}"/>`;
    else o += `<ellipse class="ink" cx="${r1(x)}" cy="${y}" rx="5" ry="3.7" transform="rotate(-20 ${r1(x)} ${y})"/>`;
    if (h.v === 3 && h.i.alt === 'ghost') o += `<path class="stk" d="M${r1(x - 8)} ${y - 5}Q${r1(x - 11.5)} ${y} ${r1(x - 8)} ${y + 5}M${r1(x + 8)} ${y - 5}Q${r1(x + 11.5)} ${y} ${r1(x + 8)} ${y + 5}"/>`;
    const my = up ? top - 44 : top + 70;
    if (h.v === 2) o += `<path class="stk acc" d="M${r1(nt.x - 5)} ${my - 3.5}L${r1(nt.x + 5)} ${my}L${r1(nt.x - 5)} ${my + 3.5}"/>`;
    if (h.v === 3 && h.i.alt === 'open') o += `<circle class="stk open" cx="${r1(nt.x)}" cy="${my}" r="3.3"/>`;
    if (nt.v === 3) o += `<circle class="ink dot" cx="${r1(x + (up ? 10 : 8))}" cy="${st % 2 === 0 ? y - SP / 2 : y}" r="1.7"/>`;
  }
  return o;
}

function flag(sx: number, ey: number, up: boolean, f: number): string {
  const y = up ? ey + f * 6 : ey - f * 6, s = up ? 1 : -1;
  return `<path class="ink flag" d="M${r1(sx)} ${y}C${r1(sx + 1)} ${y + 6 * s} ${r1(sx + 9)} ${y + 8 * s} ${r1(sx + 6)} ${y + 17 * s}C${r1(sx + 7)} ${y + 10 * s} ${r1(sx + 2)} ${y + 9 * s} ${r1(sx)} ${y + 8 * s}Z"/>`;
}

function rest(kind: 'q' | 'e' | 's', x: number, cy: number): string {
  x = r1(x);
  if (kind === 'q') return `<path class="stk rq" d="M${r1(x - 2)} ${cy - 11}L${r1(x + 3)} ${cy - 5}L${r1(x - 2)} ${cy + 1}L${r1(x + 3)} ${cy + 6}Q${r1(x - 4)} ${cy + 5} ${r1(x + 1)} ${cy + 11}"/>`;
  if (kind === 'e') return `<g class="rest8"><circle class="ink" cx="${r1(x - 2.5)}" cy="${cy - 4}" r="2.3"/><path class="stk" d="M${r1(x - 2.5)} ${cy - 2.5}Q${r1(x + 1)} ${cy - 1} ${r1(x + 3.5)} ${cy - 5}L${r1(x - 1)} ${cy + 8}"/></g>`;
  return `<g class="rest16"><circle class="ink" cx="${r1(x - 1.5)}" cy="${cy - 6}" r="2.1"/><circle class="ink" cx="${r1(x - 3.5)}" cy="${cy}" r="2.1"/><path class="stk" d="M${r1(x - 1.5)} ${cy - 4.5}Q${r1(x + 2)} ${cy - 3} ${r1(x + 4.5)} ${cy - 7}L${r1(x - 1.5)} ${cy + 10}M${r1(x - 3.5)} ${cy + 1.5}Q${r1(x)} ${cy + 3} ${r1(x + 2.4)} ${cy - 1}"/></g>`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A complete, self-styled SVG document (black on white) for export or printing. */
export function scoreDocument(idea: Idea, width = 900, count = true, style?: NotationStyle): string {
  const e = engrave(idea, { width, count, selectedBar: null, style });
  const swing = idea.swing && idea.grid !== 3 ? ` · swing ${idea.swing}%` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -40 ${e.width} ${e.height + 40}" width="${e.width}" height="${e.height + 40}"><style>.ln{stroke:#111;stroke-width:1;opacity:.5}.ink{fill:#111}.stk{stroke:#111;fill:none;stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}.xh{stroke-width:1.7}.rq{stroke-width:2.3}.cnt{fill:#666;font:500 10px Helvetica,Arial,sans-serif}.cntb{fill:#111;font:700 11px Helvetica,Arial,sans-serif}.ts{fill:#111;font:800 21px "Arial Narrow",Arial,sans-serif}.trip{fill:#111;font:italic 600 11px Helvetica,Arial,sans-serif}.bnum{fill:#666;font:600 10px monospace}.selr,.hitr{display:none}.ttl{fill:#111;font:700 16px Helvetica,Arial,sans-serif}.sub{fill:#666;font:400 11px Helvetica,Arial,sans-serif}</style><rect x="0" y="-40" width="${e.width}" height="${e.height + 40}" fill="#fff"/><text class="ttl" x="6" y="-16">${esc(idea.name)}</text><text class="sub" x="${e.width - 6}" y="-16" text-anchor="end">♩ = ${idea.bpm}${swing}</text>${e.svg}</svg>`;
}
