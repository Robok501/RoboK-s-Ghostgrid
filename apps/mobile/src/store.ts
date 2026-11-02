/** Settings kept on the device (JSON file in the app's documents folder). Nothing leaves the phone. */
import { File, Paths } from 'expo-file-system';
import type { LangSetting } from './i18n';
import { DEFAULT_CONFIG, DEFAULT_PAD_SETTINGS, type CountStyle, type CustomStyle, type Level, type PadSettings, type Samples, type Section } from '@ghostgrid/core';

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

/** Tempo trainer progress: highest unlocked rung, best score per rung (out of ROUND). */
export interface EarSettings { unlocked: number; best: Record<string, number>; openAll: boolean; rung: number }

/** Score look: notation style preset (or 'custom') and sketch preferences. */
export interface SketchSettings {
  style: string; custom: CustomStyle; count: boolean; click: boolean; recMode: 'replace' | 'layer';
  /** how the count reads under the score and above the grid; unset = from the app language */
  countStyle?: CountStyle;
  /** taught beatbox sounds (feature vectors) and the ghost-note loudness threshold */
  voice: Samples; ghostPct: number;
}

export interface AppSettings {
  click: ClickSettings;
  sketch: SketchSettings;
  ear: EarSettings;
  keepBt: boolean;
  pads: PadSettings;
  /** microphone sensitivity 1–10: live hits (Coach, teaching) and voice recognition */
  micSens: number;
  /** settings version, for one-time changes when defaults move */
  v?: number;
  /** app language; 'auto' follows the iPhone */
  lang: LangSetting;
}

export const DEFAULT_SETTINGS: AppSettings = {
  v: 3,
  click: {
    level: 4, mode: 'basic', bpm: 100, beats: 4, unit: 4, sub: 1, sound: 'click', levels: [3, 2, 2, 2], groups: null,
    gapOn: DEFAULT_CONFIG.gapOn, gapOff: DEFAULT_CONFIG.gapOff,
    dropUnit: 'beats', dropChance: DEFAULT_CONFIG.dropChance, dropLen: DEFAULT_CONFIG.dropLen, dropWarm: DEFAULT_CONFIG.dropWarm,
    rampStep: DEFAULT_CONFIG.rampStep, rampEvery: DEFAULT_CONFIG.rampEvery, rampTarget: DEFAULT_CONFIG.rampTarget,
    program: DEFAULT_CONFIG.program, loop: true,
    tol: 25, grade: 'beat', input: 'tap', calib: { tap: 0, mic: 0, pads: 0 }, presets: [],
  },
  ear: { unlocked: 0, best: {}, openAll: false, rung: 0 },
  sketch: { style: 'weinberg', custom: { voices: 2, map: {} }, count: true, click: false, recMode: 'replace', voice: {}, ghostPct: 45 },
  keepBt: true,
  micSens: 5,
  lang: 'auto',
  pads: { ...DEFAULT_PAD_SETTINGS, preset: 'roland' },
};

const file = () => new File(Paths.document, 'ghostgrid-settings.json');

export function loadSettings(): AppSettings {
  try {
    const f = file();
    if (!f.exists) return DEFAULT_SETTINGS;
    const saved = JSON.parse(f.textSync()) as Partial<AppSettings> & { v?: number };
    // version 2: the timing window's default went from ±15 to ±25 ms; move the old default along once
    if ((saved.v ?? 1) < 2 && saved.click && (saved.click.tol === 15 || saved.click.tol === 10)) saved.click.tol = saved.click.tol === 15 ? 25 : 15;
    // version 3: calibration is measured differently (it used to come out wrong with Bluetooth): start over once
    if ((saved.v ?? 1) < 3 && saved.click) saved.click.calib = { tap: 0, mic: 0, pads: 0 };
    return {
      v: 3,
      click: { ...DEFAULT_SETTINGS.click, ...(saved.click || {}), calib: { ...DEFAULT_SETTINGS.click.calib, ...(saved.click?.calib || {}) } },
      ear: { ...DEFAULT_SETTINGS.ear, ...(saved.ear || {}) },
      sketch: { ...DEFAULT_SETTINGS.sketch, ...(saved.sketch || {}) },
      keepBt: saved.keepBt ?? DEFAULT_SETTINGS.keepBt,
      micSens: saved.micSens ?? DEFAULT_SETTINGS.micSens,
      lang: saved.lang ?? DEFAULT_SETTINGS.lang,
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
