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
};

declare class GhostgridEngineModule extends NativeModule<Events> {
  start(keepBluetoothOutput: boolean, mic: boolean, sensitivity: number): Promise<EngineInfo>;
  stop(): Promise<void>;
  requestMicPermission(): Promise<boolean>;
  now(): number;
  scheduleClick(time: number, level: number): void;
  cancelAfter(time: number): void;
  info(): EngineInfo;
  midiSources(): string[];
  showBluetoothMidi(): Promise<void>;
}

export default requireNativeModule<GhostgridEngineModule>('GhostgridEngine');
