/**
 * Songs: import a song (or record it from the room), separate the drums on the phone, and practise with it:
 * the song without drums (you are the drummer), the drums alone (learn the part), slower without changing pitch,
 * and an A–B loop. Stems stay in the app.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  HitLog, barAt, barStarts, barsFrom, beatLengthAt, beatMap, clickTimes, doubleTime, drumHits, halfTime, hitsToIdea, modelBeatMap, modelDrumHits, offsetToBeat, setBeatsPerBar,
  setDownbeatAt, shiftDownbeat, snapToBar, songSections, type BeatMap,
} from '@ghostgrid/core';
import Engine from '../../modules/ghostgrid-engine';
import { CoachPanel } from '../click/CoachPanel';
import type { CoachInput } from '../store';
import { useApp } from '../AppContext';
import { readVoiceFile, saveWav } from '../sketch/usePlayer';
import { addIdeaFromOutside } from '../sketch/ideas';
import { t } from '../i18n';
import {
  BEAT_MODEL_MB, BEAT_MODEL_NAME, BEAT_MODEL_URL, DRUM_MODEL_NAME, DRUM_MODEL_URL, MODEL_MB, MODEL_NAME, MODEL_URL, SPLEETER_MODEL_NAME, deleteSongFiles, ensureDir, fmtTime, loadSongs, newSongId, originalPath, saveSongs, stemPath, toPath,
  type Mix, type Separator, type Song,
} from '../songs/songs';
import { C, F } from '../theme';
import { Btn, Card, Chip, Note, Row, Seg, Stepper, TopBar } from '../ui';

type Progress = { phase: string; progress: number } | null;
const PHASE: Record<string, string> = { decode: 'Reading the song', load: 'Loading the model', separate: 'Separating the drums', write: 'Saving', download: 'Downloading the model' };

export function SongsScreen() {
  const { mic, setMic } = useApp();
  const [songs, setSongs] = useState<Song[]>(loadSongs);
  const [cur, setCur] = useState<string | null>(null);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const playerY = useRef(0);
  // choosing a song from the list brings its player (with the play button) into view
  const pick = (id: string) => { setCur(id); setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, playerY.current - 8), animated: true }), 50); };
  const [model, setModel] = useState(() => Engine.stemsModelStatus(MODEL_NAME));
  // Spleeter ships inside the app (when this build has it): nothing to download
  const spleeter = useMemo(() => Engine.stemsModelStatus(SPLEETER_MODEL_NAME).present, []);
  const [dl, setDl] = useState<Progress>(null);
  const [work, setWork] = useState<{ id: string; p: Progress } | null>(null);
  const [notice, setNotice] = useState(() => {
    // if iOS stopped the app during the last separation, say where (and how much memory there was)
    try {
      const r = Engine.stemsLastRun();
      if (r.phase && !['done', 'error'].includes(r.phase)) {
        const where = t({ decode: 'reading the song', load: 'loading the model', separate: 'separating', write: 'saving' }[r.phase] ?? r.phase);
        const used = (r as { usedByLoadMB?: number }).usedByLoadMB;
        return t('Last time the app was stopped while {{where}} (free memory then: {{mb}} MB{{used}}). Please tell Claude this line.', { where, mb: Math.round(r.freeAfterLoadMB ?? r.freeMB ?? 0), used: used ? t(', loading had used {{mb}} MB', { mb: Math.round(used) }) : '' });
      }
    } catch { /* no record */ }
    return '';
  });
  const [recording, setRecording] = useState<number | null>(null);
  const micWasOff = useRef(false);
  const song = songs.find((s) => s.id === cur) ?? null;

  const update = useCallback((id: string, patch: Partial<Song>) => {
    setSongs((list) => { const next = list.map((s) => (s.id === id ? { ...s, ...patch } : s)); saveSongs(next); return next; });
  }, []);
  const add = (s: Song) => setSongs((list) => { const next = [s, ...list]; saveSongs(next); return next; });

  useEffect(() => {
    const sub = Engine.addListener('onStemsProgress', (e) => {
      if (e.phase === 'download') setDl({ phase: e.phase, progress: e.progress });
      else setWork((w) => (w ? { ...w, p: { phase: e.phase, progress: e.progress } } : w));
    });
    return () => sub.remove();
  }, []);

  // ---- model
  const download = async () => {
    setDl({ phase: 'download', progress: 0 });
    try {
      setModel(await Engine.stemsDownloadModel(MODEL_URL, MODEL_NAME));
      setNotice(t('Model ready. Import a song and tap Separate.'));
    } catch (e) {
      setNotice(t('Download failed: {{msg}}', { msg: (e as Error).message }));
    }
    setDl(null);
  };

  // ---- adding songs
  const importSong = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ['audio/*'], copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const id = newSongId(), ext = (a.name.match(/\.(\w+)$/)?.[1] ?? 'm4a').toLowerCase();
    try {
      const dir = ensureDir(id);
      await new File(a.uri).copy(new File(dir, `original.${ext}`));
      const s: Song = { id, name: a.name.replace(/\.\w+$/, ''), created: Date.now(), source: 'file', original: `original.${ext}`, rate: 1, mix: 'nodrums', drumVol: 1 };
      add(s);
      setCur(id);
      setNotice(t(model.present ? 'Imported. Tap Separate to split off the drums.' : 'Imported. Download the model first, then tap Separate.'));
    } catch (e) {
      setNotice(t('Import failed: {{msg}}', { msg: (e as Error).message }));
    }
  };

  const toggleRecord = async () => {
    if (recording !== null) {
      const f = Engine.stopRecording();
      setRecording(null);
      const id = newSongId();
      try {
        ensureDir(id);
        const data = readVoiceFile(f.path);
        const uri = saveWav(data, f.sampleRate, `rec-${id}.wav`);
        await new File(uri).copy(new File(ensureDir(id), 'original.wav'));
        add({ id, name: t('Room recording {{date}}', { date: new Date().toLocaleDateString() }), created: Date.now(), source: 'mic', original: 'original.wav', duration: data.length / f.sampleRate, rate: 1, mix: 'nodrums', drumVol: 1 });
        setCur(id);
      } catch (e) {
        setNotice(t('Recording failed: {{msg}}', { msg: (e as Error).message }));
      }
      if (micWasOff.current) { micWasOff.current = false; setMic(false); }
      return;
    }
    if (!mic) {
      micWasOff.current = true;
      if (!(await setMic(true))) { micWasOff.current = false; setNotice(t('The microphone is off. Allow it in Settings → Ghostgrid.')); return; }
    }
    if (!Engine.startRecording()) { setNotice(t('The microphone is off.')); return; }
    setRecording(Date.now());
  };
  const [, tick] = useState(0);
  useEffect(() => {
    if (recording === null) return;
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [recording]);

  // ---- separation
  const separate = async (s: Song, which: Separator) => {
    if (which === 'demucs' && !model.present) { setNotice(t('Download the model first.')); return; }
    if (which === 'spleeter' && !spleeter) { setNotice(t("This build doesn't have Spleeter.")); return; }
    Engine.stemsUnload();
    setWork({ id: s.id, p: { phase: 'decode', progress: 0 } });
    try {
      const dir = ensureDir(s.id);
      const r = await Engine.stemsSeparate(originalPath(s), toPath(dir.uri), which === 'spleeter' ? SPLEETER_MODEL_NAME : MODEL_NAME);
      const check = { mixDb: r.mixDb, drumsDb: r.drumsDb, restDb: r.restDb, drumsShare: r.drumsShare, invalid: r.invalid };
      // a new separation means a new drum track: find the beat again
      update(s.id, { separated: true, separator: which, duration: r.duration, error: undefined, check, beatMap: undefined });
      setNotice(r.invalid > 0 ? t('Done, but the model gave {{n}} invalid samples (silenced). Tell Claude.', { n: r.invalid }) : t('Done. Play it without drums, or with drums only.'));
    } catch (e) {
      update(s.id, { error: (e as Error).message });
      setNotice(t('Separation stopped: {{msg}}', { msg: (e as Error).message }));
    }
    setWork(null);
  };

  const remove = (s: Song) => {
    if (cur === s.id) { Engine.stemsUnload(); setCur(null); }
    deleteSongFiles(s.id);
    setSongs((list) => { const next = list.filter((x) => x.id !== s.id); saveSongs(next); return next; });
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <TopBar title="Songs" />
    <ScrollView ref={scrollRef} style={{ backgroundColor: C.bg }} contentContainerStyle={s.scroll}>
      {!!notice && <Text style={s.notice}>{notice}</Text>}

      {!model.present && (
        <Card title="Separation model">
          <Note>{t('Ghostgrid separates the drums on your phone, so your songs never leave it. That needs a model of about {{mb}} MB, downloaded once. Use Wi-Fi.', { mb: MODEL_MB })}</Note>
          {dl ? (
            <>
              <Bar value={dl.progress} />
              <View style={s.btnRow}><Text style={s.dim}>{Math.round(dl.progress * 100)} %</Text><Btn label="Cancel" onPress={() => Engine.stemsCancelDownload()} /></View>
            </>
          ) : <View style={s.btnRow}><Btn label={t('Download model ({{mb}} MB)', { mb: MODEL_MB })} primary onPress={download} style={{ flex: 1 }} /></View>}
        </Card>
      )}

      <View style={s.btnRow}>
        <Btn label="Import song" onPress={importSong} style={{ flex: 1 }} />
        <Btn label={recording !== null ? `${t('Stop')} · ${fmtTime((Date.now() - recording) / 1000)}` : 'Record from room'} active={recording !== null} onPress={toggleRecord} style={{ flex: 1 }} />
      </View>
      {recording !== null && <Note>Play the song on a speaker and hold the phone near it. Files sound better than room recordings.</Note>}

      {song && (
        <View onLayout={(e) => { playerY.current = e.nativeEvent.layout.y; }}>
        <Player key={song.id} song={song} update={update} separating={work?.id === song.id} progress={work?.id === song.id ? work.p : null}
          onSeparate={(which) => separate(song, which)} onCancel={() => Engine.stemsCancel()} onDelete={() => remove(song)} canSeparate={!work} have={{ demucs: model.present, spleeter }} />
        </View>
      )}

      <Card title="Songs">
        {!songs.length && <Note>No songs yet. Import an MP3, M4A or WAV from Files, or record a song playing in the room.</Note>}
        {songs.map((x, i) => (
          <Pressable key={x.id} onPress={() => pick(x.id)} style={[s.songRow, i > 0 && s.line, cur === x.id && { backgroundColor: C.raised }]} accessibilityRole="button">
            <View style={{ flex: 1 }}>
              <Text style={s.songName} numberOfLines={1}>{x.name}</Text>
              <Text style={s.dim}>{x.duration ? fmtTime(x.duration) : '–'} · {t(work?.id === x.id ? 'separating…' : x.separated ? 'drums separated' : x.error ? 'not separated (stopped)' : 'not separated yet')}{x.source === 'mic' ? ` · ${t('room recording')}` : ''}{work?.id === x.id && work.p?.phase === 'separate' ? ` ${Math.round(work.p.progress * 100)} %` : ''}</Text>
            </View>
            <Text style={[s.badge, x.separated && { color: C.good }]}>{x.separated ? '✓' : '○'}</Text>
          </Pressable>
        ))}
      </Card>

      {model.present && (
        <Card title="Model">
          <Row label="HT-Demucs drums" hint={t('{{mb}} MB on this phone', { mb: Math.round(model.bytes / 1e6) })} first>
            <Btn label="Remove" onPress={() => { Engine.stemsDeleteModel(MODEL_NAME); setModel(Engine.stemsModelStatus(MODEL_NAME)); }} />
          </Row>
          <Note>{t("For your own practice. Stems stay in the app and can't be exported. Free memory now: {{mb}} MB.", { mb: Math.round(Engine.stemsFreeMemoryMB()) })}</Note>
        </Card>
      )}
    </ScrollView>
    </View>
  );
}

function Player({ song, update, separating, progress, onSeparate, onCancel, onDelete, canSeparate, have }: {
  song: Song; update: (id: string, p: Partial<Song>) => void; separating: boolean; progress: Progress;
  onSeparate: (which: Separator) => void; onCancel: () => void; onDelete: () => void; canSeparate: boolean; have: { demucs: boolean; spleeter: boolean };
}) {
  const chosen: Separator = song.separator ?? (have.demucs || !have.spleeter ? 'demucs' : 'spleeter');
  const canChosen = canSeparate && have[chosen];
  const { info, on, mic, setMic, settings, micLevel, goTab } = useApp();
  const [scoring, setScoring] = useState(false);
  const [dur, setDur] = useState(song.duration ?? 0);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [analysing, setAnalysing] = useState(false);
  const [clickReady, setClickReady] = useState(false);
  const mix: Mix = song.separated ? song.mix ?? 'nodrums' : song.mix === 'silent' ? 'silent' : 'full';
  const rate = song.rate ?? 1, drumVol = song.drumVol ?? 1, clickVol = song.clickVol ?? 0.8;
  const map = song.beatMap ?? null;
  const A = song.loopA ?? 0, B = song.loopB ?? dur, loopOn = !!song.loop && B - A > 0.3;
  const bars = useMemo(() => (map ? barStarts(map) : []), [map]);

  // load the files into the player
  useEffect(() => {
    if (separating) return;
    let alive = true;
    setReady(false);
    setClickReady(false);
    const load = song.separated ? Engine.stemsLoad(stemPath(song, 'drums'), stemPath(song, 'nodrums')) : Engine.stemsLoad(null, originalPath(song));
    load.then((d) => {
      if (!alive) return;
      setDur(d); setReady(true);
      if (!song.duration) update(song.id, { duration: d });
    }).catch(() => setReady(false));
    return () => { alive = false; Engine.stemsPause(); setPlaying(false); };
  }, [song.id, song.separated, separating]); // eslint-disable-line react-hooks/exhaustive-deps

  // the beat model (82 MB, downloaded once on request) finds the beats and the "1" in the whole song
  const [beatModel, setBeatModel] = useState(() => Engine.stemsModelStatus(BEAT_MODEL_NAME).present);
  const [beatDl, setBeatDl] = useState<number | null>(null);
  useEffect(() => {
    const sub = Engine.addListener('onStemsProgress', (e) => { if (e.phase === 'download') setBeatDl((d) => (d === null ? d : e.progress)); });
    return () => sub.remove();
  }, []);

  // find beats and bars once (with the beat model when it is on the phone, else in the drum track); again after "Find again"
  const analyse = useCallback(async () => {
    setAnalysing(true);
    try {
      const haveModel = Engine.stemsModelStatus(BEAT_MODEL_NAME).present;
      if (haveModel) {
        try {
          const r = await Engine.stemsBeatLogits(originalPath(song), BEAT_MODEL_NAME);
          const m = modelBeatMap(r.beat, r.down, r.rate);
          if (m) { update(song.id, { beatMap: m }); setAnalysing(false); return; }
        } catch { /* fall back to the drum track below */ }
      }
      const env = await Engine.stemsEnvelope(song.separated ? stemPath(song, 'drums') : originalPath(song));
      // the "1" comes from the music: chord changes and bass notes, in the track without drums (or the whole song)
      let music: Awaited<ReturnType<typeof Engine.stemsMusicFeatures>> | undefined;
      try { music = await Engine.stemsMusicFeatures(song.separated ? stemPath(song, 'nodrums') : originalPath(song)); } catch { music = undefined; }
      // v 4 when the model was tried, so the map isn't redone every time the song opens
      update(song.id, { beatMap: { ...beatMap(env, map?.beatsPerBar ?? 4, music), source: song.separated ? 'drums' : 'mix', v: haveModel ? 4 : 3 } });
    } catch (e) {
      setErr(t("Couldn't find the beat: {{msg}}", { msg: (e as Error).message }));
    }
    setAnalysing(false);
  }, [song, map?.beatsPerBar, update]);
  const getBeatModel = async () => {
    setBeatDl(0); setErr('');
    try {
      await Engine.stemsDownloadModel(BEAT_MODEL_URL, BEAT_MODEL_NAME);
      setBeatModel(true);
      setBeatDl(null);
      analyse();
      return;
    } catch (e) {
      setErr(t('Download failed: {{msg}}', { msg: (e as Error).message }));
    }
    setBeatDl(null);
  };
  // parts of the song (A, B, C…): found once per beat map, from the chords and loudness of the music
  const sectionsKey = map && bars.length ? `${bars.length}:${bars[0].toFixed(2)}:${map.beatsPerBar}` : '';
  useEffect(() => {
    if (!ready || !sectionsKey || separating || song.sectionsKey?.startsWith(`${sectionsKey}:`)) return;
    let alive = true;
    // the whole song (drums included): how the arrangement sounds is what tells verse from chorus
    (async () => {
      const m = await Engine.stemsMusicFeatures(originalPath(song));
      let env: Awaited<ReturnType<typeof Engine.stemsEnvelope>> | undefined;
      try { env = await Engine.stemsEnvelope(originalPath(song)); } catch { env = undefined; }
      if (alive) update(song.id, { sections: songSections(m, bars, dur, env), sectionsKey: `${sectionsKey}:${m.mel ? 't' : 'c'}` });
    })().catch(() => { if (alive) update(song.id, { sections: [], sectionsKey }); });
    return () => { alive = false; };
  }, [ready, sectionsKey, separating]); // eslint-disable-line react-hooks/exhaustive-deps
  const sections = song.sections ?? [];
  const nameOf = (l: string) => song.sectionNames?.[l]?.trim() || l;
  const [renaming, setRenaming] = useState<string | null>(null);
  const inSection = (x: { from: number; to: number }) => loopOn && Math.abs(A - bars[x.from]) < 0.05 && x.to - 1 < bars.length && Math.abs(B - barsFrom(map!, bars[x.from], x.to - x.from, dur)) < 0.05;

  useEffect(() => {
    if (ready && !map && !analysing && !separating) analyse();
  }, [ready, map, separating]); // eslint-disable-line react-hooks/exhaustive-deps
  // a separated drum track beats the full mix for finding the beat: redo an old map once
  useEffect(() => {
    // redo maps from the whole mix, from before the "1" came from the music, or from before the beat model (unless fixed by hand)
    if (ready && map && !map.edited && ((song.separated && map.source === 'mix') || (map.v ?? 0) < 3 || (beatModel && (map.v ?? 0) < 4))) analyse();
  }, [ready, song.separated]); // eslint-disable-line react-hooks/exhaustive-deps

  // the click track follows the beat map
  useEffect(() => {
    if (!ready || !map || !dur) return;
    let alive = true;
    const clicks = clickTimes(map);
    Engine.stemsWriteClick(stemPath(song, 'click'), dur, clicks.map((c) => c.t), clicks.map((c) => c.accent))
      .then(() => { if (alive) setClickReady(true); })
      .catch(() => setClickReady(false));
    return () => { alive = false; };
  }, [ready, map, dur]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready) return;
    try { Engine.stemsSetClick(song.click && clickReady ? stemPath(song, 'click') : null); } catch { /* applied on next load */ }
  }, [ready, song.click, clickReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // mix, speed and loop follow the settings
  useEffect(() => {
    if (!ready) return;
    const d = mix === 'nodrums' || mix === 'silent' ? 0 : mix === 'drums' ? 1 : drumVol, r = mix === 'drums' || mix === 'silent' ? 0 : 1;
    Engine.stemsSetVolumes(d, r, song.click ? clickVol : 0);
  }, [ready, mix, drumVol, clickVol, song.click]);
  useEffect(() => { if (ready) Engine.stemsSetRate(rate); }, [ready, rate]);
  useEffect(() => { if (ready) { try { Engine.stemsSetLoop(A, B, loopOn); } catch { /* applied on next play */ } } }, [ready, A, B, loopOn]);

  // playhead
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setPos(Engine.stemsPosition());
      if (!Engine.stemsIsPlaying()) setPlaying(false);
    }, 100);
    return () => clearInterval(t);
  }, [playing]);

  const toggle = () => {
    if (!ready) return;
    if (playing) { Engine.stemsPause(); setPlaying(false); setPos(Engine.stemsPosition()); return; }
    try {
      const ci = song.countIn ?? 0;
      if (ci > 0 && map) {
        // start on a bar line, so the count-in lands on the "1"
        let from = loopOn && (pos < A || pos >= B) ? A : pos;
        const prev = bars.filter((b) => b <= from + 0.05);
        if (prev.length) from = prev[prev.length - 1];
        Engine.stemsSeek(from);
        setPos(from);
        Engine.stemsPlayCountIn(ci * map.beatsPerBar, beatLengthAt(map, from + 0.01) / rate);
      } else {
        Engine.stemsPlay();
      }
      setPlaying(true); setErr('');
    } catch (e) { setErr(t("Couldn't play: {{msg}}", { msg: (e as Error).message })); }
  };
  const seek = (at: number) => {
    const v = Math.max(0, Math.min(dur, at));
    try { Engine.stemsSeek(v); } catch (e) { setErr(t("Couldn't jump there: {{msg}}", { msg: (e as Error).message })); }
    setPos(v);
  };

  // ---- A–B loop on bar lines
  const snap = (t: number) => (map ? snapToBar(map, t) : t);
  const setA = () => {
    const a = snap(pos);
    const b = song.loopB !== undefined && song.loopB > a + 0.5 ? song.loopB : map ? barsFrom(map, a, 4, dur) : Math.min(dur, a + 8);
    update(song.id, { loopA: a, loopB: b, loop: true });
  };
  const setB = () => {
    const b = snap(pos);
    const a = Math.min(song.loopA ?? 0, b - 0.5);
    update(song.id, { loopA: Math.max(0, a), loopB: b, loop: true });
  };
  const loopBars = (n: number) => {
    if (!map) return;
    const a = snap(song.loop ? A : pos);
    update(song.id, { loopA: a, loopB: barsFrom(map, a, n, dur), loop: true });
  };

  // loop from bar X to bar Y (1-based, both included)
  const loopFrom = bars.length && map ? barAt(map, A + 0.01) + 1 : 1;
  const loopTo = bars.length && map ? Math.max(barAt(map, B - 0.01) + 1, loopFrom) : 1;
  const setBarRange = (from: number, to: number) => {
    if (!map || !bars.length) return;
    const f = Math.max(1, Math.min(bars.length, from)), e = Math.max(f, Math.min(bars.length, to));
    update(song.id, { loopA: bars[f - 1], loopB: barsFrom(map, bars[f - 1], e - f + 1, dur), loop: true });
  };

  // ---- timing coach against the song's beat
  // drums to score: the loop (or the whole song) from the drum track, opened as a new idea in Sketch
  const toScore = async () => {
    if (!map || !song.separated) return;
    if (playing) { Engine.stemsPause(); setPlaying(false); }
    setScoring(true); setErr('');
    try {
      const env = await Engine.stemsEnvelope(stemPath(song, 'drums'));
      if (!env.mid || !env.high) throw new Error('this needs the newest version of the app');
      const name = `${song.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 28)}${loopOn ? ` · bars ${barAt(map, A + 0.01) + 1}–${barAt(map, B - 0.01) + 1}` : ''}`;
      // the drum model (downloaded once, 6 MB) for kick, snare, toms and cymbals; the band detector alone if that fails
      let hits: ReturnType<typeof drumHits>, model: { t: number; c: number; p: number; v: number }[] | null = null;
      try {
        if (!Engine.stemsModelStatus(DRUM_MODEL_NAME).present) await Engine.stemsDownloadModel(DRUM_MODEL_URL, DRUM_MODEL_NAME);
        const m = await Engine.stemsTranscribe(stemPath(song, 'drums'), DRUM_MODEL_NAME);
        model = m.t.map((t, i) => ({ t, c: m.c[i], p: m.p[i], v: m.v[i] }));
        hits = modelDrumHits(model, env);
      } catch {
        hits = drumHits(env);
      }
      lastScan.current = { env, hits, model };
      const r = hitsToIdea(hits, map, loopOn ? A : 0, loopOn ? B : dur, name);
      if (!r.notes) throw new Error('no drum hits found there');
      const raw = r.idea.raw ?? [];
      const n = (id: string, v?: number) => raw.filter((x) => x.id === id && (v === undefined || x.v === v)).length;
      addIdeaFromOutside(r.idea, t('From the song: {{bd}} kicks, {{sn}} snares ({{g}} ghost), {{hh}} hi-hats, {{tom}} toms, {{cy}} cymbals in {{bars}} bars{{cut}}. Not right? Share the analysis from Songs.', { bd: n('bd'), sn: n('sn'), g: n('sn', 3), hh: n('hh'), tom: n('t1') + n('t2') + n('ft'), cy: n('cr') + n('rd'), bars: r.bars, cut: r.truncated ? t(' (first 192)') : '' }));
      setScoring(false);
      goTab('sketch');
      return;
    } catch (e) {
      setErr(t("Couldn't make a score: {{msg}}", { msg: (e as Error).message }));
    }
    setScoring(false);
  };
  // what the last "to score" saw, to send for a closer look: loudness per band (100 per second), the beat map and the hits.
  // Not the audio: the song can't be rebuilt from it.
  const lastScan = useRef<{ env: Awaited<ReturnType<typeof Engine.stemsEnvelope>>; hits: ReturnType<typeof drumHits>; model: { t: number; c: number; p: number; v: number }[] | null } | null>(null);
  const shareScan = async () => {
    const sc = lastScan.current;
    if (!sc || !map) return;
    const r4 = (a?: number[]) => (a ?? []).map((x) => Math.round(x * 1e4) / 1e4);
    const data = { app: 'ghostgrid', kind: 'drum-scan', v: 2, song: song.name, loop: loopOn ? [A, B] : null, map,
      env: { rate: sc.env.rate, full: r4(sc.env.full), low: r4(sc.env.low), mid: r4(sc.env.mid), high: r4(sc.env.high) },
      hits: sc.hits.map((h) => [Math.round(h.t * 1000) / 1000, h.id, h.v]),
      model: sc.model?.map((h) => [h.t, h.c, Math.round(h.p * 100) / 100, Math.round(h.v * 100) / 100]) ?? null };
    try {
      const f = new File(Paths.cache, `ghostgrid-drum-scan.json`);
      f.write(JSON.stringify(data));
      await Sharing.shareAsync(f.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Ghostgrid drum analysis' });
    } catch (e) { setErr(t("Couldn't share: {{msg}}", { msg: (e as Error).message })); }
  };
  const [, bump] = useState(0);
  const logRef = useRef(new HitLog());
  const [last, setLast] = useState<number | null>(null);
  const coachInput: CoachInput = song.coachInput ?? 'pads';
  const R = useRef({ map, rate, outLat: 0, calib: settings.click.calib, grade: song.grade ?? 1, coach: !!song.coach, playing });
  R.current = { map, rate, outLat: info?.outputLatency ?? 0, calib: settings.click.calib, grade: song.grade ?? 1, coach: !!song.coach, playing };
  const scoreHit = useCallback((t: number, input: CoachInput, pad: string) => {
    const r = R.current;
    if (!r.coach || !r.map || !r.playing) return;
    // the device's delay comes off before matching the hit to a beat (see the Click coach)
    const songT = Engine.stemsSongTimeAt(t - r.outLat + r.calib[input] / 1000);
    if (songT < 0) return;
    const off = offsetToBeat(r.map, songT, r.grade);
    if (off === null) return;
    const ms = off / r.rate;
    logRef.current.add(ms, pad, undefined, barAt(r.map, songT) + 1);
    setLast(ms);
    bump((x) => x + 1);
  }, []);
  useEffect(() => {
    const offs = [
      on('pad', (e) => { if (coachInput === 'pads') scoreHit(e.time, 'pads', e.key); }),
      on('mic', (e) => { if (coachInput === 'mic') scoreHit(e.time, 'mic', 'mic'); }),
    ];
    return () => offs.forEach((f) => f());
  }, [on, scoreHit, coachInput]);
  const tap = (ms: number) => {
    const now = Engine.now();
    let t = Engine.uptimeToEngine(ms / 1000);
    if (!isFinite(t) || Math.abs(t - now) > 1.5) t = now;
    scoreHit(t, 'tap', 'tap');
  };
  const setCoachInput = async (v: CoachInput) => {
    update(song.id, { coachInput: v });
    // switching the mic on restarts the audio, which stops the song: do it before pressing Play
    if (v === 'mic' && !mic) { if (playing) { Engine.stemsPause(); setPlaying(false); } await setMic(true); }
    if (v !== 'mic' && mic) await setMic(false);
  };

  const barNow = map ? barAt(map, pos) : -1;

  // levels check for songs separated before the report existed
  useEffect(() => {
    if (!ready || !song.separated || song.check) return;
    let alive = true;
    Promise.all([Engine.stemsLevels(originalPath(song)), Engine.stemsLevels(stemPath(song, 'drums')), Engine.stemsLevels(stemPath(song, 'nodrums'))])
      .then(([m, d, r]) => {
        if (!alive) return;
        const share = 10 ** ((d.db - m.db) / 10);
        update(song.id, { check: { mixDb: m.db, drumsDb: d.db, restDb: r.db, drumsShare: share, invalid: d.invalid + r.invalid } });
      }).catch(() => {});
    return () => { alive = false; };
  }, [ready, song.separated, song.check]); // eslint-disable-line react-hooks/exhaustive-deps
  const chk = song.check;
  // the less-used controls sit in folds, closed until asked for
  const [fold, setFold] = useState<Record<string, boolean>>({});
  const toggleFold = (k: string) => setFold((f) => ({ ...f, [k]: !f[k] }));
  const suspicious = !!chk && (chk.invalid > 0 || chk.drumsShare > 0.6 || chk.drumsDb < chk.mixDb - 35);

  return (
    <Card title={song.name}>
      {song.separated && separating && (
        <>
          <Text style={s.phase}>{t(PHASE[progress?.phase ?? 'decode'] ?? '')}{progress?.phase === 'separate' ? ` · ${Math.round(progress.progress * 100)} %` : '…'}</Text>
          <Bar value={progress?.phase === 'separate' ? progress.progress : progress?.phase === 'write' ? 1 : 0.02} />
          <View style={s.btnRow}><Btn label="Cancel" onPress={onCancel} /></View>
        </>
      )}
      {!song.separated && (
        separating ? (
          <>
            <Text style={s.phase}>{t(PHASE[progress?.phase ?? 'decode'] ?? '')}{progress?.phase === 'separate' ? ` · ${Math.round(progress.progress * 100)} %` : '…'}</Text>
            <Bar value={progress?.phase === 'separate' ? progress.progress : progress?.phase === 'write' ? 1 : 0.02} />
            <Note>This takes a while: roughly the length of the song or a bit longer. Keep the app open.</Note>
            <View style={s.btnRow}><Btn label="Cancel" onPress={onCancel} /></View>
          </>
        ) : (
          <>
            <Note>{song.error ? t('Last try stopped: {{msg}}', { msg: song.error }) : t('Separate the drums to practise without them, or with drums only.')}</Note>
            {have.spleeter && (
              <>
                <View style={s.btnRow}>
                  <Seg small options={[{ value: 'demucs', label: t('Demucs (best quality)') }, { value: 'spleeter', label: t('Spleeter (lighter)') }]} value={chosen}
                    onChange={(v) => update(song.id, { separator: v as Separator })} />
                </View>
                <Note>{chosen === 'spleeter' ? t('Spleeter is lighter and faster but less clean: more of the band stays in the drums. Fine for playing along; for a score Demucs finds many more hits.') : t('Demucs separates best, but only for your own practice: the licence of its weights is unclear. It needs its 316 MB model on the phone.')}</Note>
              </>
            )}
            <View style={s.btnRow}><Btn label="Separate drums" primary disabled={!canChosen} onPress={() => onSeparate(chosen)} style={{ flex: 1 }} /></View>
          </>
        )
      )}

      {!!err && <Text style={s.err}>{err}</Text>}
      {song.separated && chk && (
        <Text style={[s.dim, suspicious && { color: C.late }]}>
          {t('Separation check: drums {{d}} dB · rest {{r}} dB · song {{m}} dB · drums are {{pct}} % of the sound', { d: Math.round(chk.drumsDb), r: Math.round(chk.restDb), m: Math.round(chk.mixDb), pct: Math.round(chk.drumsShare * 100) })}
          {chk.invalid > 0 ? ` · ${t('{{n}} invalid samples', { n: chk.invalid })}` : ''}{suspicious ? ` · ${t('this looks wrong, please tell Claude these numbers')}` : ''}
        </Text>
      )}
      <Timeline pos={pos} dur={dur} a={song.loop ? A : null} b={song.loop ? B : null} bars={bars} onSeek={seek} />
      <View style={s.timeRow}>
        <Text style={s.time}>{fmtTime(pos)}{barNow >= 0 ? `  ·  ${t('bar {{n}}', { n: barNow + 1 })}` : ''}</Text>
        <Text style={s.time}>{fmtTime(dur)}{bars.length ? `  ·  ${t('{{count}} bars', { count: bars.length })}` : ''}</Text>
      </View>

      <View style={s.transport}>
        <Btn label="↺" onPress={() => { seek(loopOn ? A : 0); logRef.current.reset(); setLast(null); bump((x) => x + 1); }} />
        <Btn label="−5 s" onPress={() => seek(pos - 5)} />
        <Btn label={playing ? 'Pause' : 'Play'} primary active={playing} disabled={!ready || separating} onPress={toggle} style={{ flex: 1 }} />
        <Btn label="+5 s" onPress={() => seek(pos + 5)} />
      </View>

      {song.coach && (
        <CoachPanel input={coachInput} running={playing} last={last} log={logRef.current} tol={settings.click.tol}
          view={settings.click.coachView} totalBars={bars.length}
          calibrating={null} calibCount={0} micLevel={micLevel} onTap={tap}
          onReset={() => { logRef.current.reset(); setLast(null); bump((x) => x + 1); }} />
      )}

      <Row label="Listen to" first>
        <Seg small options={song.separated
          ? [{ value: 'nodrums', label: 'No drums' }, { value: 'full', label: 'Full' }, { value: 'drums', label: 'Drums' }, { value: 'silent', label: 'Click' }]
          : [{ value: 'full', label: 'Song' }, { value: 'silent', label: 'Click only' }]}
          value={mix} onChange={(m) => update(song.id, { mix: m as Mix, ...(m === 'silent' ? { click: true } : {}) })} />
      </Row>
      {song.separated && mix === 'full' && (
        <Row label="Drums volume"><Stepper value={Math.round(drumVol * 100)} min={0} max={100} step={10} format={(v) => `${v}%`} onChange={(v) => update(song.id, { drumVol: v / 100 })} /></Row>
      )}
      <Row label="Speed" hint="slower without changing pitch">
        <Stepper value={Math.round(rate * 100)} min={50} max={125} step={5} format={(v) => `${v}%`} onChange={(v) => update(song.id, { rate: v / 100 })} />
      </Row>

      <Row label="Click" hint={map ? 'follows the song, accent on the 1' : analysing ? 'finding the beat…' : 'needs the beat map'}>
        <View style={s.inline}>
          {song.click && <Stepper value={Math.round(clickVol * 100)} min={10} max={100} step={10} format={(v) => `${v}%`} onChange={(v) => update(song.id, { clickVol: v / 100 })} />}
          <Btn label={song.click ? 'On' : 'Off'} active={!!song.click} disabled={!map} onPress={() => update(song.id, { click: !song.click })} />
        </View>
      </Row>
      {!!song.click && (
        <Row label="Count-in" hint="before Play, from the bar you're in">
          <Seg small options={[{ value: 0, label: 'Off' }, { value: 1, label: '1 bar' }, { value: 2, label: '2 bars' }]} value={song.countIn ?? 0}
            onChange={(v) => update(song.id, { countIn: v as number })} />
        </Row>
      )}

      <Row label="Loop" hint={song.loop ? `${fmtTime(A)} – ${fmtTime(B)}${map ? ` · ${t('bars {{a}}–{{b}}', { a: barAt(map, A + 0.01) + 1, b: barAt(map, B - 0.01) + 1 })}` : ''}` : map ? 'A and B snap to bar lines' : 'set A and B while it plays'}>
        <View style={s.inline}>
          <Btn label="A" onPress={setA} />
          <Btn label="B" onPress={setB} />
          <Btn label={song.loop ? 'Off' : 'On'} active={!!song.loop} onPress={() => update(song.id, { loop: !song.loop })} />
        </View>
      </Row>
      {map && sections.length > 1 && (
        <View style={s.chipsRow}>
          <Text style={s.dim}>{t('Parts:')}</Text>
          {sections.map((x, i) => (
            <Chip key={i} label={`${nameOf(x.letter)} · ${x.from + 1}–${x.to}`} on={inSection(x)}
              onPress={() => { setBarRange(x.from + 1, x.to); setRenaming(x.letter); }} />
          ))}
        </View>
      )}
      {renaming && sections.some((x) => x.letter === renaming) && (
        <Row label={t('Name of part {{l}}', { l: renaming })} hint="every part with this letter gets the name">
          <TextInput value={song.sectionNames?.[renaming] ?? ''} placeholder={renaming} placeholderTextColor={C.muted} style={s.nameInput}
            onChangeText={(v) => update(song.id, { sectionNames: { ...song.sectionNames, [renaming]: v.slice(0, 16) } })} />
        </Row>
      )}
      {map && song.loop && bars.length > 0 && (
        <>
          <Row label="From bar"><Stepper value={loopFrom} min={1} max={bars.length} step={1} format={(v) => `${v}`} onChange={(v) => setBarRange(v, Math.max(v, loopTo))} /></Row>
          <Row label="To bar"><Stepper value={loopTo} min={1} max={bars.length} step={1} format={(v) => `${v}`} onChange={(v) => setBarRange(loopFrom, v)} /></Row>
        </>
      )}
      {map && (
        <View style={s.chipsRow}>
          <Text style={s.dim}>{t('Loop length:')}</Text>
          {[1, 2, 4, 8].map((n) => <Btn key={n} label={t('{{count}} bars', { count: n })} onPress={() => loopBars(n)} />)}
        </View>
      )}

      <Fold title="Make a score" open={!!fold.score} onToggle={() => toggleFold('score')}>
      <Row label="Drums to score" first hint={!song.separated ? 'separate the drums first' : !map ? 'waiting for the beat map' : loopOn ? 'the loop, opened in Sketch' : 'the whole song (up to 192 bars), opened in Sketch'}>
        <Btn label={scoring ? 'Writing…' : loopOn ? 'Loop to score' : 'Song to score'} disabled={!song.separated || !map || scoring} onPress={toScore} />
      </Row>
      {song.separated && song.separator === 'spleeter' && (
        <Row label="Better notation" hint={have.demucs ? 'Spleeter is quick but leaves more of the band in the drums, so the score misses hits. Demucs redoes the stems (this replaces them), then press "Song to score" again.' : 'Spleeter leaves more of the band in the drums, so the score misses hits. Download the Demucs model (in a song that is not separated yet) to redo it.'}>
          <Btn label="Redo with Demucs" disabled={!canSeparate || !have.demucs} onPress={() => onSeparate('demucs')} />
        </Row>
      )}
      {!!lastScan.current && (
        <View style={s.chipsRow}>
          <Text style={s.dim}>{t('Score not right?')}</Text>
          <Btn label="Share analysis" onPress={shareScan} />
        </View>
      )}
      </Fold>

      <Fold title="Score my timing" summary={song.coach ? 'On' : 'Off'} open={!!fold.coach} onToggle={() => toggleFold('coach')}>
      <Row label="Score my timing" first hint="against the song's beat">
        <Btn label={song.coach ? 'On' : 'Off'} active={!!song.coach} disabled={!map} onPress={() => update(song.id, { coach: !song.coach })} />
      </Row>
      {song.coach && (
        <>
          <Row label="Input"><Seg small options={[{ value: 'pads', label: 'E-drum' }, { value: 'mic', label: 'Mic' }, { value: 'tap', label: 'Tap' }]} value={coachInput} onChange={(v) => setCoachInput(v as CoachInput)} /></Row>
          <Row label="Grade against"><Seg small options={[{ value: 1, label: 'Beats' }, { value: 2, label: '8ths' }, { value: 4, label: '16ths' }]} value={song.grade ?? 1} onChange={(v) => update(song.id, { grade: v as 1 | 2 | 4 })} /></Row>
          {coachInput === 'mic' && <Note>Use headphones or Bluetooth so the mic hears your drums, not the song.</Note>}
        </>
      )}
      </Fold>

      <Fold title="Beat and bars" summary={map ? `${Math.round(60 / beatLengthAt(map, pos) )} BPM · ${map.beatsPerBar}/4` : undefined} open={!!fold.beat} onToggle={() => toggleFold('beat')}>
      <BeatMapCard map={map} analysing={analysing} pos={pos} onChange={(m) => update(song.id, { beatMap: m })} onAgain={analyse} model={{ present: beatModel, progress: beatDl, onGet: getBeatModel }} />
      </Fold>

      <Fold title="Song options" open={!!fold.song} onToggle={() => toggleFold('song')}>
        <View style={s.btnRow}>
          {song.separated && <Btn label="Separate again" disabled={!canChosen} onPress={() => onSeparate(chosen)} />}
          <Btn label="Delete song" onPress={onDelete} />
        </View>
      </Fold>
    </Card>
  );
}

/** A section that opens and closes: a title row (with a short summary) and, when open, its controls. */
function Fold({ title, summary, open, onToggle, children }: { title: string; summary?: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <View style={s.fold}>
      <Pressable onPress={onToggle} style={s.foldHead} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={t(title)}>
        <Text style={s.foldTitle}>{t(title)}</Text>
        {!!summary && <Text style={s.dim}>{t(summary)}</Text>}
        <View style={{ flex: 1 }} />
        <Text style={s.foldChev}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && <View>{children}</View>}
    </View>
  );
}

/** What the app found, and how to fix it: the "1", beats per bar, half or double tempo. */
function BeatMapCard({ map, analysing, pos, onChange, onAgain, model }: {
  map: BeatMap | null; analysing: boolean; pos: number; onChange: (m: BeatMap) => void; onAgain: () => void;
  model: { present: boolean; progress: number | null; onGet: () => void };
}) {
  if (analysing) return <Note>Finding the beat and the bars…</Note>;
  const offer = model.present ? null : model.progress !== null
    ? <Note>{t('Downloading the beat model… {{pct}}%', { pct: Math.round(model.progress * 100) })}</Note>
    : (
      <View>
        <Note>{t('A beat model that also finds where the bars start ({{mb}} MB, downloaded once, stays on your phone).', { mb: BEAT_MODEL_MB })}</Note>
        <View style={s.btnRow}><Btn label="Get the beat model" onPress={model.onGet} /></View>
      </View>
    );
  if (!map) return <View><View style={s.btnRow}><Btn label="Find the beat" onPress={onAgain} /></View>{offer}</View>;
  return (
    <View style={s.beatBox}>
      <Text style={s.beatTitle}>{t('Beat map · about {{bpm}} BPM', { bpm: Math.round(map.bpm) })} · {map.beatsPerBar}/4{map.edited ? ` · ${t('fixed by hand')}` : ''}</Text>
      <Note>{t('Click sounds wrong? Fix it here: put the "1" where the bar starts, or halve or double the tempo.')}</Note>
      <View style={s.btnRow}>
        <Btn label="The 1 is here" onPress={() => onChange(setDownbeatAt(map, pos))} />
        <Btn label="1 beat later" onPress={() => onChange(shiftDownbeat(map, 1))} />
        <Btn label="½ tempo" onPress={() => onChange(halfTime(map))} />
        <Btn label="2× tempo" onPress={() => onChange(doubleTime(map))} />
      </View>
      <View style={s.btnRow}>
        <Seg small options={[3, 4, 5, 6, 7].map((n) => ({ value: n, label: `${n}/4` }))} value={map.beatsPerBar} onChange={(n) => onChange(setBeatsPerBar(map, n as number))} />
        <Btn label="Find again" onPress={onAgain} />
      </View>
      {offer}
    </View>
  );
}

/** Song position bar: tap or drag to move; shows bar lines and the A–B loop. */
function Timeline({ pos, dur, a, b, bars, onSeek }: { pos: number; dur: number; a: number | null; b: number | null; bars: number[]; onSeek: (t: number) => void }) {
  const w = useRef(1);
  const d = useRef(dur);
  d.current = dur;
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => seekRef.current((e.nativeEvent.locationX / w.current) * d.current),
    onPanResponderMove: (e) => seekRef.current((e.nativeEvent.locationX / w.current) * d.current),
    onPanResponderTerminationRequest: () => false,
  })).current;
  const pct = (t: number) => `${dur > 0 ? Math.max(0, Math.min(100, (t / dur) * 100)) : 0}%` as const;
  const every = bars.length > 160 ? 8 : bars.length > 80 ? 4 : bars.length > 40 ? 2 : 1;
  return (
    <View {...pan.panHandlers} onLayout={(e) => { w.current = e.nativeEvent.layout.width || 1; }} style={s.timeline}
      accessible accessibilityRole="adjustable" accessibilityLabel={`Position ${fmtTime(pos)} of ${fmtTime(dur)}`}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onSeek(pos + (e.nativeEvent.actionName === 'increment' ? 5 : -5))}>
      <View style={s.ticks} pointerEvents="none">
        {bars.map((t, i) => (i % every === 0 ? <View key={i} style={[s.tick, (i / every) % 4 === 0 && s.tickBig, { left: pct(t) }]} /> : null))}
      </View>
      <View style={s.track} pointerEvents="none">
        {a !== null && b !== null && <View style={[s.loop, { left: pct(a), width: `${dur > 0 ? ((b - a) / dur) * 100 : 0}%` }]} />}
        <View style={[s.fill, { width: pct(pos) }]} />
        <View style={[s.knob, { left: pct(pos) }]} />
      </View>
    </View>
  );
}

function Bar({ value }: { value: number }) {
  return <View style={s.bar}><View style={[s.barFill, { width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }]} /></View>;
}

const s = StyleSheet.create({
  scroll: { padding: 16, gap: 14, paddingBottom: 32 },
  notice: { color: C.accent, fontSize: 14 },
  err: { color: C.late, fontSize: 14 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 6, alignItems: 'center' },
  dim: { color: C.muted, fontSize: 12 },
  nameInput: { minHeight: 40, minWidth: 120, color: C.fg, fontSize: 16, textAlign: 'right' },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 6, borderRadius: 10 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  songName: { color: C.fg, fontSize: 15, fontWeight: '600' },
  badge: { color: C.muted, fontSize: 18, width: 24, textAlign: 'center' },
  phase: { color: C.fg, fontSize: 15, fontWeight: '600', paddingTop: 4 },
  timeline: { height: 52, justifyContent: 'center' },
  ticks: { position: 'absolute', left: 0, right: 0, top: 4, height: 10 },
  tick: { position: 'absolute', width: 1, height: 6, backgroundColor: C.muted, opacity: 0.6 },
  tickBig: { height: 10, opacity: 1 },
  fold: { borderTopWidth: 1, borderTopColor: C.line, marginTop: 8 },
  foldHead: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  foldTitle: { color: C.fg, fontSize: 15, fontWeight: '700' },
  foldChev: { color: C.muted, fontSize: 16 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', paddingVertical: 4 },
  beatBox: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 10, marginTop: 8, gap: 2 },
  beatTitle: { color: C.fg, fontSize: 14, fontWeight: '700' },
  track: { height: 8, borderRadius: 4, backgroundColor: C.raised2 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4, backgroundColor: C.accent },
  loop: { position: 'absolute', top: -6, bottom: -6, borderRadius: 4, backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accent },
  knob: { position: 'absolute', top: -8, width: 24, height: 24, marginLeft: -12, borderRadius: 12, backgroundColor: C.fg },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: C.muted, fontSize: 12, fontFamily: F.mono },
  transport: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 8 },
  inline: { flexDirection: 'row', gap: 6 },
  bar: { height: 8, borderRadius: 4, backgroundColor: C.raised2, overflow: 'hidden', marginVertical: 6 },
  barFill: { height: 8, backgroundColor: C.accent },
});
