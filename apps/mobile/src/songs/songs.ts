/**
 * Songs for play-along practice: the original file plus its separated stems, all in the app's documents folder.
 * Stems never leave the phone (no export): they are for practising with music you have.
 */
import { Directory, File, Paths } from 'expo-file-system';
import type { BeatMap } from '@ghostgrid/core';
import type { CoachInput } from '../store';

export const MODEL_NAME = 'htdemucs_ft_drums.onnx';
export const MODEL_URL = 'https://huggingface.co/StemSplitio/htdemucs-ft-drums-onnx/resolve/main/htdemucs_ft_drums.onnx';
export const MODEL_MB = 316;
/** Drum transcription for "to score": Onsets and Frames Drums (Magenta, E-GMD), Apache-2.0, about 6 MB. */
export const DRUM_MODEL_NAME = 'oaf_drums.onnx';
export const DRUM_MODEL_URL = 'https://huggingface.co/thebluescreen/oaf-drums-onnx/resolve/main/oaf_drums.onnx';

/** Beat and downbeat finding: Beat This! (Foscarin, Schlüter, Widmer, ISMIR 2024), MIT, ONNX build, about 82 MB. */
export const BEAT_MODEL_NAME = 'beat_this.onnx';
export const BEAT_MODEL_URL = 'https://huggingface.co/thebluescreen/beat-this-onnx/resolve/main/beat_this.onnx';
export const BEAT_MODEL_MB = 82;

export interface Song {
  id: string;
  name: string;
  created: number;
  source: 'file' | 'mic';
  /** original file name inside the song folder */
  original: string;
  duration?: number;
  separated?: boolean;
  error?: string;
  // practice state, remembered per song
  rate?: number;
  loopA?: number;
  loopB?: number;
  loop?: boolean;
  mix?: Mix;
  drumVol?: number;
  /** beats and bars, found in the drum track (or the whole song before separation) */
  beatMap?: BeatMap;
  click?: boolean;
  clickVol?: number;
  /** bars of count-in before playing (0 = none) */
  countIn?: number;
  /** score my timing against the song's beat */
  coach?: boolean;
  coachInput?: CoachInput;
  /** 1 = beats, 2 = 8ths, 4 = 16ths */
  grade?: 1 | 2 | 4;
  /** levels after separation, to spot a separation that went wrong */
  check?: { mixDb: number; drumsDb: number; restDb: number; drumsShare: number; invalid: number };
}
export type Mix = 'full' | 'nodrums' | 'drums' | 'silent';

const indexFile = () => new File(Paths.document, 'songs.json');
export const songDir = (id: string) => new Directory(Paths.document, 'songs', id);
/** Native code wants plain file paths, not file:// URLs. */
export const toPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));
export const originalPath = (s: Song) => toPath(new File(songDir(s.id), s.original).uri);
export const stemPath = (s: Song, which: 'drums' | 'nodrums' | 'click') => toPath(new File(songDir(s.id), `${which}.caf`).uri);

export function loadSongs(): Song[] {
  try {
    const f = indexFile();
    if (f.exists) return JSON.parse(f.textSync()) as Song[];
  } catch { /* fresh start */ }
  return [];
}

export function saveSongs(songs: Song[]) {
  try { indexFile().writeSync(JSON.stringify(songs)); } catch { /* best effort */ }
}

export function ensureDir(id: string): Directory {
  const d = songDir(id);
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

export function deleteSongFiles(id: string) {
  try { const d = songDir(id); if (d.exists) d.delete(); } catch { /* already gone */ }
}

export const newSongId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
