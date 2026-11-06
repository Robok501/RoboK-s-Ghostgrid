import { NativeModule, requireNativeModule } from 'expo';

export type RouteKind = 'speaker' | 'wired' | 'bluetooth' | 'usb' | 'other';

export interface EngineInfo {
  running: boolean;
  sampleRate: number;
  /** seconds, including the IO buffer; Bluetooth adds most of it */
  outputLatency: number;
  inputLatency: number;
  ioBuffer: number;
  route: RouteKind;
  routeName: string;
  mic: boolean;
}

/** Levels after separation (dB full scale) and how much of the song's energy went to the drums (0–1). */
export interface SeparationReport { duration: number; mixDb: number; drumsDb: number; restDb: number; drumsShare: number; drumsPeak: number; invalid: number }

export interface PadHitEvent { time: number; note: number; velocity: number; channel: number; source: string }
export interface CaptureHitEvent { time: number; peak: number }
export interface ControlEvent { time: number; cc: number; value: number; channel: number; source: string }

type Events = {
  onPadHit: (e: PadHitEvent) => void;
  onControl: (e: ControlEvent) => void;
  onMidiSources: (e: { sources: string[] }) => void;
  onCaptureHit: (e: CaptureHitEvent) => void;
  onMicLevel: (e: { level: number }) => void;
  onRouteChange: (e: EngineInfo) => void;
  onStemsProgress: (e: { phase: 'download' | 'decode' | 'load' | 'separate' | 'write'; progress: number; bytes?: number }) => void;
};

declare class GhostgridEngineModule extends NativeModule<Events> {
  start(keepBluetoothOutput: boolean, mic: boolean, sensitivity: number): Promise<EngineInfo>;
  stop(): Promise<void>;
  requestMicPermission(): Promise<boolean>;
  now(): number;
  /** restart the click/drum engine if the system stopped it (or always with force); true when it was restarted */
  ensureRunning(force: boolean): boolean;
  /** ask iOS for a larger/smaller audio buffer (seconds) without restarting; returns the size now in effect */
  setIOBuffer(seconds: number): number;
  scheduleClick(time: number, level: number): void;
  /** Drum voice, index into DRUM_SOUNDS from @ghostgrid/core; gain 1 = normal. */
  scheduleDrum(time: number, sound: number, gain: number): void;
  cancelAfter(time: number): void;
  setClickSound(name: 'click' | 'wood' | 'cowbell' | 'hat'): void;
  uptimeToEngine(uptime: number): number;
  info(): EngineInfo;
  // stems: separation and practice player
  stemsModelStatus(name: string): { present: boolean; bytes: number; path: string };
  stemsDownloadModel(url: string, name: string): Promise<{ present: boolean; bytes: number; path: string }>;
  stemsCancelDownload(): void;
  stemsDeleteModel(name: string): void;
  /** file paths (not file:// URLs); resolves with the duration in seconds */
  stemsSeparate(input: string, outDir: string, model: string): Promise<SeparationReport>;
  stemsLevels(path: string): Promise<{ db: number; peak: number; invalid: number }>;
  stemsCancel(): void;
  /** last separation: phase reached (decode/load/separate/write/done/error), free memory then */
  stemsLastRun(): { phase?: string; freeMB?: number; freeAfterLoadMB?: number; message?: string; seconds?: number };
  stemsFreeMemoryMB(): number;
  stemsLoad(drums: string | null, rest: string): Promise<number>;
  stemsUnload(): void;
  stemsPlay(): void;
  stemsPause(): void;
  stemsSeek(t: number): void;
  stemsPosition(): number;
  stemsIsPlaying(): boolean;
  stemsSetVolumes(drums: number, rest: number, click: number): void;
  stemsEnvelope(path: string): Promise<{ rate: number; full: number[]; low: number[]; mid?: number[]; high?: number[] }>;
  /** drum transcription model peaks (100 per second; columns: kick, snare, tom, hi-hat, ride, bell, crash, clave) */
  stemsTranscribe(path: string, model: string): Promise<{ rate: number; t: number[]; c: number[]; p: number[]; v: number[]; duration: number }>;
  /** Beat This! logits for the beat and the downbeat of a whole song (50 per second) */
  stemsBeatLogits(path: string, model: string): Promise<{ rate: number; beat: number[]; down: number[]; duration: number }>;
  stemsMusicFeatures(path: string): Promise<{ rate: number; chroma: number[]; bass: number[]; mel?: number[]; bands?: number }>;
  stemsWriteClick(path: string, seconds: number, times: number[], accents: boolean[]): Promise<void>;
  stemsSetClick(path: string | null): void;
  stemsPlayCountIn(beats: number, beatSeconds: number): void;
  /** song time heard at engine time t (seconds), or -1 when not playing */
  stemsSongTimeAt(t: number): number;
  stemsRate(): number;
  stemsSetRate(rate: number): void;
  stemsSetLoop(a: number, b: number, on: boolean): void;
  /** Keep the raw mic signal (voice to notes). Returns false when the mic is off. */
  startRecording(): boolean;
  /** Stop; the samples are in a file of 32-bit floats (little-endian, mono). */
  stopRecording(): { path: string; sampleRate: number; startTime: number; frames: number };
  midiSources(): string[];
  showBluetoothMidi(): Promise<void>;
}

export default requireNativeModule<GhostgridEngineModule>('GhostgridEngine');
