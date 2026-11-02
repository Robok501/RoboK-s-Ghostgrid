/**
 * Songs: import a song (or record it from the room), separate the drums on the phone, and practise with it:
 * the song without drums (you are the drummer), the drums alone (learn the part), slower without changing pitch,
 * and an A–B loop. Stems stay in the app.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import {
  HitLog, barAt, barStarts, barsFrom, beatLengthAt, beatMap, clickTimes, doubleTime, halfTime, offsetToBeat, setBeatsPerBar,
  setDownbeatAt, shiftDownbeat, snapToBar, type BeatMap,
} from '@ghostgrid/core';
import Engine from '../../modules/ghostgrid-engine';
import { CoachPanel } from '../click/CoachPanel';
import type { CoachInput } from '../store';
import { useApp } from '../AppContext';
import { readVoiceFile, saveWav } from '../sketch/usePlayer';
import {
  MODEL_MB, MODEL_NAME, MODEL_URL, deleteSongFiles, ensureDir, fmtTime, loadSongs, newSongId, originalPath, saveSongs, stemPath, toPath,
  type Mix, type Song,
} from '../songs/songs';
import { C, F } from '../theme';
import { Btn, Card, Note, Row, Seg, Stepper } from '../ui';

type Progress = { phase: string; progress: number } | null;
const PHASE: Record<string, string> = { decode: 'Reading the song', load: 'Loading the model', separate: 'Separating the drums', write: 'Saving', download: 'Downloading the model' };

export function SongsScreen() {
  const { mic, setMic } = useApp();
  const [songs, setSongs] = useState<Song[]>(loadSongs);
  const [cur, setCur] = useState<string | null>(null);
  const [model, setModel] = useState(() => Engine.stemsModelStatus(MODEL_NAME));
  const [dl, setDl] = useState<Progress>(null);
  const [work, setWork] = useState<{ id: string; p: Progress } | null>(null);
  const [notice, setNotice] = useState(() => {
    // if iOS stopped the app during the last separation, say where (and how much memory there was)
    try {
      const r = Engine.stemsLastRun();
      if (r.phase && !['done', 'error'].includes(r.phase)) {
        const where = { decode: 'reading the song', load: 'loading the model', separate: 'separating', write: 'saving' }[r.phase] ?? r.phase;
        const used = (r as { usedByLoadMB?: number }).usedByLoadMB;
        return `Last time the app was stopped while ${where} (free memory then: ${Math.round(r.freeAfterLoadMB ?? r.freeMB ?? 0)} MB${used ? `, loading had used ${Math.round(used)} MB` : ''}). Please tell Claude this line.`;
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
      setNotice('Model ready. Import a song and tap Separate.');
    } catch (e) {
      setNotice(`Download failed: ${(e as Error).message}`);
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
      setNotice(model.present ? 'Imported. Tap Separate to split off the drums.' : 'Imported. Download the model first, then tap Separate.');
    } catch (e) {
      setNotice(`Import failed: ${(e as Error).message}`);
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
        add({ id, name: `Room recording ${new Date().toLocaleDateString()}`, created: Date.now(), source: 'mic', original: 'original.wav', duration: data.length / f.sampleRate, rate: 1, mix: 'nodrums', drumVol: 1 });
        setCur(id);
      } catch (e) {
        setNotice(`Recording failed: ${(e as Error).message}`);
      }
      if (micWasOff.current) { micWasOff.current = false; setMic(false); }
      return;
    }
    if (!mic) {
      micWasOff.current = true;
      if (!(await setMic(true))) { micWasOff.current = false; setNotice('The microphone is off. Allow it in Settings → Ghostgrid.'); return; }
    }
    if (!Engine.startRecording()) { setNotice('The microphone is off.'); return; }
    setRecording(Date.now());
  };
  const [, tick] = useState(0);
  useEffect(() => {
    if (recording === null) return;
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [recording]);

  // ---- separation
  const separate = async (s: Song) => {
    if (!model.present) { setNotice('Download the model first.'); return; }
    Engine.stemsUnload();
    setWork({ id: s.id, p: { phase: 'decode', progress: 0 } });
    try {
      const dir = ensureDir(s.id);
      const duration = await Engine.stemsSeparate(originalPath(s), toPath(dir.uri), MODEL_NAME);
      update(s.id, { separated: true, duration, error: undefined });
      setNotice('Done. Play it without drums, or with drums only.');
    } catch (e) {
      update(s.id, { error: (e as Error).message });
      setNotice(`Separation stopped: ${(e as Error).message}`);
    }
    setWork(null);
  };

  const remove = (s: Song) => {
    if (cur === s.id) { Engine.stemsUnload(); setCur(null); }
    deleteSongFiles(s.id);
    setSongs((list) => { const next = list.filter((x) => x.id !== s.id); saveSongs(next); return next; });
  };

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={s.scroll}>
      {!!notice && <Text style={s.notice}>{notice}</Text>}

      {!model.present && (
        <Card title="Separation model">
          <Note>
            Ghostgrid separates the drums on your phone, so your songs never leave it. That needs a model of about {MODEL_MB} MB, downloaded once. Use Wi-Fi.
          </Note>
          {dl ? (
            <>
              <Bar value={dl.progress} />
              <View style={s.btnRow}><Text style={s.dim}>{Math.round(dl.progress * 100)} %</Text><Btn label="Cancel" onPress={() => Engine.stemsCancelDownload()} /></View>
            </>
          ) : <View style={s.btnRow}><Btn label={`Download model (${MODEL_MB} MB)`} primary onPress={download} style={{ flex: 1 }} /></View>}
        </Card>
      )}

      <View style={s.btnRow}>
        <Btn label="Import song" onPress={importSong} style={{ flex: 1 }} />
        <Btn label={recording !== null ? `Stop · ${fmtTime((Date.now() - recording) / 1000)}` : 'Record from room'} active={recording !== null} onPress={toggleRecord} style={{ flex: 1 }} />
      </View>
      {recording !== null && <Note>Play the song on a speaker and hold the phone near it. Files sound better than room recordings.</Note>}

      {song && (
        <Player key={song.id} song={song} update={update} separating={work?.id === song.id} progress={work?.id === song.id ? work.p : null}
          onSeparate={() => separate(song)} onCancel={() => Engine.stemsCancel()} onDelete={() => remove(song)} canSeparate={!work && model.present} />
      )}

      <Card title="Songs">
        {!songs.length && <Note>No songs yet. Import an MP3, M4A or WAV from Files, or record a song playing in the room.</Note>}
        {songs.map((x, i) => (
          <Pressable key={x.id} onPress={() => setCur(x.id)} style={[s.songRow, i > 0 && s.line, cur === x.id && { backgroundColor: C.raised }]} accessibilityRole="button">
            <View style={{ flex: 1 }}>
              <Text style={s.songName} numberOfLines={1}>{x.name}</Text>
              <Text style={s.dim}>{x.duration ? fmtTime(x.duration) : '–'} · {work?.id === x.id ? 'separating…' : x.separated ? 'drums separated' : x.error ? 'not separated (stopped)' : 'not separated yet'}{x.source === 'mic' ? ' · room recording' : ''}</Text>
            </View>
            <Text style={[s.badge, x.separated && { color: C.good }]}>{x.separated ? '✓' : '○'}</Text>
          </Pressable>
        ))}
      </Card>

      {model.present && (
        <Card title="Model">
          <Row label="HT-Demucs drums" hint={`${Math.round(model.bytes / 1e6)} MB on this phone`} first>
            <Btn label="Remove" onPress={() => { Engine.stemsDeleteModel(MODEL_NAME); setModel(Engine.stemsModelStatus(MODEL_NAME)); }} />
          </Row>
          <Note>For your own practice. Stems stay in the app and can't be exported. Free memory now: {Math.round(Engine.stemsFreeMemoryMB())} MB.</Note>
        </Card>
      )}
    </ScrollView>
  );
}

function Player({ song, update, separating, progress, onSeparate, onCancel, onDelete, canSeparate }: {
  song: Song; update: (id: string, p: Partial<Song>) => void; separating: boolean; progress: Progress;
  onSeparate: () => void; onCancel: () => void; onDelete: () => void; canSeparate: boolean;
}) {
  const { info, on, mic, setMic, settings, micLevel } = useApp();
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

  // find beats and bars once (in the drum track when there is one); again after "Find again"
  const analyse = useCallback(async () => {
    setAnalysing(true);
    try {
      const env = await Engine.stemsEnvelope(song.separated ? stemPath(song, 'drums') : originalPath(song));
      // the "1" comes from the music: chord changes and bass notes, in the track without drums (or the whole song)
      let music: Awaited<ReturnType<typeof Engine.stemsMusicFeatures>> | undefined;
      try { music = await Engine.stemsMusicFeatures(song.separated ? stemPath(song, 'nodrums') : originalPath(song)); } catch { music = undefined; }
      update(song.id, { beatMap: { ...beatMap(env, map?.beatsPerBar ?? 4, music), source: song.separated ? 'drums' : 'mix', v: 2 } });
    } catch (e) {
      setErr(`Couldn't find the beat: ${(e as Error).message}`);
    }
    setAnalysing(false);
  }, [song, map?.beatsPerBar, update]);
  useEffect(() => {
    if (ready && !map && !analysing && !separating) analyse();
  }, [ready, map, separating]); // eslint-disable-line react-hooks/exhaustive-deps
  // a separated drum track beats the full mix for finding the beat: redo an old map once
  useEffect(() => {
    // redo maps from the whole mix, or from before the "1" came from the music (unless fixed by hand)
    if (ready && map && !map.edited && ((song.separated && map.source === 'mix') || map.v !== 2)) analyse();
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
    } catch (e) { setErr(`Couldn't play: ${(e as Error).message}`); }
  };
  const seek = (t: number) => {
    const v = Math.max(0, Math.min(dur, t));
    try { Engine.stemsSeek(v); } catch (e) { setErr(`Couldn't jump there: ${(e as Error).message}`); }
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

  // ---- timing coach against the song's beat
  const [, bump] = useState(0);
  const logRef = useRef(new HitLog(32));
  const [last, setLast] = useState<number | null>(null);
  const coachInput: CoachInput = song.coachInput ?? 'pads';
  const R = useRef({ map, rate, outLat: 0, calib: settings.click.calib, grade: song.grade ?? 1, coach: !!song.coach, playing });
  R.current = { map, rate, outLat: info?.outputLatency ?? 0, calib: settings.click.calib, grade: song.grade ?? 1, coach: !!song.coach, playing };
  const scoreHit = useCallback((t: number, input: CoachInput, pad: string) => {
    const r = R.current;
    if (!r.coach || !r.map || !r.playing) return;
    const songT = Engine.stemsSongTimeAt(t - r.outLat);
    if (songT < 0) return;
    const off = offsetToBeat(r.map, songT, r.grade);
    if (off === null) return;
    const ms = off / r.rate + r.calib[input];
    logRef.current.add(ms, pad);
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

  return (
    <Card title={song.name}>
      {!song.separated && (
        separating ? (
          <>
            <Text style={s.phase}>{PHASE[progress?.phase ?? 'decode']}{progress?.phase === 'separate' ? ` · ${Math.round(progress.progress * 100)} %` : '…'}</Text>
            <Bar value={progress?.phase === 'separate' ? progress.progress : progress?.phase === 'write' ? 1 : 0.02} />
            <Note>This takes a while: roughly the length of the song or a bit longer. Keep the app open.</Note>
            <View style={s.btnRow}><Btn label="Cancel" onPress={onCancel} /></View>
          </>
        ) : (
          <>
            <Note>{song.error ? `Last try stopped: ${song.error}` : 'Separate the drums to practise without them, or with drums only.'}</Note>
            <View style={s.btnRow}><Btn label="Separate drums" primary disabled={!canSeparate} onPress={onSeparate} style={{ flex: 1 }} /></View>
          </>
        )
      )}

      {!!err && <Text style={s.err}>{err}</Text>}
      <Timeline pos={pos} dur={dur} a={song.loop ? A : null} b={song.loop ? B : null} bars={bars} onSeek={seek} />
      <View style={s.timeRow}>
        <Text style={s.time}>{fmtTime(pos)}{barNow >= 0 ? `  ·  bar ${barNow + 1}` : ''}</Text>
        <Text style={s.time}>{fmtTime(dur)}{bars.length ? `  ·  ${bars.length} bars` : ''}</Text>
      </View>

      <View style={s.transport}>
        <Btn label="−5 s" onPress={() => seek(pos - 5)} />
        <Btn label={playing ? 'Pause' : 'Play'} primary active={playing} disabled={!ready || separating} onPress={toggle} style={{ flex: 1 }} />
        <Btn label="+5 s" onPress={() => seek(pos + 5)} />
      </View>

      {song.coach && (
        <CoachPanel input={coachInput} running={playing} last={last} log={logRef.current} tol={settings.click.tol}
          calibrating={null} calibCount={0} micLevel={micLevel} onTap={tap} />
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
      <Row label="Count-in" hint="before Play, from the bar you're in">
        <Seg small options={[{ value: 0, label: 'Off' }, { value: 1, label: '1 bar' }, { value: 2, label: '2 bars' }]} value={song.countIn ?? 0}
          onChange={(v) => update(song.id, { countIn: v as number })} />
      </Row>

      <Row label="Loop" hint={song.loop ? `${fmtTime(A)} – ${fmtTime(B)}${map ? ` · bars ${barAt(map, A + 0.01) + 1}–${barAt(map, B - 0.01) + 1}` : ''}` : map ? 'A and B snap to bar lines' : 'set A and B while it plays'}>
        <View style={s.inline}>
          <Btn label="A" onPress={setA} />
          <Btn label="B" onPress={setB} />
          <Btn label={song.loop ? 'Off' : 'On'} active={!!song.loop} onPress={() => update(song.id, { loop: !song.loop })} />
        </View>
      </Row>
      {map && (
        <View style={s.chipsRow}>
          <Text style={s.dim}>Loop length:</Text>
          {[1, 2, 4, 8].map((n) => <Btn key={n} label={`${n} bar${n > 1 ? 's' : ''}`} onPress={() => loopBars(n)} />)}
        </View>
      )}

      <Row label="Score my timing" hint="against the song's beat">
        <Btn label={song.coach ? 'On' : 'Off'} active={!!song.coach} disabled={!map} onPress={() => update(song.id, { coach: !song.coach })} />
      </Row>
      {song.coach && (
        <>
          <Row label="Input"><Seg small options={[{ value: 'pads', label: 'E-drum' }, { value: 'mic', label: 'Mic' }, { value: 'tap', label: 'Tap' }]} value={coachInput} onChange={(v) => setCoachInput(v as CoachInput)} /></Row>
          <Row label="Grade against"><Seg small options={[{ value: 1, label: 'Beats' }, { value: 2, label: '8ths' }, { value: 4, label: '16ths' }]} value={song.grade ?? 1} onChange={(v) => update(song.id, { grade: v as 1 | 2 | 4 })} /></Row>
          {coachInput === 'mic' && <Note>Use headphones or Bluetooth so the mic hears your drums, not the song.</Note>}
          <View style={s.btnRow}><Btn label="Reset hits" onPress={() => { logRef.current.reset(); setLast(null); bump((x) => x + 1); }} /></View>
        </>
      )}

      <BeatMapCard map={map} analysing={analysing} pos={pos} onChange={(m) => update(song.id, { beatMap: m })} onAgain={analyse} />

      <View style={s.btnRow}>
        {song.separated && <Btn label="Separate again" disabled={!canSeparate} onPress={onSeparate} />}
        <Btn label="Delete song" onPress={onDelete} />
      </View>
    </Card>
  );
}

/** What the app found, and how to fix it: the "1", beats per bar, half or double tempo. */
function BeatMapCard({ map, analysing, pos, onChange, onAgain }: {
  map: BeatMap | null; analysing: boolean; pos: number; onChange: (m: BeatMap) => void; onAgain: () => void;
}) {
  if (analysing) return <Note>Finding the beat and the bars…</Note>;
  if (!map) return <View style={s.btnRow}><Btn label="Find the beat" onPress={onAgain} /></View>;
  return (
    <View style={s.beatBox}>
      <Text style={s.beatTitle}>Beat map · about {Math.round(map.bpm)} BPM · {map.beatsPerBar}/4{map.edited ? ' · fixed by hand' : ''}</Text>
      <Note>Click sounds wrong? Fix it here: put the "1" where the bar starts, or halve or double the tempo.</Note>
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
  songRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 6, borderRadius: 10 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  songName: { color: C.fg, fontSize: 15, fontWeight: '600' },
  badge: { color: C.muted, fontSize: 18, width: 24, textAlign: 'center' },
  phase: { color: C.fg, fontSize: 15, fontWeight: '600', paddingTop: 4 },
  timeline: { height: 52, justifyContent: 'center' },
  ticks: { position: 'absolute', left: 0, right: 0, top: 4, height: 10 },
  tick: { position: 'absolute', width: 1, height: 6, backgroundColor: C.muted, opacity: 0.6 },
  tickBig: { height: 10, opacity: 1 },
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
