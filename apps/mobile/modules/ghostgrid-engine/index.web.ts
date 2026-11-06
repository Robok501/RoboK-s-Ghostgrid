/**
 * Web stand-in for the native engine, used only to render the screens in a browser (layout reviews, screenshots).
 * No audio: every call returns a plausible value.
 */
import { webEngine } from '../../src/web/webEngine';
const t0 = Date.now();
// listeners, so a screenshot script can play pad hits: window.__GG_emit('onPadHit', { time, note, velocity })
const listeners: Record<string, ((e: any) => void)[]> = {};
if (typeof window !== 'undefined') (window as any).__GG_now = () => (Date.now() - t0) / 1000;
if (typeof window !== 'undefined') (window as any).__GG_emit = (name: string, e: unknown) => (listeners[name] ?? []).forEach((f) => f(e));
const info = { running: true, sampleRate: 48000, outputLatency: 0.012, inputLatency: 0.01, ioBuffer: 0.005, route: 'bluetooth', routeName: 'TD-27', mic: false };
const fixed: Record<string, unknown> = {
  now: () => (Date.now() - t0) / 1000,
  ensureRunning: () => false,
  setIOBuffer: () => 0.005,
  start: async () => info,
  info: () => info,
  requestMicPermission: async () => true,
  midiSources: () => ['TD-27'],
  uptimeToEngine: (u: number) => u,
  startRecording: () => true,
  stopRecording: () => ({ path: '', sampleRate: 48000, startTime: 0, frames: 0 }),
  addListener: (name: string, f: (e: any) => void) => {
    (listeners[name] ||= []).push(f);
    return { remove() { listeners[name] = (listeners[name] ?? []).filter((g) => g !== f); } };
  },
  stemsModelStatus: () => ({ present: true, bytes: 316_000_000, path: '' }),
  stemsLoad: async () => 213,
  stemsPosition: () => 64.2,
  stemsIsPlaying: () => false,
  stemsLastRun: () => ({ phase: 'done' }),
  stemsFreeMemoryMB: () => 4058,
  stemsSongTimeAt: () => -1,
  stemsRate: () => 1,
  stemsEnvelope: async () => ({ rate: 100, full: [], low: [] }),
  stemsTranscribe: async () => ({ rate: 100, t: [], c: [], p: [], v: [], duration: 0 }),
  stemsBeatLogits: async () => ({ rate: 50, beat: [], down: [], duration: 0 }),
  stemsMusicFeatures: async () => ({ rate: 10, chroma: [], bass: [] }),
  stemsLevels: async () => ({ db: -16, peak: 0.9, invalid: 0 }),
  stemsWriteClick: async () => {},
  stemsSeparate: async () => ({ duration: 213, mixDb: -14, drumsDb: -20, restDb: -15, drumsShare: 0.27, drumsPeak: 0.8, invalid: 0 }),
  stemsDownloadModel: async () => ({ present: true, bytes: 316e6, path: '' }),
};
// Normal web use: real click/drums and MIDI from the browser; songs/stems stay stubs for now.
// Screenshot mode (a seeded page, window.__GG_SEED) keeps the silent stand-in so layouts stay reproducible.
const base = (globalThis as any).__GG_SEED ? fixed : { ...fixed, ...webEngine, stemsModelStatus: () => ({ present: false, bytes: 0, path: '' }), startRecording: () => false };
const Engine = new Proxy(base, { get: (o, k: string) => (k in o ? o[k] : () => undefined) });
export default Engine as any;
