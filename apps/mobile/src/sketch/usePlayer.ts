/**
 * Sketch playback and recording on the native engine. Bars are scheduled a little ahead, one at a time, from the
 * latest idea, so edits are heard from the next bar. Recording counts in one bar, then captures e-drum hits,
 * or your voice (beatbox) through the mic, which is recognised after you stop.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import {
  DRUM_SOUNDS, INSTRUMENTS, SOUND, analyze, barGrid, barSteps, ideaToRaw, soundFor, stepTime, withRaw, type Idea, type InstrumentId, type RawNote, type SoundKey,
} from '@ghostgrid/core';
import Engine from '../../modules/ghostgrid-engine';
import { useApp } from '../AppContext';

const AHEAD = 0.5;
const sound = (name: string) => DRUM_SOUNDS.indexOf(name as (typeof DRUM_SOUNDS)[number]);

export interface PlayPos { bar: number; step: number }
export type RecSource = 'pads' | 'voice';
/** A voice take, kept so its hits can be checked and corrected (each correction also teaches the recogniser). */
export interface VoiceTake {
  before: Idea;
  base: RawNote[];
  hits: { beat: number; k: SoundKey; v: number[]; margin?: number; acc?: boolean }[];
  /** the take as a WAV file, for sharing */
  wav?: string;
}
type RecState = null | { phase: 'count' | 'rec'; start: number; bars: number; beat: number; hits: RawNote[]; source: RecSource; clickOk: boolean };

/** Save samples as a 16-bit mono WAV in the app's cache (for sharing a recording). Returns the file URI. */
export function saveWav(data: Float32Array, sr: number, name: string): string {
  const n = data.length, buf = new ArrayBuffer(44 + n * 2), d = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, Math.round(sr), true);
  d.setUint32(28, Math.round(sr) * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); str(36, 'data'); d.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) d.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 32767, true);
  const f = new File(Paths.cache, name);
  try { if (f.exists) f.delete(); } catch { /* overwrite */ }
  f.writeSync(new Uint8Array(buf));
  return f.uri;
}

/** Read the raw float file written by the native recorder. */
export function readVoiceFile(path: string): Float32Array {
  const bytes = new File(path).bytesSync();
  return new Float32Array(bytes.slice().buffer, 0, Math.floor(bytes.length / 4));
}

/** Notes of a take: the sound decides instrument and ghost/open; loud hits become accents. */
export function takeNotes(t: VoiceTake): RawNote[] {
  return t.hits.map((h) => {
    const s = SOUND[h.k];
    return { beat: Math.max(0, h.beat), id: s.cls, v: (s.v === 3 ? 3 : h.acc ? 2 : 1) as RawNote['v'] };
  });
}
export function applyTake(t: VoiceTake): Idea {
  const notes = takeNotes(t);
  const I = t.before;
  const used = new Set<InstrumentId>([...(I.rows ?? []), ...notes.map((n) => n.id)]);
  return withRaw({ ...I, rows: I.rows ? [...used] : undefined }, [...t.base, ...notes], I.bars.length);
}

export function useSketchPlayer(idea: Idea, onRecorded: (next: Idea, count: number, source: RecSource, take?: VoiceTake) => void) {
  const { info, on, settings } = useApp();
  const ideaRef = useRef(idea);
  ideaRef.current = idea;
  const onRec = useRef(onRecorded);
  onRec.current = onRecorded;
  const sk = useRef(settings.sketch);
  sk.current = settings.sketch;
  const calibPads = useRef(settings.click.calib.pads);
  calibPads.current = settings.click.calib.pads;
  const calibMic = useRef(settings.click.calib.mic);
  calibMic.current = settings.click.calib.mic;
  const micSens = useRef(settings.micSens);
  micSens.current = settings.micSens;
  const route = useRef(info?.route);
  route.current = info?.route;
  const outLat = useRef(0);
  outLat.current = info?.outputLatency ?? 0;

  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState<PlayPos | null>(null);
  const [rec, setRec] = useState<null | 'count' | 'rec'>(null);
  const [countBeat, setCountBeat] = useState(0);

  const R = useRef({
    timer: null as ReturnType<typeof setInterval> | null,
    nextT: 0, nextBar: 0, loopBars: 0,
    starts: [] as { t: number; bar: number; beat: number; g: number }[],
    rec: null as RecState, withGroove: true, recorded: 0,
  });

  const scheduleBar = (t: number, b: number, notes: boolean) => {
    const I = ideaRef.current;
    const bar = I.bars[b];
    if (notes && bar) {
      for (let s = 0; s < barSteps(I, b); s++) for (const ins of INSTRUMENTS) {
        const v = bar.n[ins.id][s];
        if (!v) continue;
        const sd = soundFor(ins.id, v);
        Engine.scheduleDrum(t + stepTime(I, b, s) - stepTime(I, b, 0), sound(sd.sound), sd.gain);
      }
    }
    const rc = R.current.rec;
    if (sk.current.click || (rc && (rc.source === 'pads' || rc.clickOk))) {
      const beat = 60 / I.bpm;
      for (let k = 0; k < I.beats; k++) Engine.scheduleDrum(t + k * beat, sound(k === 0 ? 'clickAcc' : 'click'), 0.7);
    }
  };

  const stop = useCallback(() => {
    const r = R.current;
    if (r.timer) clearInterval(r.timer);
    r.timer = null;
    try { Engine.cancelAfter(Engine.now()); } catch { /* restarting */ }
    const wasRec = r.rec;
    r.rec = null;
    r.starts = [];
    setPlaying(false); setPos(null); setRec(null);
    deactivateKeepAwake('sketch');
    if (wasRec && wasRec.phase === 'rec') finishRecording(wasRec);
    else if (wasRec?.source === 'voice') { try { Engine.stopRecording(); } catch { /* not recording */ } onRec.current(ideaRef.current, -1, 'voice'); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finishRecording = (r: NonNullable<RecState>) => {
    const I = ideaRef.current;
    if (r.source === 'voice') {
      let take: VoiceTake | null = null;
      try {
        const f = Engine.stopRecording();
        const data = readVoiceFile(f.path);
        const a = analyze(data, f.sampleRate, sk.current.voice, sk.current.ghostPct, micSens.current);
        const end = r.bars * I.beats;
        let base = ideaToRaw(I);
        if (sk.current.recMode === 'replace') base = base.filter((n) => n.beat >= end - 1e-6);
        let wav: string | undefined;
        try { wav = saveWav(data, f.sampleRate, `ghostgrid-take-${Math.round(I.bpm)}bpm.wav`); } catch { wav = undefined; }
        take = {
          before: I, base, wav,
          hits: a.hits
            .map((h) => ({ beat: (f.startTime + h.t - outLat.current + calibMic.current / 1000 - r.start) / r.beat, k: h.k, v: h.f.v, margin: h.margin, acc: h.acc }))
            .filter((h) => h.beat > -0.5 && h.beat < end - 0.1),
        };
      } catch { take = null; }
      if (!take || !take.hits.length) { onRec.current(I, 0, 'voice'); return; }
      onRec.current(applyTake(take), take.hits.length, 'voice', take);
      return;
    }
    const start = 0, end = r.bars * I.beats;
    let base = ideaToRaw(I);
    if (sk.current.recMode === 'replace') base = base.filter((n) => n.beat < start - 1e-6 || n.beat >= end - 1e-6);
    const hits = r.hits.filter((h) => h.beat > -0.5 && h.beat < end - 0.1).map((h) => ({ ...h, beat: Math.max(0, h.beat) }));
    if (!hits.length) { onRec.current(I, 0, r.source); return; }
    const used = new Set<InstrumentId>([...(I.rows ?? []), ...hits.map((h) => h.id)]);
    const next = withRaw({ ...I, rows: I.rows ? [...used] : undefined }, [...base, ...hits], I.bars.length);
    onRec.current(next, hits.length, r.source);
  };

  const pump = useCallback(() => {
    const r = R.current, I = ideaRef.current;
    const now = Engine.now();
    while (r.nextT < now + AHEAD) {
      if (r.rec && r.rec.phase === 'count') {
        // count-in bar: click only
        const beat = 60 / I.bpm;
        for (let k = 0; k < I.beats; k++) Engine.scheduleDrum(r.nextT + k * beat, sound(k === 0 ? 'clickAcc' : 'click'), 0.8);
        r.starts.push({ t: r.nextT, bar: -1, beat, g: 1 });
        r.rec.phase = 'rec';
        r.rec.start = r.nextT + I.beats * beat;
        r.nextT = r.rec.start;
        r.nextBar = 0;
        continue;
      }
      if (r.rec && r.nextBar >= r.rec.bars) { r.nextT = Infinity; break; }
      const b = r.nextBar % Math.max(1, I.bars.length);
      scheduleBar(r.nextT, b, r.withGroove);
      r.starts.push({ t: r.nextT, bar: b, beat: 60 / I.bpm, g: barGrid(I, b) });
      if (r.starts.length > 16) r.starts.shift();
      r.nextT += I.beats * (60 / I.bpm);
      r.nextBar = b + 1;
    }
    if (r.rec && r.nextT === Infinity) {
      const last = r.starts[r.starts.length - 1];
      if (last && now - outLat.current > last.t + I.beats * last.beat + 0.3) stop();
    }
  }, [stop]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = useCallback((recording: boolean, source: RecSource = 'pads') => {
    stop();
    const r = R.current, I = ideaRef.current;
    // with the phone speaker the mic would hear the click, so voice takes get the count-in only
    const clickOk = source === 'pads' || route.current !== 'speaker';
    r.nextT = Engine.now() + 0.15;
    r.nextBar = 0;
    r.starts = [];
    r.withGroove = !recording || (sk.current.recMode === 'layer' && clickOk);
    r.rec = recording ? { phase: 'count', start: 0, bars: Math.max(1, I.bars.length), beat: 60 / I.bpm, hits: [], source, clickOk } : null;
    if (recording && source === 'voice' && !Engine.startRecording()) { r.rec = null; onRec.current(I, -2, 'voice'); return; }
    pump();
    r.timer = setInterval(pump, 50);
    setPlaying(true);
    setRec(recording ? 'count' : null);
    activateKeepAwakeAsync('sketch').catch(() => {});
  }, [pump, stop]);

  // playhead
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const r = R.current;
      const heard = Engine.now() - outLat.current;
      let cur: (typeof r.starts)[number] | null = null;
      for (const s of r.starts) if (s.t <= heard) cur = s;
      if (cur) {
        if (cur.bar < 0) { setRec('count'); setCountBeat(Math.min(ideaRef.current.beats, Math.floor((heard - cur.t) / cur.beat) + 1)); setPos(null); }
        else {
          if (r.rec) setRec('rec');
          const step = Math.floor(((heard - cur.t) / cur.beat) * cur.g);
          setPos((p) => (p && p.bar === cur!.bar && p.step === step ? p : { bar: cur!.bar, step }));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // e-drum hits while recording
  useEffect(() => on('pad', (e) => {
    const r = R.current.rec;
    if (!r || r.source !== 'pads' || !e.mapped) return;
    const id = (e.key === 'hh+o' ? 'hh' : e.key) as InstrumentId;
    if (!INSTRUMENTS.some((i) => i.id === id)) return;
    const t = e.time - outLat.current + calibPads.current / 1000;
    r.hits.push({ beat: (t - r.start) / r.beat, id, v: e.state });
  }), [on]);

  useEffect(() => on('restart', () => stop()), [on, stop]);
  useEffect(() => () => stop(), [stop]);

  return { playing, pos, rec, countBeat, recSource: R.current.rec?.source ?? null, play: () => begin(false), record: (src: RecSource = 'pads') => begin(true, src), stop };
}
