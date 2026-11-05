/** The drum score, drawn from the core engraver. Tap a bar to select it. */
import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { barSteps, engrave, type Idea, type NotationStyle } from '@ghostgrid/core';
import { C } from '../theme';

/** The engraver marks shapes with CSS classes; react-native-svg needs plain attributes. */
const CLASS_ATTRS: Record<string, string> = {
  ln: `stroke="${C.muted}" stroke-opacity="0.55" stroke-width="1"`,
  ink: `fill="${C.fg}"`,
  stk: `stroke="${C.fg}" fill="none" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"`,
  xh: 'stroke-width="1.7"',
  rq: 'stroke-width="2.3"',
  cnt: `fill="${C.muted}" font-size="10" font-weight="500"`,
  cntb: `fill="${C.fg}" font-size="11" font-weight="700"`,
  ts: `fill="${C.fg}" font-size="21" font-weight="800"`,
  trip: `fill="${C.fg}" font-size="11" font-style="italic" font-weight="600"`,
  bnum: `fill="${C.muted}" font-size="10" font-weight="600"`,
  selr: `fill="${C.accent}" fill-opacity="0.14"`,
  hitr: 'fill="none"',
};

const MARK_COLOR: Record<string, string> = { ok: C.good, early: C.early, late: C.late, missed: '#d0443a', weak: C.accent, loud: C.accent };

export function themeSvg(svg: string): string {
  return svg.replace(/class="([^"]+)"/g, (_, cls: string) => {
    const attrs: Record<string, string> = {};
    for (const c of cls.split(' ')) {
      const a = CLASS_ATTRS[c];
      if (!a) continue;
      for (const m of a.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
    }
    return Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
  });
}

export function Score({ idea, width, style, count, selectedBar, playBar, playStep, onSelectBar, from = 0, to, marks }: {
  idea: Idea; width: number; style: NotationStyle; count: boolean;
  selectedBar: number | null; playBar?: number | null; onSelectBar?: (b: number) => void;
  /** grid step playing inside `playBar`: draws the same moving line as the grid */
  playStep?: number | null;
  /** show only bars from … to (exclusive); numbers stay those of the whole idea */
  from?: number; to?: number;
  /** practice mode: how each note of the latest pass went, keyed `bar:step`, drawn as small dots under the staff */
  marks?: Record<string, string>;
}) {
  const end = Math.min(idea.bars.length, to ?? idea.bars.length);
  const part = useMemo(() => (from === 0 && end === idea.bars.length ? idea : { ...idea, bars: idea.bars.slice(from, end) }), [idea, from, end]);
  const rel = (b: number | null | undefined) => (b === null || b === undefined || b < from || b >= end ? null : b - from);
  const sel = rel(selectedBar);
  // the playing bar is marked with an overlay, so the score isn't re-drawn every bar during playback
  const e = useMemo(() => engrave(part, { width, count, style, selectedBar: sel, barOffset: from }), [part, width, count, style, sel, from]);
  const pr = rel(playBar);
  const pb = pr !== null ? e.bars[pr] : null;
  const xml = useMemo(() => `<svg xmlns="http://www.w3.org/2000/svg" width="${e.width}" height="${e.height}" viewBox="0 0 ${e.width} ${e.height}">${themeSvg(e.svg)}</svg>`, [e]);
  return (
    <View style={{ width: e.width, height: e.height }}>
      <SvgXml xml={xml} width={e.width} height={e.height} />
      {pb && <View pointerEvents="none" style={{ position: 'absolute', left: pb.x0, top: pb.top - 44, width: pb.barW, height: pb.h + 30, borderRadius: 8, backgroundColor: C.accentSoft }} />}
      {pb && playStep !== null && playStep !== undefined && (
        <View pointerEvents="none" style={{ position: 'absolute', left: pb.x0 + 10 + pb.slotW * playStep, top: pb.top - 30, width: pb.slotW, height: pb.h + 10, borderRadius: 4, backgroundColor: C.accent, opacity: 0.35 }} />
      )}
      {marks && e.bars.map((bx, i) => bx && Array.from({ length: barSteps(idea, i + from) }, (_, st) => {
        const v = marks[`${i + from}:${st}`];
        return v ? <View key={`${i}:${st}`} pointerEvents="none" style={{ position: 'absolute', left: bx.x0 + 10 + bx.slotW * (st + 0.5) - 4, top: bx.top + 70, width: 8, height: 8, borderRadius: 4, backgroundColor: MARK_COLOR[v] ?? C.muted }} /> : null;
      }))}
      {onSelectBar && e.bars.map((b, i) => b && (
        <Pressable key={i} onPress={() => onSelectBar(i + from)} accessibilityRole="button" accessibilityLabel={`Bar ${i + 1 + from}`}
          style={{ position: 'absolute', left: b.x0, top: b.top - 44, width: b.barW, height: b.h + 30 }} />
      ))}
    </View>
  );
}
