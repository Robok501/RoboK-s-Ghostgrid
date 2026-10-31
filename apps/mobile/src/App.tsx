/**
 * Ghostgrid — iOS proof of concept (roadmap step 2).
 * Tests the risky parts before building the real app:
 *  1. sample-accurate click from the native engine,
 *  2. Bluetooth MIDI from an e-drum (e.g. Roland TD-27) with timing per pad,
 *  3. the click staying on Bluetooth while the iPhone mic listens.
 */
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import {
  ClickPlan, DEFAULT_CONFIG, DEFAULT_PAD_SETTINGS, HitLog, PAD_NAMES, Scheduler, calibrationFromHits, defaultLevels,
  gridOffset, resolveNote, tempoMarking, timingStats, type ClickStep, type PadKey, type Preset,
} from '@ghostgrid/core';
import Engine, { type EngineInfo, type PadHitEvent, type CaptureHitEvent } from '../modules/ghostgrid-engine';
import { C, F } from './theme';

const TOL_MS = 15;
const CALIB_HITS = 8;

type Source = 'pads' | 'mic';
interface Stat { key: string; label: string; mean: number; sd: number; n: number }

export default function App() {
  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [error, setError] = useState('');
  const [keepBt, setKeepBt] = useState(true);
  const [mic, setMic] = useState(false);
  const [bpm, setBpm] = useState(100);
  const [beats, setBeats] = useState(4);
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState(-1);
  const [sources, setSources] = useState<string[]>([]);
  const [preset, setPreset] = useState<Preset>('roland');
  const [lastHit, setLastHit] = useState('No pad hits yet');
  const [stats, setStats] = useState<Stat[]>([]);
  const [calib, setCalib] = useState<Record<Source, number>>({ pads: 0, mic: 0 });
  const [calibrating, setCalibrating] = useState<Source | null>(null);
  const [calibCount, setCalibCount] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [lastMic, setLastMic] = useState('');

  // live values for native event handlers
  const R = useRef({
    info: null as EngineInfo | null, running: false, bpm: 100, preset: 'roland' as Preset,
    calib: { pads: 0, mic: 0 } as Record<Source, number>, calibrating: null as Source | null, calibRaw: [] as number[],
    grid: [] as number[], visual: [] as { t: number; beat: number }[],
    scheduler: null as Scheduler<ClickStep> | null, timer: null as ReturnType<typeof setInterval> | null,
    log: new HitLog(32),
  });
  R.current.bpm = bpm; R.current.preset = preset; R.current.calib = calib; R.current.calibrating = calibrating;

  const refreshStats = useCallback(() => {
    const out: Stat[] = [];
    for (const [key, offs] of Object.entries(R.current.log.byPad)) {
      const s = timingStats(offs, TOL_MS);
      out.push({ key, label: key === 'mic' ? 'Mic' : PAD_NAMES[key as PadKey] ?? key, mean: s.mean, sd: s.sd, n: s.n });
    }
    setStats(out.sort((a, b) => b.n - a.n));
  }, []);

  /** Score one hit (engine time) against the clicks. */
  const score = useCallback((time: number, source: Source, key: string) => {
    const r = R.current;
    if (!r.running || !r.info) return null;
    const raw = gridOffset(time - r.info.outputLatency, r.grid, 60 / r.bpm);
    if (raw === null) return null;
    const rawMs = raw * 1000;
    if (r.calibrating === source) {
      r.calibRaw.push(rawMs);
      setCalibCount(r.calibRaw.length);
      if (r.calibRaw.length >= CALIB_HITS) {
        const fix = calibrationFromHits(r.calibRaw);
        setCalib((c) => ({ ...c, [source]: fix }));
        setCalibrating(null);
        r.log.reset();
        refreshStats();
      }
      return rawMs;
    }
    const off = rawMs + r.calib[source];
    r.log.add(off, key);
    refreshStats();
    return off;
  }, [refreshStats]);

  // ----- engine lifecycle -----
  const stopMetronome = useCallback(() => {
    const r = R.current;
    r.scheduler?.stop();
    if (r.timer) clearInterval(r.timer);
    r.timer = null; r.scheduler = null; r.running = false;
    try { Engine.cancelAfter(Engine.now()); } catch {}
    r.visual = []; r.grid = [];
    setRunning(false); setBeat(-1);
  }, []);

  const startEngine = useCallback(async (bt: boolean, withMic: boolean) => {
    stopMetronome();
    setError('');
    try {
      if (withMic && !(await Engine.requestMicPermission())) {
        setError('Microphone access is off. Allow it in Settings → Ghostgrid.');
        setMic(false);
        withMic = false;
      }
      const i = await Engine.start(bt, withMic, 5);
      R.current.info = i;
      setInfo(i);
    } catch (e) {
      setError(`Audio could not start: ${(e as Error).message}`);
    }
  }, [stopMetronome]);

  useEffect(() => {
    startEngine(true, false);
    setSources(Engine.midiSources());
    const subs = [
      Engine.addListener('onRouteChange', (i) => { R.current.info = i; setInfo(i); }),
      Engine.addListener('onMidiSources', (e) => setSources(e.sources)),
      Engine.addListener('onMicLevel', (e) => setMicLevel(e.level)),
      Engine.addListener('onPadHit', (e: PadHitEvent) => {
        const h = resolveNote({ ...DEFAULT_PAD_SETTINGS, preset: R.current.preset }, e.note, e.velocity);
        const key: string = h.id ? (h.open ? 'hh+o' : h.id) : `n${e.note}`;
        const name = h.id ? PAD_NAMES[key as PadKey] : 'not mapped';
        const off = score(e.time, 'pads', key);
        setLastHit(`Note ${e.note} → ${name} · velocity ${e.velocity}${off === null ? '' : ` · ${fmtMs(off)}`}`);
      }),
      Engine.addListener('onCaptureHit', (e: CaptureHitEvent) => {
        const off = score(e.time, 'mic', 'mic');
        setLastMic(off === null ? 'Heard a hit' : `Heard a hit · ${fmtMs(off)}`);
      }),
    ];
    return () => { subs.forEach((s) => s.remove()); stopMetronome(); Engine.stop(); };
  }, [startEngine, stopMetronome, score]);

  // ----- metronome -----
  const startMetronome = useCallback(() => {
    const r = R.current;
    if (!r.info) return;
    stopMetronome();
    const plan = new ClickPlan({ ...DEFAULT_CONFIG, bpm: r.bpm, beats, levels: defaultLevels(beats) });
    const s = new Scheduler<ClickStep>({ now: () => Engine.now() }, plan, (st, t) => {
      if (st.audible && st.level > 0) Engine.scheduleClick(t, st.level);
      if (st.sub === 0) {
        r.grid.push(t); if (r.grid.length > 64) r.grid.shift();
        r.visual.push({ t, beat: st.beat });
      }
    }, 0.25);
    s.start(Engine.now() + 0.15);
    r.scheduler = s;
    r.timer = setInterval(() => s.pump(), 20);
    r.running = true;
    setRunning(true);
  }, [beats, stopMetronome]);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const tick = () => {
      const r = R.current;
      const heard = Engine.now() - (r.info?.outputLatency ?? 0);
      let b: number | null = null;
      while (r.visual.length && r.visual[0].t <= heard) b = r.visual.shift()!.beat;
      if (b !== null) setBeat(b);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  // restart with new tempo or meter
  useEffect(() => { if (R.current.running) startMetronome(); }, [bpm, beats]); // eslint-disable-line react-hooks/exhaustive-deps

  const routeOk = info?.route === 'bluetooth';

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={s.scroll}>
        <View style={s.header}>
          <Text style={s.brand}>GHOSTGRID</Text>
          <Text style={s.tag}>iOS proof of concept</Text>
        </View>
        {!!error && <Text style={s.error}>{error}</Text>}

        {/* 1. Audio route */}
        <Card title="Audio out">
          <Row label="Playing through" value={info ? `${info.routeName || info.route}${routeOk ? ' · Bluetooth' : ''}` : 'starting…'} good={routeOk} />
          <Row label="Output delay" value={info ? `${Math.round(info.outputLatency * 1000)} ms` : '–'} />
          <Row label="Sample rate" value={info ? `${Math.round(info.sampleRate)} Hz` : '–'} />
          <ToggleRow label="Keep click on Bluetooth" hint="while the mic is on" value={keepBt}
            onChange={(v) => { setKeepBt(v); startEngine(v, mic); }} />
          <ToggleRow label="Microphone on" hint="test: does the click stay on Bluetooth?" value={mic}
            onChange={(v) => { setMic(v); startEngine(keepBt, v); }} />
          {mic && <View style={s.meter}><View style={[s.meterFill, { width: `${Math.min(100, Math.sqrt(micLevel / 0.6) * 100)}%` }]} /></View>}
          {mic && !!lastMic && <Text style={s.note}>{lastMic}</Text>}
        </Card>

        {/* 2. Metronome */}
        <Card title="Click">
          <View style={s.tempoRow}>
            <Btn label="−" onPress={() => setBpm((b) => Math.max(30, b - 1))} onLong={() => setBpm((b) => Math.max(30, b - 10))} round />
            <View style={s.tempoMid}>
              <Text style={s.bpm}>{bpm}</Text>
              <Text style={s.bpmLabel}>BPM · {tempoMarking(bpm)} · {beats}/4</Text>
            </View>
            <Btn label="+" onPress={() => setBpm((b) => Math.min(300, b + 1))} onLong={() => setBpm((b) => Math.min(300, b + 10))} round />
          </View>
          <View style={s.beats}>
            {Array.from({ length: beats }, (_, i) => (
              <View key={i} style={[s.beat, i === beat && s.beatOn, i === beat && i === 0 && s.beatAccent]}>
                <Text style={[s.beatText, i === beat && s.beatTextOn]}>{i + 1}</Text>
              </View>
            ))}
          </View>
          <View style={s.btnRow}>
            <Btn label="− beat" onPress={() => setBeats((b) => Math.max(2, b - 1))} />
            <Btn label="+ beat" onPress={() => setBeats((b) => Math.min(9, b + 1))} />
          </View>
          <Btn label={running ? 'Stop' : 'Play'} onPress={() => (running ? stopMetronome() : startMetronome())} primary active={running} />
        </Card>

        {/* 3. E-drum */}
        <Card title="E-drum (Bluetooth or USB MIDI)">
          <Text style={s.note}>{sources.length ? `Connected: ${sources.join(', ')}` : 'No MIDI device yet. Pair your module below, or connect it with a USB cable.'}</Text>
          <View style={s.btnRow}>
            <Btn label="Pair Bluetooth MIDI" onPress={() => Engine.showBluetoothMidi()} />
          </View>
          <View style={s.seg}>
            {(['roland', 'gm'] as Preset[]).map((p) => (
              <Pressable key={p} onPress={() => setPreset(p)} style={[s.segBtn, preset === p && s.segOn]} accessibilityRole="button">
                <Text style={[s.segText, preset === p && s.segTextOn]}>{p === 'roland' ? 'Roland TD' : 'General MIDI'}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.lastHit}>{lastHit}</Text>
        </Card>

        {/* 4. Timing */}
        <Card title="Timing per pad">
          <Text style={s.note}>Press Play and hit the pads on the click. Negative = early (rushing), positive = late.</Text>
          {stats.length === 0 && <Text style={s.empty}>No scored hits yet.</Text>}
          {stats.map((st) => (
            <View key={st.key} style={s.statRow}>
              <Text style={s.statName}>{st.label}</Text>
              <Text style={[s.statMean, { color: Math.abs(st.mean) <= TOL_MS ? C.good : st.mean < 0 ? C.early : C.late }]}>{fmtMs(st.mean)}</Text>
              <Text style={s.statSd}>±{Math.round(st.sd)} ms · {st.n}</Text>
            </View>
          ))}
          <Row label="Delay fix · pads" value={`${calib.pads > 0 ? '+' : ''}${calib.pads} ms`} />
          <Row label="Delay fix · mic" value={`${calib.mic > 0 ? '+' : ''}${calib.mic} ms`} />
          {calibrating && <Text style={s.calibMsg}>Calibrating {calibrating}: play right on the click · {calibCount}/{CALIB_HITS}</Text>}
          <View style={s.btnRow}>
            <Btn label="Calibrate pads" onPress={() => { R.current.calibRaw = []; setCalibCount(0); setCalibrating('pads'); if (!running) startMetronome(); }} />
            {mic && <Btn label="Calibrate mic" onPress={() => { R.current.calibRaw = []; setCalibCount(0); setCalibrating('mic'); if (!running) startMetronome(); }} />}
            <Btn label="Reset" onPress={() => { R.current.log.reset(); refreshStats(); }} />
          </View>
        </Card>
        <Text style={s.footer}>Ghostgrid 0.1 · step 2 of the roadmap</Text>
      </ScrollView>
    </View>
  );
}

const fmtMs = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)} ms`;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}
function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, good && { color: C.good }]}>{value}</Text>
    </View>
  );
}
function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowLabel}>{label}</Text>
        {!!hint && <Text style={s.hint}>{hint}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: C.accent, false: C.line }} accessibilityLabel={label} />
    </View>
  );
}
function Btn({ label, onPress, onLong, primary, active, round }: { label: string; onPress: () => void; onLong?: () => void; primary?: boolean; active?: boolean; round?: boolean }) {
  return (
    <Pressable onPress={onPress} onLongPress={onLong} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.btn, round && s.round, primary && s.primary, active && s.primaryActive, pressed && { opacity: 0.7 }]}>
      <Text style={[s.btnText, round && s.roundText, primary && s.primaryText, active && s.primaryActiveText]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, gap: 14, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 10, minHeight: 44 },
  brand: { color: C.fg, fontSize: 24, fontWeight: '800', letterSpacing: 1.5, fontFamily: F.display },
  tag: { color: C.muted, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  error: { color: C.late, fontSize: 14 },
  card: { backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  cardTitle: { color: C.muted, fontSize: 12, fontWeight: '600', letterSpacing: 1.6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: 12 },
  rowLabel: { color: C.fg, fontSize: 15, fontWeight: '500' },
  rowValue: { color: C.fg, fontSize: 15, fontFamily: F.mono },
  hint: { color: C.muted, fontSize: 12 },
  note: { color: C.muted, fontSize: 14 },
  empty: { color: C.muted, fontSize: 14, fontStyle: 'italic' },
  meter: { height: 8, borderRadius: 4, backgroundColor: C.raised, overflow: 'hidden' },
  meterFill: { height: 8, backgroundColor: C.fg },
  tempoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tempoMid: { alignItems: 'center', flex: 1 },
  bpm: { color: C.fg, fontSize: 88, fontWeight: '800', fontVariant: ['tabular-nums'], lineHeight: 92 },
  bpmLabel: { color: C.muted, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' },
  beats: { flexDirection: 'row', justifyContent: 'center', gap: 8, flexWrap: 'wrap', marginVertical: 6 },
  beat: { width: 48, height: 56, borderRadius: 12, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  beatOn: { backgroundColor: C.fg, borderColor: C.fg },
  beatAccent: { backgroundColor: C.accent, borderColor: C.accent },
  beatText: { color: C.fg, fontSize: 20, fontWeight: '800' },
  beatTextOn: { color: C.bg },
  btnRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btn: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: C.fg, fontSize: 15, fontWeight: '600' },
  round: { width: 56, height: 56, borderRadius: 28, paddingHorizontal: 0 },
  roundText: { fontSize: 28, fontWeight: '400' },
  primary: { minHeight: 60, borderRadius: 16, backgroundColor: C.accent, marginTop: 4 },
  primaryText: { color: C.accentInk, fontSize: 22, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
  primaryActive: { backgroundColor: C.fg },
  primaryActiveText: { color: C.bg },
  seg: { flexDirection: 'row', backgroundColor: C.raised, borderRadius: 12, padding: 3, gap: 2 },
  segBtn: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: C.surface },
  segText: { color: C.muted, fontSize: 14, fontWeight: '600' },
  segTextOn: { color: C.fg },
  lastHit: { color: C.fg, fontSize: 15, fontFamily: F.mono, minHeight: 22 },
  statRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, minHeight: 36 },
  statName: { color: C.fg, fontSize: 15, fontWeight: '600', width: 110 },
  statMean: { fontSize: 18, fontFamily: F.mono, fontWeight: '600', width: 90 },
  statSd: { color: C.muted, fontSize: 13, fontFamily: F.mono },
  calibMsg: { color: C.accent, fontSize: 14, fontWeight: '600' },
  footer: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 4 },
});
