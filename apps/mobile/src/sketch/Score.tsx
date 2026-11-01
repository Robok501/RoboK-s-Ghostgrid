/** The drum score, drawn from the core engraver. Tap a bar to select it. */
import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { engrave, type Idea, type NotationStyle } from '@ghostgrid/core';
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

export function Score({ idea, width, style, count, selectedBar, playBar, onSelectBar }: {
  idea: Idea; width: number; style: NotationStyle; count: boolean;
  selectedBar: number | null; playBar?: number | null; onSelectBar?: (b: number) => void;
}) {
  const hl = playBar ?? selectedBar;
  const e = useMemo(() => engrave(idea, { width, count, style, selectedBar: hl }), [idea, width, count, style, hl]);
  const xml = useMemo(() => `<svg xmlns="http://www.w3.org/2000/svg" width="${e.width}" height="${e.height}" viewBox="0 0 ${e.width} ${e.height}">${themeSvg(e.svg)}</svg>`, [e]);
  return (
    <View style={{ width: e.width, height: e.height }}>
      <SvgXml xml={xml} width={e.width} height={e.height} />
      {onSelectBar && e.bars.map((b, i) => b && (
        <Pressable key={i} onPress={() => onSelectBar(i)} accessibilityRole="button" accessibilityLabel={`Bar ${i + 1}`}
          style={{ position: 'absolute', left: b.x0, top: b.top - 44, width: b.barW, height: b.h + 30 }} />
      ))}
    </View>
  );
}
