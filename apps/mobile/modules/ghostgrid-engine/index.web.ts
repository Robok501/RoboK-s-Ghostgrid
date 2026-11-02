/**
 * Web stand-in for the native engine, used only to render the screens in a browser (layout reviews, screenshots).
 * No audio: every call returns a plausible value.
 */
const t0 = Date.now();
const info = { running: true, sampleRate: 48000, outputLatency: 0.012, inputLatency: 0.01, ioBuffer: 0.005, route: 'bluetooth', routeName: 'TD-27', mic: false };
const fixed: Record<string, unknown> = {
  now: () => (Date.now() - t0) / 1000,
  start: async () => info,
  info: () => info,
  requestMicPermission: async () => true,
  midiSources: () => ['TD-27'],
  uptimeToEngine: (u: number) => u,
  startRecording: () => true,
  stopRecording: () => ({ path: '', sampleRate: 48000, startTime: 0, frames: 0 }),
  addListener: () => ({ remove() {} }),
  stemsModelStatus: () => ({ present: true, bytes: 316_000_000, path: '' }),
  stemsLoad: async () => 213,
  stemsPosition: () => 64.2,
  stemsIsPlaying: () => false,
  stemsLastRun: () => ({ phase: 'done' }),
  stemsFreeMemoryMB: () => 4058,
  stemsSongTimeAt: () => -1,
  stemsRate: () => 1,
  stemsEnvelope: async () => ({ rate: 100, full: [], low: [] }),
  stemsMusicFeatures: async () => ({ rate: 10, chroma: [], bass: [] }),
  stemsLevels: async () => ({ db: -16, peak: 0.9, invalid: 0 }),
  stemsWriteClick: async () => {},
  stemsSeparate: async () => ({ duration: 213, mixDb: -14, drumsDb: -20, restDb: -15, drumsShare: 0.27, drumsPeak: 0.8, invalid: 0 }),
  stemsDownloadModel: async () => ({ present: true, bytes: 316e6, path: '' }),
};
const Engine = new Proxy(fixed, { get: (o, k: string) => (k in o ? o[k] : () => undefined) });
export default Engine as any;
