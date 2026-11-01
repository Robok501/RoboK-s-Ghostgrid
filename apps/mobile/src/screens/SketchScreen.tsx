/**
 * Groove Sketch: tap grooves into a step grid, see them as a drum score, play them, record them from the e-drum,
 * import MIDI and export PDF, MIDI, text tab or a Ghostgrid file.
 * Layout: iPad shows score and full grid together; iPhone upright shows the score above a half-bar grid you swipe;
 * iPhone sideways shows a full bar of grid and only shows the score while playing.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import {
  GRID_NAMES, INSTRUMENTS, MAX_BARS, UndoStack, addBar, addRow, barGrid, buildMidi, clearBar, cycleState, deleteBar, duplicateBar,
  importMidi, newId, nextGrid, notationStyle, scoreDocument, setBarGrid, setBeats, setGrid, setNote, textTab, tidyRows, visibleRows,
  INSTRUMENT, type Idea, type InstrumentId,
} from '@ghostgrid/core';
import { useApp } from '../AppContext';
import { GridPager } from '../sketch/GridPager';
import { Score } from '../sketch/Score';
import { freshIdea, loadIdeas, saveIdeas, type IdeaStore } from '../sketch/ideas';
import { useSketchPlayer } from '../sketch/usePlayer';
import { C, F } from '../theme';
import { Btn, Card, Chip, Note, Row, Seg, Stepper, Toggle } from '../ui';

export function SketchScreen() {
  const { settings, setSketch } = useApp();
  const sk = settings.sketch;
  const style = useMemo(() => notationStyle(sk.style, sk.custom), [sk.style, sk.custom]);
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tablet = Math.min(win.width, win.height) >= 600;
  const landscape = win.width > win.height;
  const phoneSideways = !tablet && landscape;

  const [store, setStore] = useState<IdeaStore>(loadIdeas);
  const idea = store.ideas.find((i) => i.id === store.current) ?? store.ideas[0];
  const [bar, setBar] = useState(0);
  const [scope, setScope] = useState<'all' | 'bar'>('all');
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const [sideView, setSideView] = useState<'auto' | 'grid' | 'score'>('auto');
  const undo = useRef(new UndoStack());
  const selBar = Math.min(bar, idea.bars.length - 1);

  const persist = useCallback((next: IdeaStore) => { setStore(next); saveIdeas(next); }, []);
  /** Replace the current idea (with undo). */
  const commit = useCallback((next: Idea, withUndo = true) => {
    setStore((s) => {
      const cur = s.ideas.find((i) => i.id === s.current);
      if (withUndo && cur) undo.current.push(cur);
      const out = { ...s, ideas: s.ideas.map((i) => (i.id === next.id ? next : i)) };
      saveIdeas(out);
      return out;
    });
  }, []);
  const say = (t: string) => { setNotice(t); setTimeout(() => setNotice((n) => (n === t ? '' : n)), 4500); };

  const player = useSketchPlayer(idea, (next, count) => {
    if (!count) { say('No hits recorded. Is your e-drum connected? See Kit & settings.'); return; }
    commit(next);
    say(`Recorded ${count} hits. Change the grid if the timing needs a different grid.`);
  });

  const switchTo = (id: string) => {
    player.stop();
    undo.current.clear();
    persist({ ideas: store.ideas.map((i) => (i.id === store.current ? tidyRows(i) : i)), current: id });
    setBar(0); setScope('all');
  };
  const addIdea = (i: Idea) => {
    player.stop();
    undo.current.clear();
    persist({ ideas: [...store.ideas, i], current: i.id });
    setBar(0); setScope('all');
  };

  // ---- grid
  const rows = visibleRows(idea);
  const hidden = INSTRUMENTS.filter((i) => !rows.includes(i.id));
  const toggle = (b: number, id: InstrumentId, st: number) => {
    const v = idea.bars[b].n[id][st];
    commit(setNote(idea, b, id, st, cycleState(INSTRUMENT[id], v)));
  };
  const curGrid = scope === 'bar' ? barGrid(idea, selBar) : idea.grid;
  const cycleGrid = () => {
    const g = nextGrid(curGrid);
    const r = scope === 'bar' ? setBarGrid(idea, selBar, g) : setGrid(idea, g);
    commit(r.idea);
    say(r.lost ? `${r.lost} note${r.lost > 1 ? 's' : ''} didn't fit ${GRID_NAMES[g]}. Undo brings them back.` : `${scope === 'bar' ? `Bar ${selBar + 1}` : 'All bars'}: ${GRID_NAMES[g]}`);
  };

  // ---- sizes
  const W = win.width - insets.left - insets.right - 32;
  const maxSteps = idea.beats * Math.max(...idea.bars.map((_, b) => barGrid(idea, b)));
  const fit = (beatsPerPage: number) => (W - 46 - 6) / (beatsPerPage * (maxSteps / idea.beats)) - 3;
  const pageBeats = fit(idea.beats) >= 38 ? idea.beats : fit(Math.ceil(idea.beats / 2)) >= 34 ? Math.ceil(idea.beats / 2) : 1;
  const cell = Math.max(34, Math.min(tablet ? 64 : 52, Math.floor(fit(pageBeats))));
  // iPhone sideways: score only while playing (or when asked for), grid otherwise
  const sideScore = phoneSideways && (sideView === 'score' || (sideView === 'auto' && player.playing));
  const scoreVisible = !phoneSideways || sideScore;
  const gridVisible = !phoneSideways || !sideScore;

  // ---- import / export
  const importFile = async () => {
    setMenu(false);
    const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0], name = a.name.replace(/\.(mid|midi|ghostgrid|json)$/i, '');
    try {
      const f = new File(a.uri);
      if (/\.(mid|midi)$/i.test(a.name)) {
        const r = importMidi(f.bytesSync(), settings.pads, name);
        addIdea(tidyRows(r.idea));
        say(`Imported ${r.notes} notes at ${r.idea.bpm} BPM, ${GRID_NAMES[r.idea.grid]}${r.unmapped ? ` · ${r.unmapped} notes not mapped` : ''}${r.truncated ? ` · cut at ${MAX_BARS} bars` : ''}.`);
      } else {
        const i = JSON.parse(f.textSync()) as Idea;
        if (!Array.isArray(i.bars) || !i.beats || !i.grid) throw new Error('not a Ghostgrid file');
        addIdea(tidyRows({ ...i, id: newId() }));
        say(`Opened ${i.name}.`);
      }
    } catch (e) {
      say(`Couldn't read that file: ${(e as Error).message}`);
    }
  };
  const safe = (idea.name || 'groove').replace(/[^\w\- ]+/g, '').trim() || 'groove';
  const shareFile = async (ext: string, data: string | Uint8Array, mimeType: string, UTI: string) => {
    const f = new File(Paths.cache, `${safe}.${ext}`);
    try { if (f.exists) f.delete(); } catch { /* overwrite */ }
    f.writeSync(data);
    await Sharing.shareAsync(f.uri, { mimeType, UTI, dialogTitle: idea.name });
  };
  const exportAs = async (kind: 'pdf' | 'midi' | 'txt' | 'gg') => {
    setMenu(false);
    try {
      if (kind === 'pdf') {
        const svg = scoreDocument(idea, 720, sk.count, style);
        const { uri } = await Print.printToFileAsync({ html: `<html><body style="margin:24px">${svg.replace(/^<\?xml[^>]*>/, '')}</body></html>` });
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: idea.name });
      }
      if (kind === 'midi') await shareFile('mid', buildMidi(idea), 'audio/midi', 'public.midi-audio');
      if (kind === 'txt') await shareFile('txt', textTab(idea), 'text/plain', 'public.plain-text');
      if (kind === 'gg') await shareFile('ghostgrid', JSON.stringify(idea), 'application/json', 'public.json');
    } catch (e) {
      say(`Export failed: ${(e as Error).message}`);
    }
  };

  const playBtn = <Btn label={player.playing && !player.rec ? 'Stop' : 'Play'} primary active={player.playing && !player.rec} onPress={() => { setSideView('auto'); if (player.playing) player.stop(); else player.play(); }} style={s.play} />;
  const recBtn = (
    <Pressable onPress={() => (player.rec ? player.stop() : player.record())} style={[s.rec, player.rec && s.recOn]} accessibilityRole="button" accessibilityLabel={player.rec ? 'Stop recording' : 'Record from e-drum'}>
      <View style={[s.recDot, player.rec && { backgroundColor: C.fg }]} />
      <Text style={s.recTxt}>{player.rec === 'count' ? `${player.countBeat || '…'}` : player.rec ? 'Stop' : 'Rec'}</Text>
    </Pressable>
  );

  return (
    <View style={s.root}>
      {/* top bar */}
      <View style={s.top}>
        <Pressable onPress={() => setMenu(true)} style={s.ideaBtn} accessibilityRole="button" accessibilityLabel="Ideas and options">
          <Text style={s.ideaName} numberOfLines={1}>{idea.name}</Text>
          <Text style={s.ideaSub}>{idea.bpm} BPM · {idea.beats}/4 ▾</Text>
        </Pressable>
        <Btn label="Undo" disabled={!undo.current.size} onPress={() => { const p = undo.current.pop(); if (p) commit(p, false); }} />
        {phoneSideways && <Btn label={sideScore ? 'Grid' : 'Score'} onPress={() => setSideView(sideScore ? 'grid' : 'score')} />}
        {phoneSideways && recBtn}
        {phoneSideways && playBtn}
      </View>

      {!!notice && <Text style={s.notice}>{notice}</Text>}

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {scoreVisible && (
          <ScrollView style={!tablet && !landscape ? { maxHeight: win.height * 0.3 } : undefined} nestedScrollEnabled>
            <Score idea={idea} width={W} style={style} count={sk.count} selectedBar={scope === 'bar' ? selBar : null}
              playBar={player.pos?.bar ?? null} onSelectBar={(b) => { setBar(b); setScope('bar'); }} />
          </ScrollView>
        )}

        {/* bars + grid button */}
        <View style={s.barRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.bars}>
            <Chip label="All" on={scope === 'all'} onPress={() => setScope('all')} />
            {idea.bars.map((b, i) => (
              <Chip key={i} label={`${i + 1}${b.grid ? ` ${b.grid === 3 ? '³' : b.grid === 2 ? '⁸' : '¹⁶'}` : ''}`} on={scope === 'bar' && i === selBar}
                onPress={() => { setBar(i); setScope('bar'); }} />
            ))}
            {idea.bars.length < MAX_BARS && <Chip label="+ Bar" onPress={() => { commit(addBar(idea)); setBar(idea.bars.length); setScope('bar'); }} />}
          </ScrollView>
          <Pressable onPress={cycleGrid} style={s.gridBtn} accessibilityRole="button" accessibilityLabel={`Grid ${GRID_NAMES[curGrid]}, tap to change`}>
            <Text style={s.gridBtnTxt}>{GRID_NAMES[curGrid]}</Text>
            <Text style={s.gridBtnSub}>{scope === 'bar' ? `bar ${selBar + 1}` : 'all bars'}</Text>
          </Pressable>
        </View>

        {gridVisible && (
          <GridPager idea={idea} rows={rows} cell={cell} width={W} pageBeats={pageBeats} selectedBar={selBar} pos={player.pos}
            onToggle={toggle} onBar={(b) => setBar(b)} onAdd={() => setAdding((v) => !v)} />
        )}
        {adding && (
          <View style={s.chips}>
            {hidden.length ? hidden.map((i) => <Chip key={i.id} label={`+ ${i.name}`} onPress={() => { commit(addRow(idea, i.id), false); if (hidden.length <= 1) setAdding(false); }} />)
              : <Note>All instruments are showing.</Note>}
            <Chip label="Clean up empty rows" onPress={() => { commit(tidyRows(idea), false); setAdding(false); }} />
          </View>
        )}
      </ScrollView>

      {!phoneSideways && (
        <View style={s.bottom}>
          <Stepper value={idea.bpm} min={30} max={260} onChange={(bpm) => commit({ ...idea, bpm }, false)} format={(v) => `${v}`} />
          {recBtn}
          {playBtn}
        </View>
      )}

      <Modal visible={menu} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setMenu(false)}>
        <View style={s.sheet}>
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>Sketch</Text>
            <Btn label="Done" onPress={() => setMenu(false)} />
          </View>
          <ScrollView contentContainerStyle={s.sheetScroll} keyboardShouldPersistTaps="handled">
            <Card title="Ideas">
              <View style={s.chips}>
                {store.ideas.map((i) => <Chip key={i.id} label={i.name} on={i.id === idea.id} onPress={() => switchTo(i.id)} />)}
              </View>
              <Row label="Name">
                <TextInput value={idea.name} onChangeText={(name) => commit({ ...idea, name }, false)} style={s.input} placeholder="Name" placeholderTextColor={C.muted} />
              </Row>
              <View style={s.btnRow}>
                <Btn label="+ New idea" onPress={() => { addIdea(freshIdea(store.ideas.length + 1)); setMenu(false); }} />
                <Btn label="Duplicate" onPress={() => addIdea({ ...JSON.parse(JSON.stringify(idea)), id: newId(), name: `${idea.name} copy` })} />
                <Btn label="Delete" disabled={store.ideas.length < 2} onPress={() => {
                  const rest = store.ideas.filter((i) => i.id !== idea.id);
                  persist({ ideas: rest, current: rest[0].id }); setBar(0);
                }} />
              </View>
            </Card>

            <Card title="Groove">
              <Row label="Tempo" first><Stepper value={idea.bpm} min={30} max={260} onChange={(bpm) => commit({ ...idea, bpm }, false)} /></Row>
              <Row label="Beats per bar"><Stepper value={idea.beats} min={1} max={12} onChange={(b) => commit(setBeats(idea, b))} /></Row>
              <Row label="Swing" hint="not with triplets"><Stepper value={idea.swing} min={0} max={50} step={5} format={(v) => `${v}%`} onChange={(swing) => commit({ ...idea, swing }, false)} /></Row>
              <Toggle label="Click while playing" value={sk.click} onChange={(click) => setSketch({ click })} />
              <Toggle label="Count under the score" hint="1 e & a" value={sk.count} onChange={(count) => setSketch({ count })} />
            </Card>

            <Card title={`Bar ${selBar + 1}`}>
              <View style={s.btnRow}>
                <Btn label="Duplicate" disabled={idea.bars.length >= MAX_BARS} onPress={() => commit(duplicateBar(idea, selBar))} />
                <Btn label="Clear" onPress={() => commit(clearBar(idea, selBar))} />
                <Btn label="Delete" disabled={idea.bars.length < 2} onPress={() => { commit(deleteBar(idea, selBar)); setBar(Math.max(0, selBar - 1)); }} />
              </View>
              <View style={s.btnRow}><Btn label="Clean up empty rows" onPress={() => commit(tidyRows(idea), false)} /></View>
            </Card>

            <Card title="Record from e-drum">
              <Note>One bar count-in, then it records over the bars of this idea. Replace writes over them; Layer adds to what's there (kick first, then hats…).</Note>
              <Row label="Mode"><Seg options={[{ value: 'replace', label: 'Replace' }, { value: 'layer', label: 'Layer' }]} value={sk.recMode} onChange={(recMode) => setSketch({ recMode: recMode as 'replace' | 'layer' })} /></Row>
            </Card>

            <Card title="Import">
              <Note>A MIDI file (from your module, a DAW or a groove library) becomes a score. Then cycle the grid until it reads right; tap a bar first to change only that bar.</Note>
              <View style={s.btnRow}><Btn label="Import MIDI or Ghostgrid file" onPress={importFile} /></View>
            </Card>

            <Card title="Export">
              <View style={s.btnRow}>
                <Btn label="PDF score" onPress={() => exportAs('pdf')} />
                <Btn label="MIDI" onPress={() => exportAs('midi')} />
                <Btn label="Text tab" onPress={() => exportAs('txt')} />
                <Btn label="Ghostgrid file" onPress={() => exportAs('gg')} />
              </View>
            </Card>
            <Text style={s.footer}>Notation style: {style.name} · change it under Kit & settings</Text>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4 },
  ideaBtn: { flex: 1, minHeight: 44, justifyContent: 'center' },
  ideaName: { color: C.fg, fontSize: 18, fontWeight: '800' },
  ideaSub: { color: C.muted, fontSize: 12 },
  notice: { color: C.accent, fontSize: 13, paddingHorizontal: 16, paddingBottom: 4 },
  scroll: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bars: { gap: 6, paddingVertical: 4, alignItems: 'center' },
  gridBtn: { minWidth: 96, minHeight: 52, borderRadius: 14, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  gridBtnTxt: { color: C.accentInk, fontSize: 17, fontWeight: '800', fontFamily: F.display },
  gridBtnSub: { color: C.accentInk, fontSize: 10, opacity: 0.75 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 6 },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  play: { flex: 1, minHeight: 52 },
  rec: { minHeight: 52, minWidth: 72, borderRadius: 16, backgroundColor: C.raised, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12 },
  recOn: { backgroundColor: C.late },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.late },
  recTxt: { color: C.fg, fontSize: 15, fontWeight: '700' },
  sheet: { flex: 1, backgroundColor: C.bg },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  sheetTitle: { color: C.fg, fontSize: 22, fontWeight: '800' },
  sheetScroll: { padding: 16, paddingTop: 0, gap: 14, paddingBottom: 40 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 6 },
  input: { flex: 1, minHeight: 44, color: C.fg, fontSize: 16, textAlign: 'right' },
  footer: { color: C.muted, fontSize: 12, textAlign: 'center' },
});
