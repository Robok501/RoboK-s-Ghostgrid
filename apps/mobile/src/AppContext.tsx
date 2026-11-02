/**
 * App-wide state: saved settings, the native engine (start/restart, route info) and device input
 * (e-drum pads via MIDI incl. hi-hat pedal, microphone hits). Screens subscribe to input events with `on()`.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { HH_PEDAL_CC, PAD_NAMES, learnPad, resolveNote, stateFor, type NoteState, type PadKey, type PadSettings } from '@ghostgrid/core';
import Engine, { type EngineInfo } from '../modules/ghostgrid-engine';
import { loadSettings, saveSettings, type AppSettings, type ClickSettings, type EarSettings, type SketchSettings } from './store';

export interface PadEvent { time: number; note: number; vel: number; key: string; name: string; state: NoteState; mapped: boolean }
export interface MicEvent { time: number; peak: number }
type EventMap = { pad: PadEvent; mic: MicEvent; restart: null };
type Listener<K extends keyof EventMap> = (e: EventMap[K]) => void;

interface Ctx {
  settings: AppSettings;
  setClick: (patch: Partial<ClickSettings> | ((c: ClickSettings) => Partial<ClickSettings>)) => void;
  setSketch: (patch: Partial<SketchSettings>) => void;
  setEar: (patch: Partial<EarSettings> | ((e: EarSettings) => Partial<EarSettings>)) => void;
  setKeepBt: (v: boolean) => void;
  setMicSens: (v: number) => void;
  setPads: (fn: (p: PadSettings) => PadSettings) => void;
  info: EngineInfo | null;
  error: string;
  mic: boolean;
  setMic: (on: boolean) => Promise<boolean>;
  sources: string[];
  pedal: number | null;
  lastHit: string;
  micLevel: number;
  learning: PadKey | null;
  setLearning: (k: PadKey | null) => void;
  on: <K extends keyof EventMap>(type: K, cb: Listener<K>) => () => void;
  /** stop whatever is playing (click, sketch, trainer), e.g. before another screen starts its own sound */
  stopAll: () => void;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [error, setError] = useState('');
  const [mic, setMicState] = useState(false);
  const micRef = useRef(false);
  micRef.current = mic;
  const [sources, setSources] = useState<string[]>([]);
  const [pedal, setPedal] = useState<number | null>(null);
  const [lastHit, setLastHit] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const [learning, setLearning] = useState<PadKey | null>(null);

  const S = useRef(settings);
  S.current = settings;
  const pedalRef = useRef<number | null>(null);
  const learnRef = useRef<PadKey | null>(null);
  learnRef.current = learning;
  const listeners = useRef<{ [K in keyof EventMap]: Set<Listener<K>> }>({ pad: new Set(), mic: new Set(), restart: new Set() });

  const emit = useCallback(<K extends keyof EventMap>(type: K, e: EventMap[K]) => {
    (listeners.current[type] as Set<Listener<K>>).forEach((cb) => cb(e));
  }, []);
  const on = useCallback(<K extends keyof EventMap>(type: K, cb: Listener<K>) => {
    const set = listeners.current[type] as Set<Listener<K>>;
    set.add(cb);
    return () => { set.delete(cb); };
  }, []);

  const update = useCallback((fn: (s: AppSettings) => AppSettings) => {
    setSettings((prev) => { const next = fn(prev); saveSettings(next); return next; });
  }, []);
  const setClick = useCallback<Ctx['setClick']>((patch) => {
    update((s) => ({ ...s, click: { ...s.click, ...(typeof patch === 'function' ? patch(s.click) : patch) } }));
  }, [update]);
  const setEar = useCallback<Ctx['setEar']>((patch) => {
    update((s) => ({ ...s, ear: { ...s.ear, ...(typeof patch === 'function' ? patch(s.ear) : patch) } }));
  }, [update]);
  const setSketch = useCallback<Ctx['setSketch']>((patch) => update((s) => ({ ...s, sketch: { ...s.sketch, ...patch } })), [update]);
  const setPads = useCallback<Ctx['setPads']>((fn) => update((s) => ({ ...s, pads: fn(s.pads) })), [update]);

  const start = useCallback(async (keepBt: boolean, withMic: boolean) => {
    emit('restart', null);
    setError('');
    try {
      if (withMic && !(await Engine.requestMicPermission())) {
        setError('Microphone access is off. Allow it in Settings → Ghostgrid.');
        withMic = false;
      }
      const i = await Engine.start(keepBt, withMic, S.current.micSens);
      Engine.setClickSound(S.current.click.sound);
      setInfo(i);
      setMicState(i.mic);
      return i.mic === withMic;
    } catch (e) {
      setError(`Audio could not start: ${(e as Error).message}`);
      return false;
    }
  }, [emit]);

  const setKeepBt = useCallback((v: boolean) => {
    update((s) => ({ ...s, keepBt: v }));
    start(v, mic);
  }, [update, start, mic]);
  const sensTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setMicSens = useCallback((v: number) => {
    update((s) => ({ ...s, micSens: v }));
    // the live hit detector takes the new value when the engine restarts; wait until the stepper settles
    if (sensTimer.current) clearTimeout(sensTimer.current);
    sensTimer.current = setTimeout(() => { if (micRef.current) start(S.current.keepBt, true); }, 600);
  }, [update, start]);
  const setMic = useCallback((onOff: boolean) => start(S.current.keepBt, onOff), [start]);

  // Pedal moves (dozens of messages a second), pad hits and mic levels are shown on screen, but every change of
  // this context re-renders every screen. So the displayed values update at most ~8 times a second;
  // the hits themselves still go to the listeners immediately.
  const shown = useRef({ pedal: null as number | null, hit: '', level: 0, timer: null as ReturnType<typeof setTimeout> | null });
  const flushShown = useCallback(() => {
    const v = shown.current;
    v.timer = null;
    setPedal(v.pedal); setLastHit(v.hit); setMicLevel(v.level);
  }, []);
  const showLater = useCallback(() => { if (!shown.current.timer) shown.current.timer = setTimeout(flushShown, 120); }, [flushShown]);

  useEffect(() => {
    start(S.current.keepBt, false);
    setSources(Engine.midiSources());
    const subs = [
      Engine.addListener('onRouteChange', (i) => setInfo(i)),
      Engine.addListener('onMidiSources', (e) => setSources(e.sources)),
      Engine.addListener('onMicLevel', (e) => { shown.current.level = e.level; showLater(); }),
      Engine.addListener('onControl', (e) => {
        if (e.cc !== HH_PEDAL_CC) return;
        pedalRef.current = e.value;
        shown.current.pedal = e.value; showLater();
      }),
      Engine.addListener('onPadHit', (e) => {
        if (learnRef.current) {
          const k = learnRef.current;
          update((s) => ({ ...s, pads: learnPad(s.pads, e.note, k) }));
          setLearning(null);
          setLastHit(`Note ${e.note} is now ${PAD_NAMES[k]}`);
          return;
        }
        const h = resolveNote(S.current.pads, e.note, e.velocity, pedalRef.current);
        const key = h.id ? (h.open ? 'hh+o' : h.id) : `n${e.note}`;
        const name = h.id ? PAD_NAMES[key as PadKey] : `Note ${e.note}`;
        shown.current.hit = `Note ${e.note} → ${h.id ? name : 'not mapped'} · velocity ${e.velocity}`; showLater();
        emit('pad', { time: e.time, note: e.note, vel: e.velocity, key, name, state: stateFor(S.current.pads, h), mapped: !!h.id });
      }),
      Engine.addListener('onCaptureHit', (e) => emit('mic', { time: e.time, peak: e.peak })),
    ];
    return () => { subs.forEach((s) => s.remove()); Engine.stop(); };
  }, [start, emit, update, showLater]);

  const value = useMemo<Ctx>(() => ({
    stopAll: () => emit('restart', null),
    settings, setClick, setEar, setSketch, setKeepBt, setMicSens, setPads, info, error, mic, setMic, sources, pedal, lastHit, micLevel, learning, setLearning, on,
  }), [settings, setClick, setEar, setSketch, setKeepBt, setMicSens, setPads, info, error, mic, setMic, sources, pedal, lastHit, micLevel, learning, on]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
