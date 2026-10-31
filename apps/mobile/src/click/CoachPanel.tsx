/** Timing readout: big tap pad (or "play your kit"), last offset, a scale of recent hits, stats and per-pad breakdown. */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PAD_NAMES, timingStats, verdict, type HitLog, type PadKey } from '@ghostgrid/core';
import { C, F } from '../theme';
import type { CoachInput } from '../store';
import { CALIB_HITS } from './useClick';

const fmt = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)} ms`;
const RANGE = 50;

export function CoachPanel({ input, running, last, log, tol, calibrating, calibCount, micLevel, onTap }: {
  input: CoachInput; running: boolean; last: number | null; log: HitLog; tol: number;
  calibrating: CoachInput | null; calibCount: number; micLevel: number; onTap: (ms: number) => void;
}) {
  const all = timingStats(log.all, tol);
  const v = last === null ? null : verdict(last, tol);
  const big = calibrating ? `${calibCount}/${CALIB_HITS}` : last !== null ? (v === 'on' ? fmt(last) : `${Math.round(Math.abs(last))} ms ${v}`) : input === 'tap' ? 'Tap here' : input === 'mic' ? 'Listening' : 'Play your kit';
  const hint = calibrating ? 'Calibrating: hit right on the click'
    : !running ? 'Press Play first'
    : v === 'on' ? 'On the grid' : v === 'early' ? 'Rushing: lay back a little' : v === 'late' ? 'Dragging: push a little'
    : input === 'tap' ? 'Tap on every click' : input === 'mic' ? 'Play on your kit, the mic hears each hit' : 'Every pad hit is scored';
  const pos = (x: number) => 50 + (Math.max(-RANGE, Math.min(RANGE, x)) / RANGE) * 50;
  const pads = Object.entries(log.byPad).filter(([k]) => input === 'pads' && k !== 'tap' && k !== 'mic');

  const body = (
    <View style={s.padInner}>
      <Text style={[s.big, v === 'on' && { color: C.good }, v === 'early' && { color: C.early }, v === 'late' && { color: C.late }]}>{big}</Text>
      <Text style={s.hint}>{hint}</Text>
      {input === 'mic' && <View style={s.meter}><View style={[s.meterFill, { width: `${Math.min(100, Math.sqrt(micLevel / 0.6) * 100)}%` }]} /></View>}
    </View>
  );

  return (
    <View style={s.wrap}>
      {input === 'tap' ? (
        <Pressable onPressIn={(e) => onTap(e.nativeEvent.timestamp)} accessibilityRole="button" accessibilityLabel="Tap pad: tap on every click"
          style={({ pressed }) => [s.pad, pressed && s.padHit]}>{body}</Pressable>
      ) : (
        <View style={s.pad}>{body}</View>
      )}

      <View style={s.scale} accessibilityElementsHidden>
        <View style={s.axis} />
        <View style={[s.zone, { left: `${pos(-tol)}%`, width: `${pos(tol) - pos(-tol)}%` }]} />
        <View style={s.mid} />
        {log.all.map((x, i) => (
          <View key={i} style={[s.dot, i === log.all.length - 1 && s.dotLast, { left: `${pos(x)}%` }]} />
        ))}
        {[-50, -25, 25, 50].map((x) => <Text key={x} style={[s.tick, { left: `${pos(x)}%` }]}>{x > 0 ? '+' : ''}{x}</Text>)}
      </View>

      <View style={s.stats}>
        <Stat label="Score" value={all.n ? `${Math.round(all.score)}%` : '–'} />
        <Stat label="Average" value={all.n ? fmt(all.mean) : '–'} />
        <Stat label="Spread" value={all.n ? `±${Math.round(all.sd)} ms` : '–'} />
        <Stat label="Hits" value={String(all.n)} />
      </View>

      {pads.length > 0 && (
        <View style={s.byPad}>
          {pads.map(([k, offs]) => {
            const st = timingStats(offs, tol), vv = verdict(st.mean, tol);
            return (
              <View key={k} style={s.pp}>
                <Text style={s.ppName}>{PAD_NAMES[k as PadKey] ?? `Note ${k.slice(1)}`}</Text>
                <Text style={[s.ppVal, { color: vv === 'on' ? C.good : vv === 'early' ? C.early : C.late }]}>{fmt(st.mean)}</Text>
                <Text style={s.ppSub}>±{Math.round(st.sd)} ms · {st.n}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label.toUpperCase()}</Text>
      <Text style={s.statVal}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10 },
  pad: { minHeight: 150, borderRadius: 18, borderWidth: 2, borderStyle: 'dashed', borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', padding: 14 },
  padHit: { borderStyle: 'solid', borderColor: C.fg },
  padInner: { alignItems: 'center', gap: 4, alignSelf: 'stretch' },
  big: { color: C.fg, fontSize: 34, fontWeight: '600', fontFamily: F.mono, fontVariant: ['tabular-nums'] },
  hint: { color: C.muted, fontSize: 13, textAlign: 'center' },
  meter: { height: 8, alignSelf: 'stretch', marginHorizontal: 30, marginTop: 8, borderRadius: 4, backgroundColor: C.raised, overflow: 'hidden' },
  meterFill: { height: 8, backgroundColor: C.fg },
  scale: { height: 34, marginHorizontal: 10 },
  axis: { position: 'absolute', left: 0, right: 0, top: 14, height: 2, backgroundColor: C.line },
  zone: { position: 'absolute', top: 8, height: 14, borderRadius: 4, backgroundColor: C.accentSoft },
  mid: { position: 'absolute', left: '50%', top: 6, width: 2, height: 18, backgroundColor: C.fg },
  dot: { position: 'absolute', top: 10, width: 9, height: 9, marginLeft: -4.5, borderRadius: 5, backgroundColor: C.muted, opacity: 0.4 },
  dotLast: { top: 8, width: 13, height: 13, marginLeft: -6.5, borderRadius: 7, backgroundColor: C.fg, opacity: 1 },
  tick: { position: 'absolute', top: 22, width: 30, marginLeft: -15, textAlign: 'center', color: C.muted, fontSize: 10, fontFamily: F.mono },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10 },
  statLabel: { color: C.muted, fontSize: 10, letterSpacing: 1 },
  statVal: { color: C.fg, fontSize: 16, fontWeight: '600', fontFamily: F.mono },
  byPad: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pp: { minWidth: 104, flexGrow: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 8 },
  ppName: { color: C.fg, fontSize: 12, fontWeight: '600' },
  ppVal: { fontSize: 17, fontWeight: '600', fontFamily: F.mono },
  ppSub: { color: C.muted, fontSize: 11 },
});
