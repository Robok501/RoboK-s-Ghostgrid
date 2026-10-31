/**
 * Audio engine interface (architecture memo §5). The app only talks to audio and devices through this.
 * Implementations: Web Audio (prototypes), native iOS (Core Audio / AVAudioEngine), native Android (Oboe).
 * Times are in seconds on the engine's own clock (`now()`); events are scheduled ahead, sample-accurate.
 */
import type { InstrumentId, NoteState } from './groove';
import type { Level } from './meter';

export type ClickSound = 'click' | 'wood' | 'cowbell' | 'hat';
export type OutputRoute = 'speaker' | 'wired' | 'bluetooth' | 'usb' | 'other';

export interface PadEvent {
  /** engine-clock time of the hit, already corrected for input latency where known */
  time: number;
  note: number;
  velocity: number;
  channel: number;
  /** name of the MIDI source, e.g. "TD-27" */
  source: string;
}

export interface CaptureHit {
  time: number;
  peak: number;
  /** mono samples from the onset, up to 300 ms, for recognition */
  samples: Float32Array;
  sampleRate: number;
}

export interface EngineInfo {
  sampleRate: number;
  /** measured or reported output latency in seconds */
  outputLatency: number;
  route: OutputRoute;
}

export interface AudioEngine {
  /** start the audio session (call from a user gesture on web) */
  start(options?: { keepBluetoothOutput?: boolean }): Promise<EngineInfo>;
  stop(): Promise<void>;
  /** current time on the engine clock */
  now(): number;
  /** time currently heard at the output (now minus output latency) */
  heardTime(): number;

  scheduleClick(time: number, level: Level, sound: ClickSound): void;
  scheduleHit(time: number, instrument: InstrumentId, state: NoteState): void;
  /** stop everything scheduled after `time` (for stop or tempo changes) */
  cancelAfter(time: number): void;
  loadKit(kitId: string): Promise<void>;

  /** MIDI input from e-drums (USB or Bluetooth); returns an unsubscribe function */
  onPadHit(cb: (e: PadEvent) => void): () => void;
  midiSources(): Promise<string[]>;

  startCapture(onHit: (h: CaptureHit) => void, options?: { sensitivity?: number }): Promise<void>;
  stopCapture(): Promise<void>;

  /** round-trip latency measurement for the current route, in seconds */
  measureLatency(): Promise<number>;
  info(): EngineInfo;
}

/**
 * Drives an AudioEngine from a step source (e.g. ClickPlan): keeps `lookahead` seconds scheduled.
 * Call `pump()` from a timer every ~25 ms; it is cheap and idempotent.
 */
export class Scheduler<S extends { duration: number }> {
  private nextTime = 0;
  private running = false;
  constructor(
    private engine: Pick<AudioEngine, 'now'>,
    private source: { next(): S | null },
    private play: (step: S, time: number) => void,
    private lookahead = 0.12,
  ) {}
  start(at = this.engine.now() + 0.08) { this.nextTime = at; this.running = true; this.pump(); }
  stop() { this.running = false; }
  get isRunning() { return this.running; }
  pump() {
    while (this.running && this.nextTime < this.engine.now() + this.lookahead) {
      const s = this.source.next();
      if (!s) { this.running = false; break; }
      this.play(s, this.nextTime);
      this.nextTime += s.duration;
    }
  }
}
