/**
 * Timing coach, in one square. With an e-drum: a tile each for kick, snare and hi-hat, plus a tile for the whole kit.
 * Each pad tile is a moving timeline: hits slide in from the right, placed up (early) or down (late) from the
 * middle line; the shaded band is the window that counts as on time. The big number is the share of hits inside
 * that window, which says more than an average in ms. With the mic or tapping there is one timeline for all hits.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { timingStats, verdict, type HitLog } from '@ghostgrid/core';
import { C, F } from '../theme';
import type { CoachInput } from '../store';
import { CALIB_HITS } from './useClick';

/** how many seconds of hits a timeline shows */
const SPAN = 6;
/** the timeline's top and bottom edge, in ms early or late (more with a wide window) */
const RANGE_MIN = 60;
const GROUPS: { key: string; name: string; pads: string[] }[] = [
  { key: 'bd', name: 'Kick', pads: ['bd'] },
  { key: 'sn', name: 'Snare', pads: ['sn', 'rim'] },
  { key: 'hh', name: 'Hi-hat', pads: ['hh', 'hh+o', 'hf'] },
];
const colorOf = (pct: number | null) => (pct === null ? C.muted : pct >= 85 ? C.good : pct >= 60 ? C.accent : C.late);

export function CoachPanel({ input, running, log, tol, calibrating, calibCount, micLevel, onTap, onPlay, onReset }: {
  input: CoachInput; running: boolean; last?: number | null; log: HitLog; tol: number;
  calibrating: CoachInput | null; calibCount: number; micLevel: number; onTap: (ms: number) => void;
  /** a small Play / Stop inside the square (left out where Play sits right above it) */
  onPlay?: () => void;
  /** clear the scores and timelines (keeps playing) */
  onReset?: () => void;
}) {
  // the timelines move while playing
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now() / 1000), 80);
    return () => clearInterval(id);
  }, [running]);
  const t = running ? Math.max(now, log.events[log.events.length - 1]?.t ?? 0) : log.events[log.events.length - 1]?.t ?? now;

  const all = timingStats(log.all, tol);
  const lastEv = log.events[log.events.length - 1];
  const lastV = lastEv ? verdict(lastEv.off, tol) : null;
  const perPad = input === 'pads';
  const hint = calibrating ? `Calibrating ${calibCount}/${CALIB_HITS}: hit right on the click`
    : !running ? (onPlay ? (perPad ? 'Hit a pad or press Play' : input === 'tap' ? 'Tap here or press Play' : 'Press Play') : 'Press Play')
    : !all.n ? (input === 'tap' ? 'Tap on every click' : input === 'mic' ? 'Play: the mic hears each hit' : 'Play: every pad is scored')
    : lastV === 'on' ? 'On time' : lastV === 'early' ? 'Early: lay back a little' : 'Late: push a little';

  const overall = (
    <View style={[s.tile, perPad && s.tileHalf]}>
      <View style={s.tileHead}>
        <Text style={s.tileName}>{perPad ? 'Whole kit' : 'Your timing'}</Text>
        <View style={{ flex: 1 }} />
        {onReset && all.n > 0 && (
          <Pressable onPress={onReset} style={s.reset} accessibilityRole="button" accessibilityLabel="Reset scores" hitSlop={6}>
            <Text style={s.resetTxt}>↺</Text>
          </Pressable>
        )}
        {onPlay && (
          <Pressable onPress={onPlay} style={[s.play, running && s.playOn]} accessibilityRole="button" accessibilityLabel={running ? 'Stop' : 'Play'} hitSlop={6}>
            <Text style={[s.playTxt, running && { color: C.accentInk }]}>{running ? '■' : '▶'}</Text>
          </Pressable>
        )}
      </View>
      <Text style={[s.pct, { color: colorOf(all.n ? all.score : null) }]}>{all.n ? `${Math.round(all.score)}%` : '–'}</Text>
      <Text style={s.sub}>{all.n ? `${all.n} hits in the ±${tol} ms window` : `in the ±${tol} ms window`}</Text>
      {!!all.n && <Text style={s.sub}>{tendency(all.mean, all.sd, tol)}</Text>}
      {!perPad && <Lane events={log.events} t={t} tol={tol} tall />}
      {input === 'mic' && <View style={s.meter}><View style={[s.meterFill, { width: `${Math.min(100, Math.sqrt(micLevel / 0.6) * 100)}%` }]} /></View>}
    </View>
  );

  const body = (
    <View style={s.inner}>
      <Text style={[s.hint, lastV && running && all.n ? { color: lastV === 'on' ? C.good : lastV === 'early' ? C.early : C.late } : null]}>{hint}</Text>
      {perPad ? (
        <View style={s.grid}>
          {GROUPS.map((g) => {
            const ev = log.events.filter((e) => e.pad && g.pads.includes(e.pad));
            const offs = g.pads.flatMap((p) => log.byPad[p] ?? []);
            const st = timingStats(offs, tol);
            return (
              <View key={g.key} style={[s.tile, s.tileHalf]}>
                <View style={s.tileHead}>
                  <Text style={s.tileName}>{g.name}</Text>
                  <Text style={[s.tilePct, { color: colorOf(st.n ? st.score : null) }]}>{st.n ? `${Math.round(st.score)}%` : '–'}</Text>
                </View>
                <Lane events={ev} t={t} tol={tol} />
              </View>
            );
          })}
          {overall}
        </View>
      ) : overall}
    </View>
  );

  return input === 'tap' ? (
    <Pressable onPressIn={(e) => onTap(e.nativeEvent.timestamp)} accessibilityRole="button" accessibilityLabel="Tap pad: tap on every click"
      style={({ pressed }) => [s.pad, pressed && s.padHit]}>{body}</Pressable>
  ) : (
    <View style={s.pad}>{body}</View>
  );
}

/** One line of advice from the average and spread. */
function tendency(mean: number, sd: number, tol: number): string {
  const lean = Math.abs(mean) < tol / 3 ? 'centred' : mean < 0 ? `${Math.round(-mean)} ms early on average` : `${Math.round(mean)} ms late on average`;
  const steady = sd <= tol / 2 ? 'steady' : sd <= tol ? 'a bit uneven' : 'uneven';
  return `${lean}, ${steady}`;
}

/** A moving timeline: newest hits on the right, early above the line, late below; the band is the window. */
function Lane({ events, t, tol, tall }: { events: { t: number; off: number }[]; t: number; tol: number; tall?: boolean }) {
  // early at the top, late at the bottom; way off stays just inside the edge
  const RANGE = Math.max(RANGE_MIN, tol * 1.8);
  const y = (off: number) => 50 + (Math.max(-RANGE, Math.min(RANGE, off)) / RANGE) * 40;
  const band = (tol / RANGE) * 40;
  const shown = events.filter((e) => e.t > t - SPAN);
  return (
    <View style={[s.lane, tall && { height: 70 }]} accessibilityElementsHidden>
      <View style={[s.band, { top: `${50 - band}%`, height: `${2 * band}%` }]} />
      <View style={s.centre} />
      <Text style={[s.edge, { top: 1 }]}>early</Text>
      <Text style={[s.edge, { bottom: 1 }]}>late</Text>
      {shown.map((e, i) => {
        const v = verdict(e.off, tol), last = i === shown.length - 1;
        return (
          <View key={`${e.t}-${i}`} style={[s.dot, last && s.dotLast, {
            left: `${Math.max(0, Math.min(100, 100 - ((t - e.t) / SPAN) * 100))}%`, top: `${y(e.off)}%`,
            backgroundColor: v === 'on' ? C.good : v === 'early' ? C.early : C.late,
          }]} />
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  pad: { borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, padding: 10 },
  padHit: { borderColor: C.fg },
  inner: { gap: 8 },
  hint: { color: C.muted, fontSize: 13, textAlign: 'center', fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { backgroundColor: C.raised, borderRadius: 12, padding: 8, gap: 4 },
  tileHalf: { width: '48.5%', flexGrow: 1 },
  tileHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28 },
  tileName: { color: C.fg, fontSize: 13, fontWeight: '700' },
  tilePct: { fontSize: 18, fontWeight: '700', fontFamily: F.mono, fontVariant: ['tabular-nums'] },
  pct: { fontSize: 34, fontWeight: '700', fontFamily: F.mono, fontVariant: ['tabular-nums'], lineHeight: 40 },
  sub: { color: C.muted, fontSize: 11 },
  play: { width: 44, height: 32, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  playOn: { backgroundColor: C.fg },
  playTxt: { color: C.accentInk, fontSize: 14, fontWeight: '800' },
  reset: { width: 40, height: 32, borderRadius: 10, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  resetTxt: { color: C.fg, fontSize: 18, fontWeight: '700' },
  lane: { height: 58, borderRadius: 8, backgroundColor: C.surface, overflow: 'hidden' },
  band: { position: 'absolute', left: 0, right: 0, backgroundColor: C.accentSoft },
  centre: { position: 'absolute', left: 0, right: 0, top: '50%', height: 1, backgroundColor: C.muted, opacity: 0.6 },
  edge: { position: 'absolute', left: 4, color: C.muted, fontSize: 9, opacity: 0.7 },
  dot: { position: 'absolute', width: 8, height: 8, marginLeft: -8, marginTop: -4, borderRadius: 4, opacity: 0.75 },
  dotLast: { width: 12, height: 12, marginLeft: -12, marginTop: -6, borderRadius: 6, opacity: 1, borderWidth: 1.5, borderColor: C.fg },
  meter: { height: 6, alignSelf: 'stretch', marginTop: 4, borderRadius: 3, backgroundColor: C.surface, overflow: 'hidden' },
  meterFill: { height: 6, backgroundColor: C.fg },
});
