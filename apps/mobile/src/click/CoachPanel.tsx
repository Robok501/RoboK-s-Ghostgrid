/**
 * Timing coach, in one square. With an e-drum: a needle meter each for kick, snare and hi-hat, plus one for the whole kit.
 * The needle swings left when a hit is early and right when it is late, the green part of the rim is the window that
 * counts as on time, and the dots on the rim remember the hits before. The big number is the share of hits inside
 * that window, which says more than an average in ms. With the mic or tapping there is one meter for all hits.
 * In Songs the coach can instead show the drift line: the average timing of each bar, through the whole song.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Polygon, Polyline } from 'react-native-svg';
import { barDrift, correctedScore, timingStats, verdict, type HitLog } from '@ghostgrid/core';
import { C, F } from '../theme';
import type { CoachInput } from '../store';
import { CALIB_HITS } from './useClick';
import { t, t as tr } from '../i18n';

/** the meter's left and right end, in ms early or late (more with a wide window) */
const RANGE_MIN = 60;
const GROUPS: { key: string; name: string; pads: string[] }[] = [
  { key: 'bd', name: 'Kick', pads: ['bd'] },
  { key: 'sn', name: 'Snare', pads: ['sn', 'rim'] },
  { key: 'hh', name: 'Hi-hat', pads: ['hh', 'hh+o', 'hf'] },
];
const colorOf = (pct: number | null) => (pct === null ? C.muted : pct >= 85 ? C.good : pct >= 60 ? C.accent : C.late);

export function CoachPanel({ input, running, log, tol, calibrating, calibCount, micLevel, onTap, onPlay, onReset, view = 'needles', totalBars = 0 }: {
  input: CoachInput; running: boolean; last?: number | null; log: HitLog; tol: number;
  calibrating: CoachInput | null; calibCount: number; micLevel: number; onTap: (ms: number) => void;
  /** a small Play / Stop inside the square (left out where Play sits right above it) */
  onPlay?: () => void;
  /** clear the scores and timelines (keeps playing) */
  onReset?: () => void;
  /** 'drift': the average timing of each bar through the song (needs hits that know their bar, so only in Songs) */
  view?: 'needles' | 'drift';
  /** bars in the song, so the drift line has its full width from the start and fills in while you play */
  totalBars?: number;
}) {

  const all = timingStats(log.all, tol);
  const fixed = correctedScore(log.all, tol);
  const lastEv = log.events[log.events.length - 1];
  const lastV = lastEv ? verdict(lastEv.off, tol) : null;
  const drift = view === 'drift' && totalBars > 1;
  const perPad = input === 'pads' && !drift;
  const hint = calibrating ? t('Calibrating {{n}}/{{of}}: hit right on the click', { n: calibCount, of: CALIB_HITS })
    : t(!running ? (onPlay ? (perPad ? 'Hit a pad or press Play' : input === 'tap' ? 'Tap here or press Play' : 'Press Play') : 'Press Play')
      : !all.n ? (input === 'tap' ? 'Tap on every click' : input === 'mic' ? 'Play: the mic hears each hit' : 'Play: every pad is scored')
      : lastV === 'on' ? 'On time' : lastV === 'early' ? 'Early: lay back a little' : 'Late: push a little');

  const overall = (
    <View style={[s.tile, perPad && s.tileHalf]}>
      <View style={s.tileHead}>
        <Text style={s.tileName}>{t(perPad ? 'Whole kit' : 'Your timing')}</Text>
        <View style={{ flex: 1 }} />
        {onReset && all.n > 0 && (
          <Pressable onPress={onReset} style={s.reset} accessibilityRole="button" accessibilityLabel={t('Reset scores')} hitSlop={6}>
            <Text style={s.resetTxt}>↺</Text>
          </Pressable>
        )}
        {onPlay && (
          <Pressable onPress={onPlay} style={[s.play, running && s.playOn]} accessibilityRole="button" accessibilityLabel={t(running ? 'Stop' : 'Play')} hitSlop={6}>
            <Text style={[s.playTxt, running && { color: C.accentInk }]}>{running ? '■' : '▶'}</Text>
          </Pressable>
        )}
      </View>
      <Text style={[s.pct, { color: colorOf(all.n ? all.score : null) }]}>{all.n ? `${Math.round(all.score)}%` : '–'}</Text>
      <Text style={s.sub}>{all.n ? t('{{count}} hits in the ±{{tol}} ms window', { count: all.n, tol }) : t('in the ±{{tol}} ms window', { tol })}</Text>
      {!!all.n && <Text style={s.sub}>{tendency(all.mean, all.sd, tol)}</Text>}
      {!!all.n && Math.abs(all.mean) >= tol / 3 && fixed - all.score >= 8 && (
        <Text style={s.sub}>{t('Without your average lean of {{lean}} ms you would score {{pct}}%', { lean: `${all.mean > 0 ? '+' : '−'}${Math.round(Math.abs(all.mean))}`, pct: Math.round(fixed) })}</Text>
      )}
      {log.offGrid > 0 && <Text style={s.sub}>{t('{{n}} hits between the grid points (not scored)', { n: log.offGrid })}</Text>}
      {drift ? <DriftLine events={log.events} tol={tol} totalBars={totalBars} /> : !perPad && <Gauge events={log.events} tol={tol} />}
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
                  <Text style={s.tileName}>{t(g.name)}</Text>
                  <Text style={[s.tilePct, { color: colorOf(st.n ? st.score : null) }]}>{st.n ? `${Math.round(st.score)}%` : '–'}</Text>
                </View>
                <Gauge events={ev} tol={tol} />
                {(() => {
                  const m = g.pads.map((p) => log.padMean(p)).filter((x): x is number => x !== null);
                  if (!m.length) return null;
                  const avg = m.reduce((a, b) => a + b, 0) / m.length;
                  return <Text style={s.sub}>{t('Average {{ms}} ms', { ms: `${avg > 0 ? '+' : avg < 0 ? '−' : ''}${Math.round(Math.abs(avg))}` })}</Text>;
                })()}
              </View>
            );
          })}
          {overall}
        </View>
      ) : overall}
    </View>
  );

  return input === 'tap' ? (
    <Pressable onPressIn={(e) => onTap(e.nativeEvent.timestamp)} accessibilityRole="button" accessibilityLabel={t('Tap pad: tap on every click')}
      style={({ pressed }) => [s.pad, pressed && s.padHit]}>{body}</Pressable>
  ) : (
    <View style={s.pad}>{body}</View>
  );
}

/** One line of advice from the average and spread. */
function tendency(mean: number, sd: number, tol: number): string {
  const lean = Math.abs(mean) < tol / 3 ? t('centred') : mean < 0 ? t('{{ms}} ms early on average', { ms: Math.round(-mean) }) : t('{{ms}} ms late on average', { ms: Math.round(mean) });
  const steady = t(sd <= tol / 2 ? 'steady' : sd <= tol ? 'a bit uneven' : 'uneven');
  return `${lean}, ${steady}`;
}

const pt = (deg: number, r: number) => ({ x: 70 + r * Math.sin((deg * Math.PI) / 180), y: 72 - r * Math.cos((deg * Math.PI) / 180) });
const arc = (from: number, to: number, r = 56) => { const a = pt(from, r), b = pt(to, r); return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} A${r} ${r} 0 0 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`; };
const hitColor = (off: number, tol: number) => { const v = verdict(off, tol); return v === 'on' ? C.good : v === 'early' ? C.early : C.late; };

/** A needle meter: blue left (early), green middle (on time), orange right (late). The needle is the last hit, the dots the six before. */
function Gauge({ events, tol }: { events: { off: number }[]; tol: number }) {
  const RANGE = Math.max(RANGE_MIN, tol * 1.8);
  const ang = (off: number) => (Math.max(-RANGE, Math.min(RANGE, off)) / RANGE) * 90;
  const zone = (tol / RANGE) * 90;
  const last = events[events.length - 1];
  const tip = last ? pt(ang(last.off), 46) : null;
  const trail = events.slice(-7, -1);
  return (
    <View style={{ alignItems: 'center' }} accessibilityElementsHidden>
      <Svg width="100%" height={84} viewBox="0 0 140 84">
        <Path d={arc(-90, -zone)} stroke={C.early} strokeWidth={9} fill="none" />
        <Path d={arc(-zone, zone)} stroke={C.good} strokeWidth={9} fill="none" />
        <Path d={arc(zone, 90)} stroke={C.late} strokeWidth={9} fill="none" />
        {trail.map((e, i) => { const p = pt(ang(e.off), 65); return <Circle key={i} cx={p.x} cy={p.y} r={2.5} fill={hitColor(e.off, tol)} opacity={0.35 + (i / trail.length) * 0.4} />; })}
        {tip && <Line x1={70} y1={72} x2={tip.x} y2={tip.y} stroke={C.fg} strokeWidth={3} strokeLinecap="round" />}
        <Circle cx={70} cy={72} r={5} fill={last ? C.fg : C.muted} />
      </Svg>
      <View style={s.gaugeEnds}><Text style={s.edge}>{tr('early')}</Text><Text style={s.edge}>{tr('late')}</Text></View>
      <Text style={[s.gaugeMs, { color: last ? hitColor(last.off, tol) : C.muted }]}>{last ? `${last.off > 0 ? '+' : last.off < 0 ? '−' : ''}${Math.abs(Math.round(last.off))} ms` : '–'}</Text>
    </View>
  );
}

/** The average timing of each bar as a line through the song, with a ribbon for how scattered the bar was. Fills in while you play. */
function DriftLine({ events, tol, totalBars }: { events: { off: number; bar?: number }[]; tol: number; totalBars: number }) {
  const W = 300, H = 150, X0 = 8, RANGE = Math.max(RANGE_MIN, tol * 1.8), mid = H / 2;
  const x = (bar: number) => X0 + ((bar - 1) / Math.max(1, totalBars - 1)) * (W - 2 * X0);
  const y = (ms: number) => mid + (Math.max(-RANGE, Math.min(RANGE, ms)) / RANGE) * (mid - 8);
  const d = barDrift(events).filter((b) => b.bar >= 1 && b.bar <= totalBars);
  const bandTop = y(-tol), bandH = y(tol) - y(-tol);
  const ribbon = d.length > 1 ? [...d.map((b) => `${x(b.bar).toFixed(1)},${y(b.mean - b.sd).toFixed(1)}`), ...d.slice().reverse().map((b) => `${x(b.bar).toFixed(1)},${y(b.mean + b.sd).toFixed(1)}`)].join(' ') : '';
  const lastB = d[d.length - 1];
  return (
    <View accessibilityElementsHidden>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Path d={`M0 ${bandTop} H${W} V${bandTop + bandH} H0 Z`} fill={C.accentSoft} />
        <Line x1={0} x2={W} y1={mid} y2={mid} stroke={C.muted} strokeOpacity={0.6} />
        {!!ribbon && <Polygon points={ribbon} fill={C.fg} fillOpacity={0.14} />}
        {d.length > 1 && <Polyline points={d.map((b) => `${x(b.bar).toFixed(1)},${y(b.mean).toFixed(1)}`).join(' ')} fill="none" stroke={C.fg} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />}
        {d.map((b) => <Circle key={b.bar} cx={x(b.bar)} cy={y(b.mean)} r={b === lastB ? 5 : 3} fill={hitColor(b.mean, tol)} />)}
      </Svg>
      <View style={s.gaugeEnds}><Text style={s.edge}>{tr('early')} ↑</Text><Text style={s.edge}>{tr('bar')} 1 … {totalBars}</Text><Text style={s.edge}>↓ {tr('late')}</Text></View>
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
  edge: { color: C.muted, fontSize: 10 },
  gaugeEnds: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', paddingHorizontal: 6, marginTop: -2 },
  gaugeMs: { fontSize: 14, fontWeight: '700', fontFamily: F.mono, fontVariant: ['tabular-nums'], marginTop: 2 },
  meter: { height: 6, alignSelf: 'stretch', marginTop: 4, borderRadius: 3, backgroundColor: C.surface, overflow: 'hidden' },
  meterFill: { height: 6, backgroundColor: C.fg },
});
