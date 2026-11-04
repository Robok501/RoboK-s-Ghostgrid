/**
 * Click Coach runtime: turns the saved settings into a ClickPlan, keeps the native engine fed with clicks,
 * shows which step is being heard, and scores hits (tap pad, mic, e-drum pads) against the clicks.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import {
  ClickPlan, HitLog, OFF_GRID_MS, Scheduler, calibrateOnBeat, gridOffset, levelsFor, tapTempo,
  type ClickStep, type TrainingConfig,
} from '@ghostgrid/core';
import Engine from '../../modules/ghostgrid-engine';
import { useApp } from '../AppContext';
import type { ClickSettings, CoachInput } from '../store';

export const CALIB_HITS = 8;
const LOOKAHEAD = 0.3;

function configFrom(c: ClickSettings): TrainingConfig {
  return {
    mode: c.mode, bpm: c.bpm, beats: c.beats, sub: c.sub, levels: levelsFor(c.levels, c.beats),
    gapOn: c.gapOn, gapOff: c.gapOff,
    dropUnit: c.dropUnit, dropChance: c.dropChance, dropLen: c.dropLen, dropWarm: c.dropWarm,
    rampStep: c.rampStep, rampEvery: c.rampEvery, rampTarget: c.rampTarget,
    program: c.program.map((s) => ({ ...s })), loop: c.loop,
  };
}
/** Settings that need a fresh plan when they change while playing. */
const restartKey = (c: ClickSettings) => JSON.stringify([c.mode, c.sub, c.program, c.loop, c.grade]);

export function useClick() {
  const { settings, setClick, info, on, mic } = useApp();
  const c = settings.click;
  const cRef = useRef(c);
  cRef.current = c;

  const R = useRef({
    running: false,
    plan: null as ClickPlan | null,
    cfg: null as TrainingConfig | null,
    scheduler: null as Scheduler<ClickStep> | null,
    timer: null as ReturnType<typeof setInterval> | null,
    grid: [] as number[],
    /** beat times only (calibration always measures against the beats) */
    beats: [] as number[],
    visual: [] as { t: number; st: ClickStep }[],
    log: new HitLog(),
    calibrating: null as CoachInput | null,
    calibRaw: [] as number[],
    outLat: 0,
    taps: [] as number[],
    key: '',
  });
  R.current.outLat = info?.outputLatency ?? 0;

  const [running, setRunning] = useState(false);
  const [cur, setCur] = useState<ClickStep | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [calibrating, setCalibratingState] = useState<CoachInput | null>(null);
  const [calibCount, setCalibCount] = useState(0);
  /** result of the last calibration: correction and how far the hits still spread around it (ms) */
  const [calibInfo, setCalibInfo] = useState<{ input: CoachInput; fix: number; spread: number } | null>(null);
  const [hitsVersion, bump] = useReducer((x: number) => x + 1, 0);

  const stop = useCallback(() => {
    const r = R.current;
    r.scheduler?.stop();
    if (r.timer) clearInterval(r.timer);
    r.timer = null; r.scheduler = null; r.plan = null; r.running = false;
    try { Engine.cancelAfter(Engine.now()); } catch { /* engine restarting */ }
    r.visual = []; r.grid = []; r.beats = [];
    setRunning(false);
    setCur(null);
    deactivateKeepAwake('click');
  }, []);

  const start = useCallback((fromSection = 0) => {
    const r = R.current;
    stop();
    const cfg = configFrom(cRef.current);
    const plan = new ClickPlan(cfg, Math.random, fromSection);
    const s = new Scheduler<ClickStep>({ now: () => Engine.now() }, plan, (st, t) => {
      if (st.audible && st.level > 0) Engine.scheduleClick(t, st.level);
      if (cRef.current.grade === 'sub' || st.sub === 0) { r.grid.push(t); if (r.grid.length > 96) r.grid.shift(); }
      if (st.sub === 0) { r.beats.push(t); if (r.beats.length > 64) r.beats.shift(); }
      r.visual.push({ t, st });
    }, LOOKAHEAD);
    s.start(Engine.now() + 0.12);
    Object.assign(r, { plan, cfg, scheduler: s, running: true, key: restartKey(cRef.current) });
    r.timer = setInterval(() => s.pump(), 20);
    setRunning(true);
    activateKeepAwakeAsync('click').catch(() => {});
  }, [stop]);

  // follow settings while playing: tempo and per-bar settings live, structural changes restart
  useEffect(() => {
    const r = R.current;
    if (!r.running || !r.plan || !r.cfg) return;
    if (restartKey(c) !== r.key) { start(); return; }
    Object.assign(r.cfg, configFrom(c), { program: r.cfg.program });
    if (c.mode !== 'ramp') r.plan.setBpm(c.bpm);
  }, [c, start]);

  // the beat being heard right now
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const tick = () => {
      const r = R.current;
      const heard = Engine.now() - r.outLat;
      let latest: ClickStep | null = null;
      while (r.visual.length && r.visual[0].t <= heard) latest = r.visual.shift()!.st;
      if (latest) setCur(latest);
      if (r.scheduler && !r.scheduler.isRunning && !r.visual.length) { stop(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, stop]);

  /** Score a hit at engine time `time`; returns the offset in ms or null. */
  const score = useCallback((time: number, input: CoachInput, pad?: string) => {
    const r = R.current, cs = cRef.current;
    if (!r.running || !r.plan) return null;
    const beat = 60 / r.plan.tempo;
    if (r.calibrating === input) {
      // calibration: against the beats only, over the whole beat, without the old correction
      // (with subdivisions on, a late hit used to lock onto the wrong 16th, and the result was off by a 16th)
      const raw = gridOffset(time - r.outLat, r.beats, beat, 1);
      if (raw === null) return null;
      r.calibRaw.push(raw * 1000);
      setCalibCount(r.calibRaw.length);
      if (r.calibRaw.length >= CALIB_HITS) {
        const { fix, spread } = calibrateOnBeat(r.calibRaw, beat * 1000);
        setCalibInfo({ input, fix, spread });
        setClick((cc) => ({ calib: { ...cc.calib, [input]: fix } }));
        r.calibrating = null;
        setCalibratingState(null);
        r.log.reset();
        setLast(null);
        bump();
      }
      return null;
    }
    // the device's delay is taken off BEFORE finding the nearest click: with a big correction (Bluetooth audio),
    // a hit used to be matched to the wrong click first and then corrected, which made calibrating worse
    const step = beat / (cs.grade === 'sub' ? cs.sub : 1);
    const raw = gridOffset(time - r.outLat + cs.calib[input] / 1000, r.grid, step);
    if (raw === null) { if (r.grid.length) r.log.addOff(pad ?? input); return null; }
    const off = raw * 1000;
    // far from every grid point: a ghost note, fill or other subdivision. Shown as a count, not scored.
    if (Math.abs(off) > OFF_GRID_MS) { r.log.addOff(pad ?? input); bump(); return null; }
    r.log.add(off, pad ?? input);
    setLast(off);
    bump();
    return off;
  }, [setClick]);

  // device input
  useEffect(() => {
    const offs = [
      on('restart', () => stop()),
      on('pad', (e) => { if (cRef.current.input === 'pads') score(e.time, 'pads', e.key); }),
      on('mic', (e) => { if (cRef.current.input === 'mic') score(e.time, 'mic', 'mic'); }),
    ];
    return () => offs.forEach((f) => f());
  }, [on, score, stop]);

  /** On-screen tap pad: React Native touch timestamps are ms since boot, the engine converts them. */
  const tap = useCallback((timestampMs: number) => {
    if (!R.current.running) return false;
    const now = Engine.now();
    let t = Engine.uptimeToEngine(timestampMs / 1000);
    // safety net: if the touch clock is not what we expect, use the engine's own clock
    if (!isFinite(t) || Math.abs(t - now) > 1.5) t = now;
    score(t, 'tap', 'tap');
    return true;
  }, [score]);

  const startCalibration = useCallback((input: CoachInput) => {
    const r = R.current;
    r.calibRaw = [];
    r.calibrating = input;
    setCalibCount(0);
    setCalibratingState(input);
    if (!r.running) start();
  }, [start]);

  const resetHits = useCallback(() => { R.current.log.reset(); setLast(null); bump(); }, []);

  const tapTempoAt = useCallback((ms: number) => {
    const r = R.current;
    r.taps.push(ms);
    if (r.taps.length > 8) r.taps.shift();
    const bpm = tapTempo(r.taps);
    if (bpm) setClick({ bpm: Math.max(20, Math.min(300, Math.round(bpm))) });
  }, [setClick]);

  return {
    running, start, stop, cur, last, log: R.current.log, hitsVersion, calibrating, calibCount, calibInfo,
    startCalibration, resetHits, tap, tapTempoAt, mic,
    tempo: running && cur ? cur.bpm : c.bpm,
  };
}
