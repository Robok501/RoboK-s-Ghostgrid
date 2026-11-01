/**
 * Songs: import a song (or record it from the room), separate the drums on the phone, and practise with it:
 * the song without drums (you are the drummer), the drums alone (learn the part), slower without changing pitch,
 * and an A–B loop. Stems stay in the app.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import Engine from '../../modules/ghostgrid-engine';
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
  const [notice, setNotice] = useState('');
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
          <Note>For your own practice. Stems stay in the app and can't be exported.</Note>
        </Card>
      )}
    </ScrollView>
  );
}

function Player({ song, update, separating, progress, onSeparate, onCancel, onDelete, canSeparate }: {
  song: Song; update: (id: string, p: Partial<Song>) => void; separating: boolean; progress: Progress;
  onSeparate: () => void; onCancel: () => void; onDelete: () => void; canSeparate: boolean;
}) {
  const [dur, setDur] = useState(song.duration ?? 0);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const mix: Mix = song.separated ? song.mix ?? 'nodrums' : 'full';
  const rate = song.rate ?? 1, drumVol = song.drumVol ?? 1;
  const A = song.loopA ?? 0, B = song.loopB ?? dur, loopOn = !!song.loop && B - A > 0.3;

  // load the files into the player
  useEffect(() => {
    if (separating) return;
    let alive = true;
    setReady(false);
    const load = song.separated ? Engine.stemsLoad(stemPath(song, 'drums'), stemPath(song, 'nodrums')) : Engine.stemsLoad(null, originalPath(song));
    load.then((d) => {
      if (!alive) return;
      setDur(d); setReady(true);
      if (!song.duration) update(song.id, { duration: d });
    }).catch(() => setReady(false));
    return () => { alive = false; Engine.stemsPause(); setPlaying(false); };
  }, [song.id, song.separated, separating]); // eslint-disable-line react-hooks/exhaustive-deps

  // mix, speed and loop follow the settings
  useEffect(() => {
    if (!ready) return;
    const d = mix === 'nodrums' ? 0 : mix === 'drums' ? 1 : drumVol, r = mix === 'drums' ? 0 : 1;
    Engine.stemsSetVolumes(d, r);
  }, [ready, mix, drumVol]);
  useEffect(() => { if (ready) Engine.stemsSetRate(rate); }, [ready, rate]);
  useEffect(() => { if (ready) Engine.stemsSetLoop(A, B, loopOn); }, [ready, A, B, loopOn]);

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
    if (playing) { Engine.stemsPause(); setPlaying(false); setPos(Engine.stemsPosition()); }
    else { Engine.stemsPlay(); setPlaying(true); }
  };
  const seek = (t: number) => { const v = Math.max(0, Math.min(dur, t)); Engine.stemsSeek(v); setPos(v); };

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

      <Timeline pos={pos} dur={dur} a={song.loop ? A : null} b={song.loop ? B : null} onSeek={seek} />
      <View style={s.timeRow}>
        <Text style={s.time}>{fmtTime(pos)}</Text>
        <Text style={s.time}>{fmtTime(dur)}</Text>
      </View>

      <View style={s.transport}>
        <Btn label="−5 s" onPress={() => seek(pos - 5)} />
        <Btn label={playing ? 'Pause' : 'Play'} primary active={playing} disabled={!ready || separating} onPress={toggle} style={{ flex: 1 }} />
        <Btn label="+5 s" onPress={() => seek(pos + 5)} />
      </View>

      {song.separated && (
        <Row label="Listen to" first>
          <Seg options={[{ value: 'nodrums', label: 'No drums' }, { value: 'full', label: 'Full' }, { value: 'drums', label: 'Drums' }]} value={mix} onChange={(m) => update(song.id, { mix: m as Mix })} />
        </Row>
      )}
      {song.separated && mix === 'full' && (
        <Row label="Drums volume"><Stepper value={Math.round(drumVol * 100)} min={0} max={100} step={10} format={(v) => `${v}%`} onChange={(v) => update(song.id, { drumVol: v / 100 })} /></Row>
      )}
      <Row label="Speed" hint="slower without changing pitch">
        <Stepper value={Math.round(rate * 100)} min={50} max={125} step={5} format={(v) => `${v}%`} onChange={(v) => update(song.id, { rate: v / 100 })} />
      </Row>
      <Row label="Loop" hint={song.loop ? `${fmtTime(A)} – ${fmtTime(B)}` : 'set A and B while it plays'}>
        <View style={s.inline}>
          <Btn label="A" onPress={() => update(song.id, { loopA: pos, loopB: Math.max(pos + 1, song.loopB ?? dur), loop: true })} />
          <Btn label="B" onPress={() => update(song.id, { loopB: pos, loopA: Math.max(0, Math.min(song.loopA ?? 0, pos - 1)), loop: true })} />
          <Btn label={song.loop ? 'Off' : 'On'} active={!!song.loop} onPress={() => update(song.id, { loop: !song.loop })} />
        </View>
      </Row>
      <View style={s.btnRow}>
        {song.separated && <Btn label="Separate again" disabled={!canSeparate} onPress={onSeparate} />}
        <Btn label="Delete song" onPress={onDelete} />
      </View>
    </Card>
  );
}

/** Song position bar: tap or drag to move; shows the A–B loop. */
function Timeline({ pos, dur, a, b, onSeek }: { pos: number; dur: number; a: number | null; b: number | null; onSeek: (t: number) => void }) {
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
  return (
    <View {...pan.panHandlers} onLayout={(e) => { w.current = e.nativeEvent.layout.width || 1; }} style={s.timeline}
      accessible accessibilityRole="adjustable" accessibilityLabel={`Position ${fmtTime(pos)} of ${fmtTime(dur)}`}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onSeek(pos + (e.nativeEvent.actionName === 'increment' ? 5 : -5))}>
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
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 6, alignItems: 'center' },
  dim: { color: C.muted, fontSize: 12 },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 6, borderRadius: 10 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  songName: { color: C.fg, fontSize: 15, fontWeight: '600' },
  badge: { color: C.muted, fontSize: 18, width: 24, textAlign: 'center' },
  phase: { color: C.fg, fontSize: 15, fontWeight: '600', paddingTop: 4 },
  timeline: { height: 44, justifyContent: 'center' },
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
