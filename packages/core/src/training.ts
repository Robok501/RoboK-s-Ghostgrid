/**
 * Click plan: turns a metronome configuration into a stream of click steps.
 * It holds no clock: the audio engine asks for the next step and schedules it at `duration` after the previous one.
 * Randomness (drop mode) is injected so tests and replays are deterministic.
 */
import { defaultLevels, levelsFor, type Level } from './meter';

export type Mode = 'basic' | 'gap' | 'drop' | 'ramp' | 'coach' | 'program';
export interface Section { bars: number; bpm: number; beats: number }

export interface TrainingConfig {
  mode: Mode;
  bpm: number;
  beats: number;
  /** clicks per beat: 1 = quarters, 2 = eighths, 3 = triplets, 4 = sixteenths */
  sub: number;
  levels: Level[];
  gapOn: number; gapOff: number;
  dropUnit: 'beats' | 'bars'; dropChance: number; dropLen: number; dropWarm: number;
  rampStep: number; rampEvery: number; rampTarget: number;
  program: Section[]; loop: boolean;
}

export const DEFAULT_CONFIG: TrainingConfig = {
  mode: 'basic', bpm: 100, beats: 4, sub: 1, levels: [3, 2, 2, 2],
  gapOn: 2, gapOff: 2, dropUnit: 'beats', dropChance: 25, dropLen: 1, dropWarm: 2,
  rampStep: 4, rampEvery: 4, rampTarget: 140,
  program: [{ bars: 4, bpm: 90, beats: 4 }, { bars: 8, bpm: 120, beats: 4 }, { bars: 4, bpm: 120, beats: 7 }],
  loop: true,
};

export interface ClickStep {
  bar: number;
  beat: number;
  /** subdivision index within the beat, 0 = on the beat */
  sub: number;
  /** level to play (0 = nothing) */
  level: Level;
  /** false while the click is deliberately silent (gap, drop) */
  audible: boolean;
  bpm: number;
  beats: number;
  levels: Level[];
  section: number;
  sectionBar: number;
  /** seconds until the next step */
  duration: number;
}

export class ClickPlan {
  readonly cfg: TrainingConfig;
  private rng: () => number;
  private bar = 0; private step = 0; private sec: number; private secBar = 0;
  private bpm: number; private beats = 4; private levels: Level[] = [];
  private barSilent = false; private beatDrop = false; private dropRun = 0;
  private ended = false; private done = false;
  /** number of beats or bars dropped so far (drop mode) */
  drops = 0;

  constructor(cfg: TrainingConfig, rng: () => number = Math.random, startSection = 0) {
    this.cfg = cfg; this.rng = rng;
    this.sec = cfg.mode === 'program' ? Math.min(Math.max(0, startSection), cfg.program.length - 1) : 0;
    this.bpm = cfg.bpm;
    this.barStart(true);
  }

  private barStart(first: boolean) {
    const c = this.cfg;
    if (!first) this.bar++;
    if (c.mode === 'ramp' && !first && this.bar % c.rampEvery === 0) {
      const dir = Math.sign(c.rampTarget - this.bpm);
      if (dir > 0) this.bpm = Math.min(c.rampTarget, this.bpm + c.rampStep);
      if (dir < 0) this.bpm = Math.max(c.rampTarget, this.bpm - c.rampStep);
    }
    if (c.mode === 'program') {
      if (!first) {
        this.secBar++;
        if (this.secBar >= c.program[this.sec].bars) {
          this.secBar = 0; this.sec++;
          if (this.sec >= c.program.length) {
            if (c.loop) this.sec = 0; else { this.ended = true; this.sec = c.program.length - 1; }
          }
        }
      }
      const s = c.program[this.sec];
      this.bpm = s.bpm; this.beats = s.beats; this.levels = defaultLevels(s.beats);
    } else { this.beats = c.beats; this.levels = levelsFor(c.levels, c.beats); }
    let silent = false;
    if (c.mode === 'gap') silent = this.bar % (c.gapOn + c.gapOff) >= c.gapOn;
    if (c.mode === 'drop' && c.dropUnit === 'bars') {
      if (this.dropRun > 0) { silent = true; this.dropRun--; }
      else if (this.bar >= c.dropWarm && this.rng() * 100 < c.dropChance) { silent = true; this.dropRun = c.dropLen - 1; this.drops++; }
    }
    this.barSilent = silent;
  }

  /** Next click step, or null when a non-looping program has finished. */
  next(): ClickStep | null {
    if (this.done) return null;
    const c = this.cfg, sub = c.sub, beat = Math.floor(this.step / sub), si = this.step % sub;
    const base = this.levels[beat];
    const level = (si === 0 ? base : base === 0 ? 0 : 1) as Level;
    if (si === 0) {
      this.beatDrop = c.mode === 'drop' && c.dropUnit === 'beats' && this.bar >= c.dropWarm && this.rng() * 100 < c.dropChance;
      if (this.beatDrop) this.drops++;
    }
    const out: ClickStep = {
      bar: this.bar, beat, sub: si, level, audible: !this.barSilent && !this.beatDrop,
      bpm: this.bpm, beats: this.beats, levels: this.levels, section: this.sec, sectionBar: this.secBar,
      duration: 60 / this.bpm / sub,
    };
    this.step++;
    if (this.step >= this.beats * sub) {
      this.step = 0;
      this.barStart(false);
      if (this.ended) this.done = true;
    }
    return out;
  }
}

/** Total bars and duration of a program, for the song map. */
export function programLength(program: Section[]): { bars: number; seconds: number } {
  return {
    bars: program.reduce((a, s) => a + s.bars, 0),
    seconds: program.reduce((a, s) => a + (s.bars * s.beats * 60) / s.bpm, 0),
  };
}

/** Section letter: A, B, C … */
export const sectionLetter = (i: number) => String.fromCharCode(65 + (i % 26));

/** Player levels and what each one shows. A level includes everything below it. */
export const PLAYER_LEVELS = [
  { level: 1, name: 'First Sticks', modes: ['basic', 'coach'] as Mode[] },
  { level: 2, name: 'Groove', modes: ['gap', 'ramp', 'program'] as Mode[] },
  { level: 3, name: 'Chops', modes: ['drop'] as Mode[] },
  { level: 4, name: 'Session Pro', modes: [] as Mode[] },
];
export function modesForLevel(level: number): Mode[] {
  return PLAYER_LEVELS.filter((l) => l.level <= level).flatMap((l) => l.modes);
}
/** Reset settings a lower level hides, so nothing invisible keeps changing the click. */
export function applyLevel<T extends { sub: number; mode: Mode; unit?: number; groups?: number[] | null }>(cfg: T, level: number): T {
  const c = { ...cfg };
  if (level < 3) { c.unit = 4; c.groups = null; if (c.mode === 'drop') c.mode = 'basic'; }
  if (level < 2) { c.sub = 1; if (!['basic', 'coach'].includes(c.mode)) c.mode = 'basic'; }
  return c;
}
