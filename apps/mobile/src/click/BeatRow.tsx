/** Beats of the bar, laid out in their groups (a line only breaks between groups). Tap a beat to change its accent. */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { autoGroups, groupsFor, type BeatUnit, type ClickStep, type Level } from '@ghostgrid/core';
import { C } from '../theme';

const LEVEL_NAME = ['muted', 'soft', 'normal', 'accent'];

export function BeatRow({ beats, unit, groups, levels, sub, cur, locked, onCycle }: {
  beats: number; unit: BeatUnit; groups: number[] | null; levels: Level[]; sub: number;
  cur: ClickStep | null; locked: boolean; onCycle: (i: number) => void;
}) {
  const shown = locked && cur ? cur.beats : beats;
  const lv: Level[] = locked && cur ? cur.levels : levels;
  const gs = locked ? autoGroups(shown, unit) : groupsFor(shown, unit, groups);
  let i = 0;
  return (
    <View style={s.wrap}>
      {gs.map((size, gi) => {
        const cells = [];
        for (let k = 0; k < size; k++, i++) {
          const b = i, level = lv[b] ?? 2;
          const on = cur?.beat === b;
          const flash = on && cur!.audible && level > 0;
          const mute = on && !cur!.audible;
          cells.push(
            <Pressable key={b} disabled={locked} onPress={() => onCycle(b)} accessibilityRole="button"
              accessibilityLabel={`Beat ${b + 1}, ${LEVEL_NAME[level]}`}
              style={[s.cell, level === 0 && s.cellMute, on && s.cellOn, flash && (level === 3 ? s.flashAcc : s.flash), mute && s.cellSilent]}>
              <Text style={[s.num, flash && (level === 3 ? s.numAcc : s.numOn)]}>{b + 1}</Text>
              <View style={s.bars}>
                {[1, 2, 3].map((n) => (
                  <View key={n} style={[s.bar, level >= n && (level === 3 ? s.barAcc : s.barOn), flash && { opacity: 0.6 }]} />
                ))}
              </View>
              {sub > 1 && (
                <View style={s.subs}>
                  {Array.from({ length: sub }, (_, d) => (
                    <View key={d} style={[s.dot, on && cur!.sub === d && cur!.audible && s.dotOn]} />
                  ))}
                </View>
              )}
            </Pressable>,
          );
        }
        return (
          <View key={gi} style={s.group}>
            <View style={s.cells}>{cells}</View>
            {gs.length > 1 && <View style={s.bracket} />}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 20, rowGap: 14 },
  group: { gap: 12 },
  cells: { flexDirection: 'row', gap: 6 },
  cell: { width: 52, height: 78, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, paddingBottom: 12 },
  cellMute: { borderStyle: 'dashed' },
  cellOn: { borderColor: C.fg, transform: [{ translateY: -2 }] },
  cellSilent: { backgroundColor: C.accentSoft },
  flash: { backgroundColor: C.fg, borderColor: C.fg },
  flashAcc: { backgroundColor: C.accent, borderColor: C.accent },
  num: { color: C.fg, fontSize: 22, fontWeight: '800' },
  numOn: { color: C.bg },
  numAcc: { color: C.accentInk },
  bars: { gap: 3, flexDirection: 'column-reverse' },
  bar: { width: 18, height: 4, borderRadius: 2, backgroundColor: C.line },
  barOn: { backgroundColor: C.fg },
  barAcc: { backgroundColor: C.accent },
  subs: { position: 'absolute', bottom: 3, flexDirection: 'row', gap: 3 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.line },
  dotOn: { backgroundColor: C.fg },
  bracket: { height: 7, marginHorizontal: 6, borderWidth: 2, borderTopWidth: 0, borderColor: C.muted, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, opacity: 0.5 },
});
