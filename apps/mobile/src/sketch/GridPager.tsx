/**
 * Step grid editor. One page shows a whole bar or part of one (half a bar on a phone held upright);
 * swipe sideways to move through the idea. Row labels stay put on the left.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { INSTRUMENT, barGrid, countLabel, type Bar, type Grid, type Idea, type InstrumentId, type NoteState } from '@ghostgrid/core';
import { C, F } from '../theme';
import { t } from '../i18n';
import type { PlayPos } from './usePlayer';

export interface Page { bar: number; from: number; to: number }

export function pagesFor(idea: Idea, pageBeats: number): Page[] {
  const out: Page[] = [];
  idea.bars.forEach((_, b) => {
    const g = barGrid(idea, b);
    for (let beat = 0; beat < idea.beats; beat += pageBeats) out.push({ bar: b, from: beat * g, to: Math.min(idea.beats, beat + pageBeats) * g });
  });
  return out;
}

const LABEL_W = 46, GAP = 3;

export function GridPager({ idea, rows, cell, width, pageBeats, selectedBar, pos, onToggle, onBar, onAdd }: {
  idea: Idea; rows: InstrumentId[]; cell: number; width: number; pageBeats: number; selectedBar: number;
  pos: PlayPos | null; onToggle: (bar: number, id: InstrumentId, step: number) => void; onBar: (bar: number) => void; onAdd: () => void;
}) {
  const pageW = width - LABEL_W;
  const pages = useMemo(() => pagesFor(idea, pageBeats), [idea, pageBeats]);
  const list = useRef<FlatList<Page>>(null);
  const shown = useRef(0);

  const go = (i: number, animated = true) => {
    if (i < 0 || i >= pages.length || i === shown.current) return;
    shown.current = i;
    list.current?.scrollToOffset({ offset: i * pageW, animated });
  };
  // follow the selected bar, and the playhead while playing
  useEffect(() => {
    if (pages[shown.current]?.bar !== selectedBar) go(pages.findIndex((p) => p.bar === selectedBar), false);
  }, [selectedBar, pages]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pos) return;
    const i = pages.findIndex((p) => p.bar === pos.bar && pos.step >= p.from && pos.step < p.to);
    if (i >= 0) go(i, false);
  }, [pos, pages]); // eslint-disable-line react-hooks/exhaustive-deps

  // only the page under the playhead re-renders while playing (pages are memoised)
  const playKey = pos ? `${pos.bar}:${pos.step}` : '';
  const toggleCb = useRef(onToggle);
  toggleCb.current = onToggle;
  const toggleRef = useCallback((b: number, id: InstrumentId, st: number) => toggleCb.current(b, id, st), []);
  return (
    <View style={{ flexDirection: 'row' }}>
      <View style={{ width: LABEL_W }}>
        <View style={{ height: 22 }} />
        {rows.map((id) => (
          <View key={id} style={[s.label, { height: cell, marginBottom: GAP }]}>
            <Text style={s.labelTxt}>{INSTRUMENT[id].short}</Text>
          </View>
        ))}
        <Pressable onPress={onAdd} style={[s.add, { height: Math.max(cell, 40) }]} accessibilityRole="button" accessibilityLabel={t('Add instrument')}>
          <Text style={s.addTxt}>+</Text>
        </Pressable>
      </View>
      <FlatList
        ref={list}
        data={pages}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={{ width: pageW }}
        keyExtractor={(p) => `${p.bar}-${p.from}`}
        getItemLayout={(_, i) => ({ length: pageW, offset: pageW * i, index: i })}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / pageW);
          shown.current = i;
          if (pages[i] && pages[i].bar !== selectedBar) onBar(pages[i].bar);
        }}
        extraData={playKey}
        initialNumToRender={2}
        windowSize={3}
        maxToRenderPerBatch={2}
        removeClippedSubviews
        renderItem={({ item: p }) => (
          <PageView p={p} bar={idea.bars[p.bar]} g={barGrid(idea, p.bar)} full={idea.beats * barGrid(idea, p.bar)} rows={rows} cell={cell} pageW={pageW}
            playStep={pos && pos.bar === p.bar && pos.step >= p.from && pos.step < p.to ? pos.step : -1} onToggle={toggleRef} />
        )}
      />
    </View>
  );
}

const PageView = memo(function PageView({ p, bar, g, full, rows, cell, pageW, playStep, onToggle }: {
  p: Page; bar: Bar | undefined; g: Grid; full: number; rows: InstrumentId[]; cell: number; pageW: number; playStep: number;
  onToggle: (bar: number, id: InstrumentId, step: number) => void;
}) {
  const n = p.to - p.from, rowH = cell + GAP;
  const cw = Math.min(cell, (pageW - 6 - GAP * n) / n);
  return (
    <View style={{ width: pageW, paddingRight: 6 }}>
      <View style={[s.countRow, { height: 22 }]}>
        {Array.from({ length: n }, (_, k) => {
          const st = p.from + k;
          return <Text key={k} style={[s.count, { width: cw, marginRight: GAP }, st % g === 0 && s.countBeat]}>{countLabel(st, g)}</Text>;
        })}
      </View>
      {rows.map((id) => (
        <View key={id} style={{ flexDirection: 'row', height: rowH }}>
          {Array.from({ length: n }, (_, k) => {
            const st = p.from + k;
            const v = (bar?.n[id][st] ?? 0) as NoteState;
            return (
              <Pressable key={k} onPress={() => onToggle(p.bar, id, st)} accessibilityRole="button"
                accessibilityLabel={`${INSTRUMENT[id].name} ${countLabel(st, g)}`}
                style={[s.cell, { width: cw, height: cell, marginRight: GAP }, st % g === 0 && !v && s.cellBeat, cellStyle(v, id), playStep === st && s.cellNow]}>
                <Text style={[s.cellTxt, v === 2 && { color: C.accentInk }]}>{mark(v, id)}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      <View style={s.barTag}><Text style={s.barTagTxt}>{t('Bar {{n}}', { n: p.bar + 1 })}{p.from > 0 || p.to < full ? ` · ${p.from / g + 1}–${p.to / g}` : ''}</Text></View>
    </View>
  );
});

function cellStyle(v: NoteState, id: InstrumentId) {
  if (v === 1) return { backgroundColor: C.fg };
  if (v === 2) return { backgroundColor: C.accent };
  if (v === 3) return INSTRUMENT[id].alt === 'open' ? { borderWidth: 2, borderColor: C.accent, backgroundColor: C.raised } : { backgroundColor: C.raised2, borderWidth: 1, borderColor: C.muted };
  return null;
}
function mark(v: NoteState, id: InstrumentId) {
  if (v === 2) return '>';
  if (v === 3) return INSTRUMENT[id].alt === 'open' ? 'o' : '( )';
  return '';
}

const s = StyleSheet.create({
  label: { justifyContent: 'center' },
  labelTxt: { color: C.muted, fontSize: 13, fontWeight: '700', fontFamily: F.mono },
  add: { width: 40, borderRadius: 10, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  addTxt: { color: C.fg, fontSize: 22, fontWeight: '600' },
  countRow: { flexDirection: 'row', alignItems: 'flex-end', paddingBottom: 3 },
  count: { color: C.muted, fontSize: 10, textAlign: 'center' },
  countBeat: { color: C.fg, fontWeight: '700', fontSize: 12 },
  cell: { borderRadius: 7, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  cellBeat: { backgroundColor: C.raised2 },
  cellNow: { borderWidth: 2, borderColor: C.accent },
  cellTxt: { color: C.fg, fontSize: 12, fontWeight: '800' },
  barTag: { paddingTop: 4 },
  barTagTxt: { color: C.muted, fontSize: 11 },
});
