/** Settings kept on the device (JSON file in the app's documents folder). Nothing leaves the phone. */
import { File, Paths } from 'expo-file-system';
import { DEFAULT_CONFIG, DEFAULT_PAD_SETTINGS, type Level, type PadSettings, type Section } from '@ghostgrid/core';

export type ClickSound = 'click' | 'wood' | 'cowbell' | 'hat';
export type CoachInput = 'tap' | 'mic' | 'pads';

export interface Preset { name: string; bpm: number; beats: number; unit: 4 | 8; sub: number; levels: Level[]; groups?: number[] | null }

export interface ClickSettings {
  level: number;
  mode: 'basic' | 'gap' | 'drop' | 'ramp' | 'coach' | 'program';
  bpm: number; beats: number; unit: 4 | 8; sub: number; sound: ClickSound;
  levels: Level[]; groups: number[] | null;
  gapOn: number; gapOff: number;
  dropUnit: 'beats' | 'bars'; dropChance: number; dropLen: number; dropWarm: number;
  rampStep: number; rampEvery: number; rampTarget: number;
  program: Section[]; loop: boolean;
  tol: number; grade: 'beat' | 'sub'; input: CoachInput;
  calib: Record<CoachInput, number>;
  presets: Preset[];
}

export interface AppSettings {
  click: ClickSettings;
  keepBt: boolean;
  pads: PadSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  click: {
    level: 4, mode: 'basic', bpm: 100, beats: 4, unit: 4, sub: 1, sound: 'click', levels: [3, 2, 2, 2], groups: null,
    gapOn: DEFAULT_CONFIG.gapOn, gapOff: DEFAULT_CONFIG.gapOff,
    dropUnit: 'beats', dropChance: DEFAULT_CONFIG.dropChance, dropLen: DEFAULT_CONFIG.dropLen, dropWarm: DEFAULT_CONFIG.dropWarm,
    rampStep: DEFAULT_CONFIG.rampStep, rampEvery: DEFAULT_CONFIG.rampEvery, rampTarget: DEFAULT_CONFIG.rampTarget,
    program: DEFAULT_CONFIG.program, loop: true,
    tol: 15, grade: 'beat', input: 'tap', calib: { tap: 0, mic: 0, pads: 0 }, presets: [],
  },
  keepBt: true,
  pads: { ...DEFAULT_PAD_SETTINGS, preset: 'roland' },
};

const file = () => new File(Paths.document, 'ghostgrid-settings.json');

export function loadSettings(): AppSettings {
  try {
    const f = file();
    if (!f.exists) return DEFAULT_SETTINGS;
    const saved = JSON.parse(f.textSync()) as Partial<AppSettings>;
    return {
      click: { ...DEFAULT_SETTINGS.click, ...(saved.click || {}), calib: { ...DEFAULT_SETTINGS.click.calib, ...(saved.click?.calib || {}) } },
      keepBt: saved.keepBt ?? DEFAULT_SETTINGS.keepBt,
      pads: { ...DEFAULT_SETTINGS.pads, ...(saved.pads || {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function saveSettings(s: AppSettings) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    try { file().writeSync(JSON.stringify(s)); } catch { /* best effort */ }
  }, 300);
}
