/**
 * Browser version of the native engine: click and drum sounds on the Web Audio clock, e-drum input over Web MIDI.
 * Same calls and events as modules/ghostgrid-engine (iOS), so the screens do not know the difference.
 * Chrome/Edge on Android and desktop: Web MIDI works. Safari (iPhone) has no Web MIDI; use the iOS app there.
 * Not done yet here: microphone hits and recording, songs/stems.
 */
import { BleClock, DRUM_SOUNDS, parseBleMidi } from '@ghostgrid/core';

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

if (typeof window !== 'undefined') (window as any).__ggMidi = (bytes: number[]) => handleMidi(bytes, performance.now(), 'test');
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
  // simple and always in the right neighbourhood: the engine clock now, minus how long ago the event was
  const simple = c.currentTime + (ms - performance.now()) / 1000;
  const ts = c.getOutputTimestamp?.();
  if (ts && ts.performanceTime && ts.contextTime !== undefined) {
    const precise = ts.contextTime + (ms - ts.performanceTime) / 1000;
    // the precise pairing is better, but some browsers (Android Chrome) give a stale or odd pair: then it is far from the simple value
    if (Math.abs(precise - simple) < 0.05) return precise;
  }
  return simple;
}

let sources: string[] = [];
const bleNames = new Set<string>();
function refreshSources() {
  const names: string[] = [];
  midi?.inputs.forEach((i) => { if (i.state !== 'disconnected') names.push(i.name || 'MIDI'); });
  bleNames.forEach((n) => names.push(`${n} (Bluetooth)`));
  const same = names.length === sources.length && names.every((n, i) => n === sources[i]);
  sources = names;
  if (!same) emit('onMidiSources', { sources });
}
function onMessage(ev: MIDIMessageEvent, name: string) {
  if (ev.data) handleMidi(Array.from(ev.data), ev.timeStamp || performance.now(), name);
}
function handleMidi(d: number[], ms: number, name: string) {
  if (!d || d.length < 2) return;
  const status = d[0], kind = status & 0xf0, channel = status & 0x0f;
  const time = perfToEngine(ms);
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

// ---- microphone: raw capture through an AudioWorklet (no echo cancelling, no noise suppression, no auto gain) ----
let keepNode: OscillatorNode | null = null;
let micStream: MediaStream | null = null;
let micNode: AudioWorkletNode | null = null;
let micError = '';
let recording = false;
let recChunks: Float32Array[] = [];
let recStart = 0;
let recFrames = 0;
const WORKLET = `class GGRec extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.port.onmessage = (e) => { this.on = !!e.data; }; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (this.on && ch) this.port.postMessage({ t: currentTime, d: ch.slice() });
    return true;
  }
}
registerProcessor('gg-rec', GGRec);`;

async function micOnOff(on: boolean): Promise<boolean> {
  if (!on) {
    recording = false;
    try { micNode?.disconnect(); } catch { /* gone */ }
    micNode = null;
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null; micOn = false;
    return true;
  }
  if (micStream && micNode) { micOn = true; return true; }
  try {
    micError = '';
    const c = context();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } as MediaTrackConstraints });
    if (!(c as any).audioWorklet) throw new Error('This browser cannot record raw audio (no AudioWorklet).');
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await c.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = c.createMediaStreamSource(micStream);
    micNode = new AudioWorkletNode(c, 'gg-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    micNode.port.onmessage = (e: MessageEvent) => {
      if (!recording) return;
      if (!recFrames) recStart = e.data.t;
      recChunks.push(e.data.d); recFrames += e.data.d.length;
    };
    // some browsers only run a worklet that ends in the destination; silence it
    const mute = c.createGain(); mute.gain.value = 0;
    src.connect(micNode); micNode.connect(mute); mute.connect(c.destination);
    micOn = true;
    return true;
  } catch (e) {
    micError = (e as Error).message || 'The microphone could not start.';
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null; micNode = null; micOn = false;
    return false;
  }
}

const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
const BLE_MIDI_CHAR = '7772e5db-3868-4112-a1a9-f2669d106bf3';
let bleError = '';
// ---- MIDI out (clock, start/stop, notes) to the connected module: Bluetooth MIDI first, otherwise a MIDI output port ----
let bleOut: any = null;
let bleOutName = '';
let outQueue: { ts: number; data: number[] }[] = [];
let outBusy: Promise<void> = Promise.resolve();
function bleFlush() {
  const q = outQueue; outQueue = [];
  while (q.length && bleOut) {
    // one BLE MIDI packet: header (timestamp high), then per message a timestamp byte and the message; 20 bytes at most
    const first = Math.round(q[0].ts) & 0x1fff;
    const bytes = [0x80 | ((first >> 7) & 0x3f)];
    while (q.length) {
      const m = q[0];
      if (bytes.length + 1 + m.data.length > 20) break;
      bytes.push(0x80 | (Math.round(m.ts) & 0x7f), ...m.data);
      q.shift();
    }
    const ch = bleOut, payload = new Uint8Array(bytes);
    outBusy = outBusy.then(() => (ch.writeValueWithoutResponse ? ch.writeValueWithoutResponse(payload) : ch.writeValue(payload))).catch(() => { /* link gone */ });
  }
}
/** Send one MIDI message. `atPerf` is a performance.now() time (ms); the message goes out now and carries that timestamp. */
function midiSendAt(data: number[], atPerf: number): boolean {
  if (bleOut) {
    outQueue.push({ ts: atPerf, data });
    if (outQueue.length === 1) queueMicrotask(bleFlush);
    return true;
  }
  let sent = false;
  midi?.outputs.forEach((o) => { try { o.send(data, atPerf); sent = true; } catch { /* port gone */ } });
  return sent;
}
function midiTarget(): string {
  if (bleOut) return bleOutName;
  const names: string[] = [];
  midi?.outputs.forEach((o) => names.push(o.name || 'MIDI'));
  return names.join(', ');
}
/** Bluetooth MIDI straight from the page (Web Bluetooth): Android Chrome does not list a Bluetooth-paired MIDI device otherwise. Needs a button press. */
async function connectBluetooth(): Promise<string> {
  const bt = (navigator as any).bluetooth;
  if (!bt) { bleError = 'This browser has no Web Bluetooth. Use Chrome or Edge (not Safari or Firefox).'; return bleError; }
  try {
    bleError = '';
    const dev = await bt.requestDevice({ filters: [{ services: [BLE_MIDI_SERVICE] }], optionalServices: [BLE_MIDI_SERVICE] });
    const server = await dev.gatt.connect();
    const svc = await server.getPrimaryService(BLE_MIDI_SERVICE);
    const ch = await svc.getCharacteristic(BLE_MIDI_CHAR);
    const clock = new BleClock();
    const name = dev.name || 'Bluetooth MIDI';
    bleOut = ch; bleOutName = name;
    ch.addEventListener('characteristicvaluechanged', (e: any) => {
      const arrival = performance.now();
      const v: DataView = e.target.value;
      const bytes: number[] = [];
      for (let i = 0; i < v.byteLength; i++) bytes.push(v.getUint8(i));
      for (const m of parseBleMidi(bytes)) handleMidi(m.data, clock.map(m.ts, arrival), name);
    });
    dev.addEventListener('gattserverdisconnected', () => { if (bleOut === ch) { bleOut = null; bleOutName = ''; } bleNames.delete(name); refreshSources(); emit('onMidiSources', { sources }); });
    await ch.startNotifications();
    bleNames.add(name);
    refreshSources();
    emit('onMidiSources', { sources });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    bleError = /cancel|chosen/i.test(msg) ? '' : `Bluetooth: ${msg}. If the TD-27 is already connected in the phone's Bluetooth settings, disconnect it there first.`;
    emit('onMidiSources', { sources: sources.slice() });
  }
  return bleError;
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
  start: async (_keepBt: boolean, wantMic: boolean) => {
    const c = context();
    // MIDI first: the audio context may stay suspended until the first tap, and that must not hold MIDI back
    c.resume().catch(() => {});
    await setupMidi();
    await micOnOff(!!wantMic);
    return info();
  },
  stop: async () => { /* the page owns the audio context; nothing to release */ },
  info,
  requestMicPermission: async () => {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); return true; }
    catch (e) { micError = (e as Error).message || 'Microphone access was refused.'; return false; }
  },
  micError: () => micError,
  startRecording: () => { if (!micStream || !micNode) return false; recChunks = []; recFrames = 0; recStart = 0; recording = true; micNode.port.postMessage(true); return true; },
  stopRecording: () => {
    recording = false; micNode?.port.postMessage(false);
    return { path: 'web:recording', sampleRate: context().sampleRate, startTime: recStart, frames: recFrames };
  },
  /** the raw samples of the last recording (web only: the native engine writes a file instead) */
  recordedProgress: () => ({ frames: recFrames, rate: context().sampleRate }),
  recordedSamples: () => { const out = new Float32Array(recFrames); let o = 0; for (const ch of recChunks) { out.set(ch, o); o += ch.length; } return out; },
  midiSources: () => sources,
  midiError: () => midiError,
  bleError: () => bleError,
  connectBluetooth,
  midiSendAt,
  midiTarget,
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
  /** an inaudible tone so the output stream stays busy (the clock check asks: does an idle stream run slow?) */
  keepAlive: (on: boolean) => {
    try { keepNode?.stop(); keepNode?.disconnect(); } catch { /* gone */ }
    keepNode = null;
    if (!on) return;
    const c = context();
    const o = c.createOscillator(); o.frequency.value = 110;
    const g = c.createGain(); g.gain.value = 0.0004; // about -68 dB
    o.connect(g); g.connect(c.destination); o.start();
    keepNode = o;
  },
  setClickSound: (name: ClickName) => { clickSound = name; if (ctx) buildBuffers(); },
  addListener: (name: string, f: Listener) => {
    (listeners[name] ||= []).push(f);
    return { remove() { listeners[name] = (listeners[name] ?? []).filter((g) => g !== f); } };
  },
};
