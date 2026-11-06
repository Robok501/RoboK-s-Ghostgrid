/**
 * Browser version of the native engine: click and drum sounds on the Web Audio clock, e-drum input over Web MIDI.
 * Same calls and events as modules/ghostgrid-engine (iOS), so the screens do not know the difference.
 * Chrome/Edge on Android and desktop: Web MIDI works. Safari (iPhone) has no Web MIDI; use the iOS app there.
 * Not done yet here: microphone hits and recording, songs/stems.
 */
import { DRUM_SOUNDS } from '@ghostgrid/core';

type Listener = (e: any) => void;
type ClickName = 'click' | 'wood' | 'cowbell' | 'hat';

const listeners: Record<string, Listener[]> = {};
const emit = (name: string, e: unknown) => (listeners[name] ?? []).slice().forEach((f) => f(e));

let ctx: AudioContext | null = null;
let buffers: AudioBuffer[] = [];
let clickSound: ClickName = 'click';
let midi: MIDIAccess | null = null;
let midiError = '';
let micOn = false;
const pending: { t: number; src: AudioBufferSourceNode }[] = [];

// small seeded noise, like the native synthesis
function rng(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 4294967295) * 2 - 1; }; }

function make(sr: number, name: ClickName): Float32Array[] {
  const noise = rng(12345);
  const env = (t: number, dur: number) => Math.min(1, t / 0.0015) * Math.exp(-t / (dur / 5));
  const render = (dur: number, f: (t: number) => number) => { const n = Math.floor(sr * dur), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = f(i / sr); return a; };
  const tri = (fr: number, t: number) => { const x = (fr * t) % 1; return 4 * Math.abs(x - 0.5) - 1; };
  const sq = (fr: number, t: number) => (Math.sin(2 * Math.PI * fr * t) >= 0 ? 1 : -1);
  const one = (level: number) => {
    const gain = [0.28, 0.6, 0.95][level], acc = level === 2, sub = level === 0;
    switch (name) {
      case 'wood': { const f = acc ? 1180 : sub ? 640 : 860; let prev = 0; return render(0.06, (t) => { const n = noise(); const hp = n - prev; prev = n; return (tri(f, t) * 0.9 + hp * 0.25 * Math.exp(-t / 0.004)) * env(t, 0.06) * gain; }); }
      case 'cowbell': { const m = acc ? 1.25 : sub ? 0.85 : 1; return render(0.16, (t) => (sq(540 * m, t) + sq(800 * m, t)) * 0.18 * env(t, 0.16) * gain); }
      case 'hat': { const dur = acc ? 0.14 : 0.05; let p1 = 0, p2 = 0; return render(dur, (t) => { const n = noise(); const h1 = n - p1; p1 = n; const h2 = h1 - p2; p2 = h1; return h2 * 0.35 * env(t, dur) * gain; }); }
      default: { const f = acc ? 1760 : sub ? 990 : 1320; const dur = acc ? 0.045 : sub ? 0.035 : 0.04; return render(dur, (t) => Math.sin(2 * Math.PI * f * t) * env(t, dur) * gain); }
    }
  };
  return [one(0), one(1), one(2)];
}

function drums(sr: number): Float32Array[] {
  const noise = rng(987);
  const render = (dur: number, f: (t: number) => number) => { const n = Math.floor(sr * dur), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = f(i / sr); return a; };
  const attack = (t: number) => Math.min(1, t / 0.001);
  const kick = render(0.4, (t) => Math.sin(2 * Math.PI * (48 * t + 90 * 0.035 * (1 - Math.exp(-t / 0.035)))) * Math.exp(-t / 0.13) * attack(t) * 0.85);
  const snare = (g: number) => { let prev = 0; return render(0.25, (t) => { const n = noise(); const hp = n - prev * 0.6; prev = n; return (hp * 0.5 * Math.exp(-t / 0.055) + Math.sin(2 * Math.PI * 185 * t) * 0.45 * Math.exp(-t / 0.035)) * attack(t) * g; }); };
  const hat = (dur: number, g: number) => { let p1 = 0, p2 = 0; return render(dur, (t) => { const n = noise(); const h1 = n - p1; p1 = n; const h2 = h1 - p2; p2 = h1; return h2 * Math.exp(-t / (dur / 5)) * attack(t) * g; }); };
  const click = (f: number, g: number) => render(0.045, (t) => Math.sin(2 * Math.PI * f * t) * Math.min(1, t / 0.0015) * Math.exp(-t / 0.009) * g);
  const tom = (f0: number, dur: number) => render(dur, (t) => Math.sin(2 * Math.PI * (f0 * t + f0 * 0.5 * 0.04 * (1 - Math.exp(-t / 0.04)))) * Math.exp(-t / (dur / 4)) * attack(t) * 0.7);
  const sq = (fr: number, t: number) => (Math.sin(2 * Math.PI * fr * t) >= 0 ? 1 : -1);
  const cymbal = (dur: number, g: number, bell: number) => { let p1 = 0, p2 = 0; return render(dur, (t) => { const n = noise(); const h1 = n - p1; p1 = n; const h2 = h1 - p2; p2 = h1; const metal = (sq(3140, t) + sq(4410, t) * 0.7 + sq(5930, t) * 0.5) * 0.08; return (h2 * 0.6 + metal + Math.sin(2 * Math.PI * 2350 * t) * bell * Math.exp(-t / 0.25)) * Math.exp(-t / (dur / 5)) * attack(t) * g; }); };
  const rim = render(0.05, (t) => (Math.sin(2 * Math.PI * 1700 * t) * 0.6 + noise() * 0.3) * Math.exp(-t / 0.008) * attack(t) * 0.7);
  return [kick, snare(0.8), snare(0.18), hat(0.05, 0.16), hat(0.06, 0.3), hat(0.35, 0.22), click(1320, 0.6), click(1760, 0.95),
    tom(210, 0.5), tom(160, 0.55), tom(105, 0.7), cymbal(0.9, 0.16, 0.25), cymbal(1.8, 0.3, 0), hat(0.04, 0.12), rim];
}

if (typeof window !== 'undefined') (window as any).__ggDebug = () => ({ state: ctx?.state, t: ctx?.currentTime, pending: pending.length, sr: ctx?.sampleRate, buffers: buffers.length, peak: buffers.slice(0, 3).map((b) => Math.max(...b.getChannelData(0).map(Math.abs))) });

function context(): AudioContext {
  if (!ctx) {
    const AC = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' }) as AudioContext;
    buildBuffers();
    // browsers keep audio off until the first tap or key press
    const wake = () => { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) globalThis.addEventListener?.(ev, wake, { passive: true } as any);
  }
  return ctx;
}

function buildBuffers() {
  const c = ctx!;
  const raw = [...make(c.sampleRate, clickSound), ...drums(c.sampleRate)];
  buffers = raw.map((a) => { const b = c.createBuffer(1, a.length, c.sampleRate); b.copyToChannel(a, 0); return b; });
}

function play(time: number, index: number, gain: number) {
  const c = context();
  const buf = buffers[index];
  if (!buf || time < c.currentTime) return; // too late: like the native engine, drop it
  const src = c.createBufferSource();
  src.buffer = buf;
  if (gain !== 1) { const g = c.createGain(); g.gain.value = gain; src.connect(g); g.connect(c.destination); } else src.connect(c.destination);
  const entry = { t: time, src };
  pending.push(entry);
  src.onended = () => { const i = pending.indexOf(entry); if (i >= 0) pending.splice(i, 1); };
  src.start(time);
}

/** performance.now()-style milliseconds (MIDI timestamps) to engine seconds */
function perfToEngine(ms: number): number {
  const c = context();
  const ts = c.getOutputTimestamp?.();
  if (ts && ts.performanceTime && ts.contextTime !== undefined) return ts.contextTime + (ms - ts.performanceTime) / 1000;
  return c.currentTime + (ms - performance.now()) / 1000;
}

let sources: string[] = [];
function refreshSources() {
  const names: string[] = [];
  midi?.inputs.forEach((i) => { if (i.state !== 'disconnected') names.push(i.name || 'MIDI'); });
  const same = names.length === sources.length && names.every((n, i) => n === sources[i]);
  sources = names;
  if (!same) emit('onMidiSources', { sources });
}
function onMessage(ev: MIDIMessageEvent, name: string) {
  const d = ev.data;
  if (!d || d.length < 2) return;
  const status = d[0], kind = status & 0xf0, channel = status & 0x0f;
  const time = perfToEngine(ev.timeStamp || performance.now());
  if (kind === 0x90 && d.length >= 3 && d[2] > 0) emit('onPadHit', { time, note: d[1], velocity: d[2], channel, source: name });
  else if (kind === 0xb0 && d.length >= 3) emit('onControl', { time, cc: d[1], value: d[2], channel, source: name });
}
async function setupMidi() {
  if (midi) return;
  if (!(navigator as any).requestMIDIAccess) { midiError = 'This browser has no MIDI support. Use Chrome or Edge on Android or a computer.'; return; }
  try {
    midiError = '';
    midi = await (navigator as any).requestMIDIAccess({ sysex: false });
    const hook = () => { midi!.inputs.forEach((i) => { i.onmidimessage = (ev) => onMessage(ev as MIDIMessageEvent, i.name || 'MIDI'); }); refreshSources(); };
    midi!.onstatechange = hook;
    hook();
  } catch (e) { midiError = (e as Error).message || 'MIDI access was refused.'; emit('onMidiSources', { sources }); }
}

function info() {
  const c = ctx;
  const out = c ? (c.outputLatency || 0) + (c.baseLatency || 0) : 0;
  return {
    running: !!c && c.state === 'running', sampleRate: c?.sampleRate ?? 48000, outputLatency: out, inputLatency: 0.01,
    ioBuffer: c?.baseLatency ?? 0.01, route: 'other' as const, routeName: midiError ? 'Web audio (no MIDI)' : 'Web audio', mic: micOn,
  };
}

export const webEngine: Record<string, unknown> = {
  now: () => (ctx ? ctx.currentTime : 0),
  ensureRunning: (force: boolean) => {
    const c = context();
    if (force || c.state !== 'running') { c.resume().catch(() => {}); return true; }
    return false;
  },
  start: async (_keepBt: boolean, _mic: boolean) => {
    const c = context();
    // MIDI first: the audio context may stay suspended until the first tap, and that must not hold MIDI back
    c.resume().catch(() => {});
    await setupMidi();
    return info();
  },
  stop: async () => { /* the page owns the audio context; nothing to release */ },
  info,
  requestMicPermission: async () => false,
  midiSources: () => sources,
  midiError: () => midiError,
  /** ask for MIDI access again (after a refusal), from a button press */
  connectMidi: async () => { if (!midi) midiError = ''; await setupMidi(); refreshSources(); emit('onMidiSources', { sources }); return midiError; },
  showBluetoothMidi: async () => {},
  uptimeToEngine: (u: number) => perfToEngine(u * 1000),
  scheduleClick: (time: number, level: number) => { if (level > 0) play(time, Math.min(Math.max(level, 1), 3) - 1, 1); },
  scheduleDrum: (time: number, sound: number, gain: number) => { if (sound >= 0 && sound < DRUM_SOUNDS.length) play(time, 3 + sound, gain); },
  cancelAfter: (time: number) => {
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].t > time) { try { pending[i].src.stop(); pending[i].src.disconnect(); } catch { /* already done */ } pending.splice(i, 1); }
    }
  },
  setClickSound: (name: ClickName) => { clickSound = name; if (ctx) buildBuffers(); },
  addListener: (name: string, f: Listener) => {
    (listeners[name] ||= []).push(f);
    return { remove() { listeners[name] = (listeners[name] ?? []).filter((g) => g !== f); } };
  },
};
