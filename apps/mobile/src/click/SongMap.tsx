/** Program overview: one block per bar (wider for more beats), the bar being heard lit, play from any section. */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { programLength, sectionLetter, type ClickStep, type Section } from '@ghostgrid/core';
import { C, F } from '../theme';
import { t } from '../i18n';

const mmss = (sec: number) => { const s = Math.round(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function SongMap({ program, loop, cur, running, onPlayFrom }: {
  program: Section[]; loop: boolean; cur: ClickStep | null; running: boolean; onPlayFrom: (i: number) => void;
}) {
  const total = programLength(program);
  return (
    <View style={s.wrap}>
      <View style={s.top}>
        <Text style={s.topLabel}>{t('Song map').toUpperCase()}</Text>
        <Text style={s.topVal}>{t('{{count}} bars', { count: total.bars })} · {mmss(total.seconds)}{loop ? ` · ${t('loops')}` : ''}</Text>
      </View>
      {program.map((sec, i) => {
        const isCur = running && cur?.section === i;
        const dur = (sec.bars * sec.beats * 60) / sec.bpm;
        const w = Math.max(16, Math.min(44, sec.beats * 5));
        return (
          <View key={i} style={[s.sec, i > 0 && s.secLine]}>
            <Pressable onPress={() => onPlayFrom(i)} style={s.head} accessibilityRole="button" accessibilityLabel={t('Play from section {{s}}', { s: sectionLetter(i) })}>
              <View style={[s.letter, isCur && s.letterOn]}><Text style={[s.letterTxt, isCur && { color: C.accentInk }]}>{sectionLetter(i)}</Text></View>
              <Text style={s.meta}><Text style={{ color: C.fg, fontWeight: '600' }}>{t('{{count}} bars', { count: sec.bars })}</Text> · {sec.beats}/4 · {sec.bpm} BPM · {mmss(dur)}</Text>
              <Text style={s.from}>▶ {t('From here').toUpperCase()}</Text>
            </Pressable>
            <View style={s.bars}>
              {Array.from({ length: sec.bars }, (_, b) => {
                const done = running && cur && (cur.section > i || (cur.section === i && cur.sectionBar > b));
                const now = isCur && cur?.sectionBar === b;
                return (
                  <View key={b} style={[s.bar, { width: w }, b % 4 === 0 && b > 0 && { marginLeft: 7 }, done && s.done, now && s.now]}>
                    {b % 4 === 0 && <Text style={[s.barNum, now && { color: C.accentInk }]}>{b + 1}</Text>}
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 12, gap: 2 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 },
  topLabel: { color: C.muted, fontSize: 12, letterSpacing: 1.4 },
  topVal: { color: C.fg, fontSize: 13, fontFamily: F.mono },
  sec: { paddingBottom: 10 },
  secLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  letter: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  letterOn: { backgroundColor: C.accent },
  letterTxt: { color: C.fg, fontSize: 17, fontWeight: '800' },
  meta: { flex: 1, color: C.muted, fontSize: 13 },
  from: { color: C.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  bars: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, paddingLeft: 40 },
  bar: { height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  done: { backgroundColor: C.raised, borderColor: C.raised },
  now: { backgroundColor: C.accent, borderColor: C.accent },
  barNum: { color: C.muted, fontSize: 9, fontFamily: F.mono },
});
