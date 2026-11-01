/**
 * Songs for play-along practice: the original file plus its separated stems, all in the app's documents folder.
 * Stems never leave the phone (no export): they are for practising with music you have.
 */
import { Directory, File, Paths } from 'expo-file-system';

export const MODEL_NAME = 'htdemucs_ft_drums.onnx';
export const MODEL_URL = 'https://huggingface.co/StemSplitio/htdemucs-ft-drums-onnx/resolve/main/htdemucs_ft_drums.onnx';
export const MODEL_MB = 316;

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
}
export type Mix = 'full' | 'nodrums' | 'drums';

const indexFile = () => new File(Paths.document, 'songs.json');
export const songDir = (id: string) => new Directory(Paths.document, 'songs', id);
/** Native code wants plain file paths, not file:// URLs. */
export const toPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));
export const originalPath = (s: Song) => toPath(new File(songDir(s.id), s.original).uri);
export const stemPath = (s: Song, which: 'drums' | 'nodrums') => toPath(new File(songDir(s.id), `${which}.caf`).uri);

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
