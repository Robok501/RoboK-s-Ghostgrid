/** Practice mode panel: how the passes of a library exercise are going, graded against the score. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LIBRARY, type Idea, type NoteVerdict, type PracticeGrade } from '@ghostgrid/core';
import { t } from '../i18n';
import { Card } from '../ui';
import { C, F } from '../theme';

export const VERDICT_COLOR: Record<NoteVerdict, string> = { ok: C.good, early: C.early, late: C.late, missed: '#d0443a', weak: C.accent, loud: C.accent };

const sgn = (ms: number) => `${ms >= 0 ? '+' : '−'}${Math.round(Math.abs(ms))} ms`;

export function PracticePanel({ idea, grade, playing, demo }: { idea: Idea; grade: PracticeGrade | null; playing: boolean; demo: boolean }) {
  const ex = LIBRARY.find((e) => e.id === idea.practice);
  if (!ex) return null;
  const passes = grade?.passes ?? [];
  const last = passes[passes.length - 1];
  const best = passes.length ? Math.max(...passes.map((p) => p.score)) : 0;
  const avg = passes.length ? passes.reduce((a, p) => a + p.score, 0) / passes.length : 0;
  const rollLike = ex.family === 'rolls' || ex.family === 'diddles';
  return (
    <Card title="Practice">
      <Text style={s.title}>{ex.title}</Text>
      <Text style={s.tip}>{t(ex.summary)}</Text>
      {!playing && !last && <Text style={s.hint}>{t('Press play: you hear the exercise once, then play it on your e-drum snare. Every pass after that is graded against the score.')}</Text>}
      {playing && demo && <Text style={s.listen}>{t('Listen first…')}</Text>}
      {playing && !demo && !last && <Text style={s.listen}>{t('Now you: play along')}</Text>}
      {last && (
        <View style={s.grid}>
          <View style={s.big}>
            <Text style={[s.pct, { color: last.score >= 85 ? C.good : last.score >= 60 ? C.accent : C.late }]}>{Math.round(last.score)}%</Text>
            <Text style={s.sub}>{t('pass {{n}}', { n: last.pass + 1 })}</Text>
          </View>
          <View style={s.lines}>
            <Text style={s.line}>{t('{{a}} of {{b}} notes right', { a: last.right, b: last.total })}</Text>
            {last.missed > 0 && <Text style={s.line}>{t('{{n}} missed', { n: last.missed })}</Text>}
            {last.extras > 0 && <Text style={s.line}>{t('{{n}} extra hits', { n: last.extras })}</Text>}
            {last.total - last.missed > 0 && <Text style={s.line}>{t('on average {{ms}}, spread ±{{sd}} ms', { ms: sgn(last.meanMs), sd: Math.round(last.sdMs) })}</Text>}
            {last.accents.n > 0 && <Text style={s.line}>{t('accents {{a}} of {{b}}', { a: last.accents.ok, b: last.accents.n })}</Text>}
            {last.graces.n > 0 && <Text style={s.line}>{t('{{a}} of {{b}} with a clear grace note', { a: last.graces.ok, b: last.graces.n })}</Text>}
            {rollLike && grade && grade.evenSdMs > 0 && <Text style={s.line}>{t('evenness ±{{sd}} ms', { sd: Math.round(grade.evenSdMs) })}</Text>}
            {passes.length > 1 && <Text style={s.sub}>{t('best {{b}}% · average {{a}}% over {{n}} passes', { b: Math.round(best), a: Math.round(avg), n: passes.length })}</Text>}
          </View>
        </View>
      )}
      {last && <Text style={s.legend}>{t('Under the score: green on time, blue early, orange late, red missed, yellow accent too soft.')}</Text>}
    </Card>
  );
}

const s = StyleSheet.create({
  title: { color: C.fg, fontSize: 16, fontWeight: '700' },
  tip: { color: C.muted, fontSize: 13, marginTop: 2 },
  hint: { color: C.muted, fontSize: 13, marginTop: 8 },
  listen: { color: C.accent, fontSize: 16, fontWeight: '700', marginTop: 8 },
  grid: { flexDirection: 'row', gap: 16, marginTop: 10, alignItems: 'flex-start' },
  big: { alignItems: 'center', minWidth: 84 },
  pct: { fontFamily: F.mono, fontSize: 34, fontWeight: '800' },
  sub: { color: C.muted, fontSize: 12, marginTop: 2 },
  lines: { flex: 1, gap: 2 },
  line: { color: C.fg, fontSize: 14 },
  legend: { color: C.muted, fontSize: 11, marginTop: 8 },
});
