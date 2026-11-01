/**
 * Groove Sketch: tap grooves into a step grid, see them as a drum score, play them, record them from the e-drum,
 * record them by voice (beatbox), import MIDI and export PDF, MIDI, text tab or a Ghostgrid file.
 * A ribbon under the title (Ideas · Import · Export · Voice · Settings) opens everything that belongs to the sketch.
 * Layout: iPad shows score and full grid together; iPhone upright shows the score above a half-bar grid you swipe;
 * iPhone sideways shows a full bar of grid and only shows the score while playing.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import {
  GRID_NAMES, INSTRUMENTS, MAX_BARS, UndoStack, addBar, addRow, barGrid, buildMidi, clearBar, cycleState, deleteBar, duplicateBar,
  SOUND, SOUNDS, addSamples, analyze, importMidi, newId, nextGrid, staleSamples, taughtSounds, usesOwnSounds, notationStyle, scoreDocument, setBarGrid, setBeats, setGrid, setNote, textTab, tidyRows, visibleRows,
  INSTRUMENT, type Idea, type InstrumentId, type SoundKey,
} from '@ghostgrid/core';
import Engine from '../../modules/ghostgrid-engine';
import { useApp } from '../AppContext';
import { GridPager } from '../sketch/GridPager';
import { Score } from '../sketch/Score';
import { freshIdea, loadIdeas, saveIdeas, type IdeaStore } from '../sketch/ideas';
import { applyTake, readVoiceFile, saveWav, useSketchPlayer, type VoiceTake } from '../sketch/usePlayer';
import { C, F } from '../theme';
import { Btn, Card, Chip, Note, Row, Seg, Stepper, Toggle } from '../ui';

/** Examples per taught sound; teaching stops by itself once this many are heard. */
const TEACH_MAX = 6;

export function SketchScreen() {
  const { settings, setSketch, mic, setMic, on, setMicSens } = useApp();
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
  const [sheet, setSheet] = useState<null | 'ideas' | 'export' | 'voice' | 'settings' | 'all'>(null);
  const [teaching, setTeaching] = useState<SoundKey | null>(null);
  const micWasOff = useRef(false);
  const [take, setTake] = useState<VoiceTake | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [teachWav, setTeachWav] = useState<{ uri: string; name: string; heard: number } | null>(null);
  const shareWav = async (uri: string) => {
    try { await Sharing.shareAsync(uri, { mimeType: 'audio/wav', UTI: 'com.microsoft.waveform-audio', dialogTitle: 'Ghostgrid recording' }); }
    catch (e) { say(`Couldn't share: ${(e as Error).message}`); }
  };
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

  const releaseMic = () => { if (micWasOff.current) { micWasOff.current = false; setMic(false); } };
  const player = useSketchPlayer(idea, (next, count, source, tk) => {
    setTake(tk ?? null); setPick(null);
    if (source === 'voice') setTimeout(releaseMic, 50);
    if (count === -2) { say('The microphone is off. Allow it in Settings → Ghostgrid.'); return; }
    if (count < 0) return;
    if (!count) {
      say(source === 'voice' ? 'No sounds found. Beatbox a bit louder, close to the phone.' : 'No hits recorded. Is your e-drum connected? See Kit & settings.');
      return;
    }
    commit(next);
    say(`${source === 'voice' ? 'Heard' : 'Recorded'} ${count} hits. Change the grid if the timing needs a different grid.`);
  });

  /** Mic on for voice work (remember to turn it off again afterwards). */
  const ensureMic = async () => {
    if (mic) return true;
    micWasOff.current = true;
    const ok = await setMic(true);
    if (!ok) { micWasOff.current = false; say('The microphone is off. Allow it in Settings → Ghostgrid.'); }
    return ok;
  };
  const recordVoice = async () => {
    if (player.rec) { player.stop(); return; }
    if (await ensureMic()) player.record('voice');
  };

  // ---- checking a voice take: change a hit's sound (that also teaches it) or remove it
  const correct = (i: number, k: SoundKey | null) => {
    if (!take) return;
    const h = take.hits[i];
    const hits = k ? take.hits.map((x, j) => (j === i ? { ...x, k, margin: 1 } : x)) : take.hits.filter((_, j) => j !== i);
    const next = { ...take, hits };
    if (k && k !== h.k) setSketch({ voice: addSamples(sk.voice, k, [h.v]) });
    setTake(next);
    setPick(null);
    commit({ ...applyTake(next), id: idea.id, name: idea.name, bpm: idea.bpm }, false);
  };
  const where = (beat: number) => {
    const b = Math.floor(beat / idea.beats + 1e-6), inBar = beat - b * idea.beats;
    return `${b + 1}.${Math.floor(inBar + 1e-6) + 1}`;
  };

  // ---- teaching your own beatbox sounds
  const startTeach = async (k: SoundKey) => {
    player.stop();
    if (!(await ensureMic())) return;
    if (!Engine.startRecording()) { say('The microphone is off.'); return; }
    setTeachCount(0);
    setTeaching(k);
  };
  // live count of sounds heard while teaching; stops by itself after TEACH_MAX
  const [teachCount, setTeachCount] = useState(0);
  const finishRef = useRef<(keep: boolean) => void>(() => {});
  useEffect(() => {
    if (!teaching) return;
    let n = 0, done: ReturnType<typeof setTimeout> | null = null;
    const off = on('mic', () => {
      if (done) return;
      n += 1;
      setTeachCount(n);
      if (n >= TEACH_MAX) done = setTimeout(() => finishRef.current(true), 600);
    });
    return () => { off(); if (done) clearTimeout(done); };
  }, [teaching, on]);
  const finishTeach = (keep: boolean) => {
    const k = teaching;
    setTeaching(null);
    try {
      const f = Engine.stopRecording();
      if (keep && k) {
        const data = readVoiceFile(f.path);
        const name = SOUNDS.find((x) => x.k === k)!.name;
        const a = analyze(data, f.sampleRate, {}, 45, settings.micSens);
        // keep only as many as you said (the loudest), so stray detections don't become examples
        const wanted = teachCount > 0 ? Math.min(TEACH_MAX, teachCount) : TEACH_MAX;
        const vecs = a.hits.slice().sort((x, y) => y.peak - x.peak).slice(0, wanted).map((h) => h.f.v);
        try { setTeachWav({ uri: saveWav(data, f.sampleRate, `ghostgrid-teach-${k}.wav`), name, heard: a.hits.length }); } catch { /* sharing is optional */ }
        if (vecs.length >= 2) {
          setSketch({ voice: addSamples(sk.voice, k, vecs) });
          say(`${name}: learned ${vecs.length} examples${a.hits.length > vecs.length ? ` (${a.hits.length - vecs.length} extra sounds ignored)` : ''}.`);
        } else say('Heard too few sounds. Try again, 4 to 6 times, with a short pause between them.');
      }
    } catch { say('Recording failed.'); }
    setTimeout(releaseMic, 50);
  };
  finishRef.current = finishTeach;

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
    setSheet(null);
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
    setSheet(null);
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
  const recOn = (src: 'pads' | 'voice') => !!player.rec && player.recSource === src;
  const recLabel = (src: 'pads' | 'voice', idle: string) => (recOn(src) ? (player.rec === 'count' ? `${player.countBeat || '…'}` : 'Stop') : idle);
  const recBtn = (
    <Pressable onPress={() => (player.rec ? player.stop() : player.record('pads'))} style={[s.rec, recOn('pads') && s.recOn]} accessibilityRole="button" accessibilityLabel={player.rec ? 'Stop recording' : 'Record from e-drum'}>
      <View style={[s.recDot, recOn('pads') && { backgroundColor: C.fg }]} />
      <Text style={s.recTxt}>{recLabel('pads', 'E-drum')}</Text>
    </Pressable>
  );
  const voiceBtn = (
    <Pressable onPress={recordVoice} style={[s.rec, recOn('voice') && s.recOn]} accessibilityRole="button" accessibilityLabel={player.rec ? 'Stop recording' : 'Record beatbox'}>
      <Text style={[s.recTxt, { fontSize: 16 }]}>{recOn('voice') ? '' : '◉'}</Text>
      <Text style={s.recTxt}>{recLabel('voice', 'Voice')}</Text>
    </Pressable>
  );
  const RIBBON: { id: 'ideas' | 'import' | 'export' | 'voice' | 'settings'; glyph: string; label: string }[] = [
    { id: 'ideas', glyph: '▤', label: 'Ideas' },
    { id: 'import', glyph: '⤓', label: 'Import' },
    { id: 'export', glyph: '⤴', label: 'Export' },
    { id: 'voice', glyph: '◉', label: 'Voice' },
    { id: 'settings', glyph: '⚙︎', label: 'Settings' },
  ];
  const ribbon = (
    <View style={s.ribbon} accessibilityRole="toolbar">
      {RIBBON.map((r) => (
        <Pressable key={r.id} onPress={() => (r.id === 'import' ? importFile() : setSheet(r.id))} style={({ pressed }) => [s.ribBtn, pressed && { backgroundColor: C.raised2 }]}
          accessibilityRole="button" accessibilityLabel={r.label}>
          <Text style={s.ribGlyph}>{r.glyph}</Text>
          <Text style={s.ribTxt}>{r.label}</Text>
        </Pressable>
      ))}
    </View>
  );
  const show = (k: 'ideas' | 'export' | 'voice' | 'settings') => sheet === k || sheet === 'all';
  const own = usesOwnSounds(sk.voice), taught = taughtSounds(sk.voice);

  return (
    <View style={s.root}>
      {/* top bar */}
      <View style={s.top}>
        <Pressable onPress={() => setSheet('ideas')} style={s.ideaBtn} accessibilityRole="button" accessibilityLabel="Ideas">
          <Text style={s.ideaName} numberOfLines={1}>{idea.name}</Text>
          <Text style={s.ideaSub}>{idea.bpm} BPM · {idea.beats}/4 ▾</Text>
        </Pressable>
        {phoneSideways && <Btn label="☰ Menu" onPress={() => setSheet('all')} />}
        <Btn label="Undo" disabled={!undo.current.size} onPress={() => { const p = undo.current.pop(); if (p) commit(p, false); }} />
        {phoneSideways && <Btn label={sideScore ? 'Grid' : 'Score'} onPress={() => setSideView(sideScore ? 'grid' : 'score')} />}
        {phoneSideways && recBtn}
        {phoneSideways && voiceBtn}
        {phoneSideways && playBtn}
      </View>
      {!phoneSideways && ribbon}

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

        {take && !player.rec && (
          <Card title="Check what I heard">
            <Note>Tap a hit to fix it. Every fix also teaches your voice. Hits marked ? were a close call.</Note>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.takeRow}>
              {take.hits.map((h, i) => {
                const unsure = h.margin !== undefined && h.margin < 0.25;
                return (
                  <Pressable key={i} onPress={() => setPick(pick === i ? null : i)} style={[s.takeHit, unsure && s.takeUnsure, pick === i && s.takePick]}
                    accessibilityRole="button" accessibilityLabel={`${SOUND[h.k].name} at ${where(h.beat)}${unsure ? ', not sure' : ''}`}>
                    <Text style={[s.takeLetter, pick === i && { color: C.bg }]}>{SOUND[h.k].letter}{unsure ? '?' : ''}</Text>
                    <Text style={[s.takeWhere, pick === i && { color: C.bg }]}>{where(h.beat)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {pick !== null && take.hits[pick] && (
              <View style={s.chips}>
                {SOUNDS.map((x) => <Chip key={x.k} label={x.name} on={x.k === take.hits[pick].k} onPress={() => correct(pick, x.k)} />)}
                <Chip label="Remove" onPress={() => correct(pick, null)} />
              </View>
            )}
            <View style={s.btnRow}>
              <Btn label="Looks good" onPress={() => { setTake(null); setPick(null); }} />
              {!!take.wav && <Btn label="Share recording" onPress={() => shareWav(take.wav!)} />}
            </View>
          </Card>
        )}
      </ScrollView>

      {!phoneSideways && (
        <View style={s.bottom}>
          <Stepper value={idea.bpm} min={30} max={260} onChange={(bpm) => commit({ ...idea, bpm }, false)} format={(v) => `${v}`} />
          {recBtn}
          {voiceBtn}
          {playBtn}
        </View>
      )}

      <Modal visible={!!sheet} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
        <View style={s.sheet}>
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>{{ ideas: 'Ideas', export: 'Export', voice: 'Voice to notes', settings: 'Sketch settings', all: 'Sketch' }[sheet ?? 'all']}</Text>
            <Btn label="Done" onPress={() => setSheet(null)} />
          </View>
          <ScrollView contentContainerStyle={s.sheetScroll} keyboardShouldPersistTaps="handled">
            {show('ideas') && <Card title="Ideas">
              <View style={s.chips}>
                {store.ideas.map((i) => <Chip key={i.id} label={i.name} on={i.id === idea.id} onPress={() => switchTo(i.id)} />)}
              </View>
              <Row label="Name">
                <TextInput value={idea.name} onChangeText={(name) => commit({ ...idea, name }, false)} style={s.input} placeholder="Name" placeholderTextColor={C.muted} />
              </Row>
              <View style={s.btnRow}>
                <Btn label="+ New idea" onPress={() => { addIdea(freshIdea(store.ideas.length + 1)); setSheet(null); }} />
                <Btn label="Duplicate" onPress={() => addIdea({ ...JSON.parse(JSON.stringify(idea)), id: newId(), name: `${idea.name} copy` })} />
                <Btn label="Delete" disabled={store.ideas.length < 2} onPress={() => {
                  const rest = store.ideas.filter((i) => i.id !== idea.id);
                  persist({ ideas: rest, current: rest[0].id }); setBar(0);
                }} />
              </View>
            </Card>}

            {show('settings') && <Card title="Groove">
              <Row label="Tempo" first><Stepper value={idea.bpm} min={30} max={260} onChange={(bpm) => commit({ ...idea, bpm }, false)} /></Row>
              <Row label="Beats per bar"><Stepper value={idea.beats} min={1} max={12} onChange={(b) => commit(setBeats(idea, b))} /></Row>
              <Row label="Swing" hint="not with triplets"><Stepper value={idea.swing} min={0} max={50} step={5} format={(v) => `${v}%`} onChange={(swing) => commit({ ...idea, swing }, false)} /></Row>
              <Toggle label="Click while playing" value={sk.click} onChange={(click) => setSketch({ click })} />
              <Toggle label="Count under the score" hint="1 e & a" value={sk.count} onChange={(count) => setSketch({ count })} />
            </Card>}

            {show('settings') && <Card title={`Bar ${selBar + 1}`}>
              <View style={s.btnRow}>
                <Btn label="Duplicate" disabled={idea.bars.length >= MAX_BARS} onPress={() => commit(duplicateBar(idea, selBar))} />
                <Btn label="Clear" onPress={() => commit(clearBar(idea, selBar))} />
                <Btn label="Delete" disabled={idea.bars.length < 2} onPress={() => { commit(deleteBar(idea, selBar)); setBar(Math.max(0, selBar - 1)); }} />
              </View>
              <View style={s.btnRow}><Btn label="Clean up empty rows" onPress={() => commit(tidyRows(idea), false)} /></View>
            </Card>}

            {show('settings') && <Card title="Recording">
              <Note>E-drum and Voice both count in one bar, then record over the bars of this idea. Replace writes over them; Layer adds to what's there (kick first, then hats…).</Note>
              <Row label="Mode"><Seg options={[{ value: 'replace', label: 'Replace' }, { value: 'layer', label: 'Layer' }]} value={sk.recMode} onChange={(recMode) => setSketch({ recMode: recMode as 'replace' | 'layer' })} /></Row>
            </Card>}

            {sheet === 'all' && <Card title="Import">
              <Note>A MIDI file (from your module, a DAW or a groove library) becomes a score. Then cycle the grid until it reads right; tap a bar first to change only that bar.</Note>
              <View style={s.btnRow}><Btn label="Import MIDI or Ghostgrid file" onPress={importFile} /></View>
            </Card>}

            {show('voice') && <Card title="Voice to notes">
              <Note>Press Voice, wait for the count-in, and beatbox the groove: “boom” for kick, “ka” or “psh” for snare, “ts” for hi-hat. When you stop, the hits are recognised and written into the bars. Use headphones or Bluetooth so the mic doesn't hear the click; on the phone speaker you only get the count-in.</Note>
              <Row label="Recognition"><Text style={[s.status, own && { color: C.good }]}>{own ? 'Your own sounds' : 'Built-in rules'}</Text></Row>
              <Row label="Mic sensitivity" hint="higher hears softer sounds; lower ignores breaths and room noise">
                <Stepper value={settings.micSens} min={1} max={10} onChange={setMicSens} />
              </Row>
              {staleSamples(sk.voice) && <Note>Recognition was upgraded: teach your sounds again (the old examples are ignored).</Note>}
              {!own && <Note>Teach at least Kick, Snare and Hi-hat closed with your own voice: recognition gets much better.</Note>}
            </Card>}
            {show('voice') && <Card title="Teach your sounds">
              {SOUNDS.map((snd, i) => {
                const n = sk.voice[snd.k]?.length ?? 0;
                return (
                  <Row key={snd.k} label={`${snd.name}${['bd', 'sn', 'hh'].includes(snd.k) ? ' ·' : ''}`} hint={`say “${snd.say}” · ${n ? `${n} examples` : 'not taught'}`} first={i === 0}>
                    <Btn label={taught.includes(snd.k) ? 'Again' : 'Teach'} onPress={() => startTeach(snd.k)} />
                  </Row>
                );
              })}
              <Row label="Ghost notes" hint="snares softer than this share of a normal snare"><Stepper value={sk.ghostPct} min={20} max={70} step={5} format={(v) => `${v}%`} onChange={(ghostPct) => setSketch({ ghostPct })} /></Row>
              {teachWav && <Note>Last teaching take: {teachWav.name}, {teachWav.heard} sound{teachWav.heard === 1 ? '' : 's'} detected in the recording.</Note>}
              <View style={s.btnRow}>
                {teachWav && <Btn label="Share last recording" onPress={() => shareWav(teachWav.uri)} />}
                <Btn label="Forget taught sounds" onPress={() => setSketch({ voice: {} })} />
              </View>
            </Card>}

            {show('export') && <Card title="Export">
              <View style={s.btnRow}>
                <Btn label="PDF score" onPress={() => exportAs('pdf')} />
                <Btn label="MIDI" onPress={() => exportAs('midi')} />
                <Btn label="Text tab" onPress={() => exportAs('txt')} />
                <Btn label="Ghostgrid file" onPress={() => exportAs('gg')} />
              </View>
              <Note>PDF and text tab for reading and printing, MIDI for your DAW or module, a Ghostgrid file to open again in the app (Import).</Note>
            </Card>}
            <Text style={s.footer}>Notation style: {style.name} · change it under Kit & settings</Text>
          </ScrollView>
        </View>
        {teaching && (
          <View style={s.teach}>
            <Text style={s.teachTitle}>{SOUNDS.find((x) => x.k === teaching)!.name}</Text>
            <Text style={s.teachSay}>Say “{SOUNDS.find((x) => x.k === teaching)!.say}” {TEACH_MAX} times, with a short pause in between.</Text>
            <View style={s.teachDots} accessibilityLabel={`${teachCount} of ${TEACH_MAX} heard`}>
              {Array.from({ length: TEACH_MAX }, (_, i) => <View key={i} style={[s.teachDot, i < teachCount && s.teachDotOn]} />)}
            </View>
            <Text style={s.teachCount}>{teachCount ? `${Math.min(teachCount, TEACH_MAX)} heard` : 'listening…'}</Text>
            <View style={s.btnRow}>
              <Btn label="Cancel" onPress={() => finishTeach(false)} />
              <Btn label="Done" primary onPress={() => finishTeach(true)} style={{ minWidth: 140 }} />
            </View>
          </View>
        )}
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
  rec: { minHeight: 52, minWidth: 60, borderRadius: 16, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 8 },
  recOn: { backgroundColor: C.late },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.late },
  recTxt: { color: C.fg, fontSize: 12, fontWeight: '700' },
  sheet: { flex: 1, backgroundColor: C.bg },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  sheetTitle: { color: C.fg, fontSize: 22, fontWeight: '800' },
  sheetScroll: { padding: 16, paddingTop: 0, gap: 14, paddingBottom: 40 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 6 },
  input: { flex: 1, minHeight: 44, color: C.fg, fontSize: 16, textAlign: 'right' },
  footer: { color: C.muted, fontSize: 12, textAlign: 'center' },
  ribbon: { flexDirection: 'row', gap: 4, paddingHorizontal: 12, paddingBottom: 6 },
  ribBtn: { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  ribGlyph: { color: C.accent, fontSize: 17, lineHeight: 20 },
  ribTxt: { color: C.fg, fontSize: 11, fontWeight: '600', marginTop: 1 },
  status: { color: C.fg, fontSize: 15, fontWeight: '600' },
  teach: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, backgroundColor: 'rgba(15,18,20,0.96)', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  teachTitle: { color: C.accent, fontSize: 30, fontWeight: '800', fontFamily: F.display },
  takeRow: { gap: 6, paddingVertical: 6 },
  takeHit: { minWidth: 48, minHeight: 52, borderRadius: 12, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  takeUnsure: { borderWidth: 2, borderColor: C.late },
  takePick: { backgroundColor: C.fg },
  takeLetter: { color: C.fg, fontSize: 18, fontWeight: '800', fontFamily: F.mono },
  takeWhere: { color: C.muted, fontSize: 10, fontVariant: ['tabular-nums'] },
  teachDots: { flexDirection: 'row', gap: 10, paddingTop: 6 },
  teachDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.muted },
  teachDotOn: { backgroundColor: C.accent, borderColor: C.accent },
  teachCount: { color: C.muted, fontSize: 15, fontVariant: ['tabular-nums'] },
  teachSay: { color: C.fg, fontSize: 18, textAlign: 'center', lineHeight: 26 },
});
