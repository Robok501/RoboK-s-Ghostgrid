/** Big tempo display: − / + (hold to repeat), drag the number up or down, tap tempo and ±5. */
import React, { useRef } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { tempoMarking } from '@ghostgrid/core';
import { Btn, useHoldRepeat } from '../ui';
import { C, F } from '../theme';

export function TempoBlock({ bpm, shown, meter, disabled, onChange, onTap }: {
  bpm: number; shown: number; meter: string; disabled: boolean; onChange: (v: number) => void; onTap: (ms: number) => void;
}) {
  const live = useRef(bpm);
  live.current = bpm;
  const set = useRef((v: number) => {});
  set.current = (v: number) => onChange(Math.max(20, Math.min(300, Math.round(v))));
  const startBpm = useRef(bpm);
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => { startBpm.current = live.current; },
    onPanResponderMove: (_, g) => set.current(startBpm.current - g.dy / 4),
    onPanResponderTerminationRequest: () => false,
  })).current;
  const dn = useHoldRepeat(() => set.current(live.current - 1));
  const up = useHoldRepeat(() => set.current(live.current + 1));

  return (
    <View style={[s.wrap, disabled && { opacity: 0.45 }]} pointerEvents={disabled ? 'none' : 'auto'}>
      <View style={s.row}>
        <Pressable {...dn} style={s.round} accessibilityRole="button" accessibilityLabel="Slower"><Text style={s.roundTxt}>−</Text></Pressable>
        <View {...pan.panHandlers} style={s.numberBox} accessible accessibilityRole="adjustable" accessibilityLabel={`Tempo ${shown} BPM, drag up or down`}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => set.current(live.current + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}>
          <Text style={s.number} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{shown}</Text>
        </View>
        <Pressable {...up} style={s.round} accessibilityRole="button" accessibilityLabel="Faster"><Text style={s.roundTxt}>+</Text></Pressable>
      </View>
      <Text style={s.label}>BPM · <Text style={{ color: C.accent }}>{tempoMarking(shown).toUpperCase()}</Text> · {meter}</Text>
      <View style={s.quick}>
        <Pressable onPressIn={(e) => onTap(e.nativeEvent.timestamp)} accessibilityRole="button" accessibilityLabel="Tap tempo"
          style={({ pressed }) => [s.tap, pressed && { backgroundColor: C.accentSoft }]}>
          <Text style={s.tapTxt}>Tap tempo</Text>
        </Pressable>
        <Btn label="−5" onPress={() => set.current(live.current - 5)} />
        <Btn label="+5" onPress={() => set.current(live.current + 5)} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', justifyContent: 'space-between' },
  round: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  roundTxt: { color: C.fg, fontSize: 30, lineHeight: 34 },
  // the condensed display face has tall digits: give the line extra room so iOS doesn't clip their tops
  numberBox: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 140, paddingTop: 8, overflow: 'visible' },
  number: { color: C.fg, fontSize: 108, lineHeight: 136, paddingTop: 6, fontWeight: '800', fontVariant: ['tabular-nums'], fontFamily: F.display, includeFontPadding: false, textAlignVertical: 'center' },
  label: { color: C.muted, fontSize: 12, letterSpacing: 1.4 },
  quick: { flexDirection: 'row', gap: 8, marginTop: 8 },
  tap: { minHeight: 44, paddingHorizontal: 18, borderRadius: 12, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  tapTxt: { color: C.fg, fontSize: 15, fontWeight: '600' },
});
