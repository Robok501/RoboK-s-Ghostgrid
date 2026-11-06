/**
 * Play-along recorder (data collection): while a song plays, the raw microphone signal and every pad hit are kept,
 * then packed into one zip: audio.wav (what the mic heard), hits.mid, labels.txt (Audacity) and take.json.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { audacityLabels, drumHits, hitsToMidi, alignedMatch, wavBytes, zip, type AlignedMatch, type TakeHit } from '@ghostgrid/core';
import Engine from '../../modules/ghostgrid-engine';
import { useApp } from '../AppContext';
import { readVoiceFile } from '../sketch/usePlayer';
import { t } from '../i18n';

export interface TakeMeta { songId: string; songName: string; rate: number; startSong: number; countIn: number; /** the separated drum track, when there is one: the take is compared with it */ drumsPath: string | null }
export interface TakeResult { uri: string; name: string; seconds: number; hits: number; mb: number; match: AlignedMatch | null }

export function useTake() {
  const { on, mic, setMic, info, settings } = useApp();
  const [active, setActive] = useState(false);
  const [count, setCount] = useState(0);
  const [result, setResult] = useState<TakeResult | null>(null);
  const [error, setError] = useState('');
  const R = useRef({ hits: [] as { time: number; note: number; vel: number; key: string; name: string; mapped: boolean; song: number | null }[], active: false, meta: null as TakeMeta | null, started: 0, outLat: 0, micWasOff: false, ioBuffer: 0, start: null as ReturnType<typeof Engine.info> | null });
  R.current.outLat = info?.outputLatency ?? 0;

  useEffect(() => on('pad', (e) => {
    const r = R.current;
    if (!r.active) return;
    const song = Engine.stemsSongTimeAt(e.time - r.outLat);
    r.hits.push({ time: e.time, note: e.note, vel: e.vel, key: e.key, name: e.name, mapped: e.mapped, song: song >= 0 ? song : null });
    setCount(r.hits.length);
  }), [on]);

  /** Start recording; call right before the song starts. Needs the microphone: turning it on restarts the audio, so do this first. */
  const begin = useCallback(async (meta: TakeMeta): Promise<boolean> => {
    setError(''); setResult(null);
    if (!mic) {
      R.current.micWasOff = true;
      if (!(await setMic(true))) { R.current.micWasOff = false; setError(t('The microphone is off. Allow it in Settings → Ghostgrid.')); return false; }
    }
    if (!Engine.startRecording()) { setError(t('The microphone is off.')); return false; }
    // a recording does not need the 5 ms buffer the coach wants; a bigger one is easier on Bluetooth and the mic at the same time
    R.current.ioBuffer = Engine.setIOBuffer(0.02);
    R.current.start = Engine.info();
    R.current = { ...R.current, hits: [], active: true, meta, started: Date.now() };
    setCount(0); setActive(true);
    return true;
  }, [mic, setMic]);

  /** Stop and pack the take. */
  const finish = useCallback(async (): Promise<TakeResult | null> => {
    const r = R.current;
    if (!r.active || !r.meta) return null;
    r.active = false; setActive(false);
    try {
      const f = Engine.stopRecording();
      const endInfo = Engine.info();
      try { Engine.setIOBuffer(0.005); } catch { /* keep the bigger buffer */ }
      const samples = readVoiceFile(f.path);
      const hits: TakeHit[] = r.hits
        .map((h) => ({ t: h.time - f.startTime, note: h.note, vel: h.vel, key: h.key, name: h.name, mapped: h.mapped, song: h.song }))
        .filter((h) => h.t >= 0 && h.t <= samples.length / f.sampleRate + 1);
      // against the real drummer: timing of your hits vs the hits found in the song's drum track
      let match: AlignedMatch | null = null;
      const inSong = hits.filter((h) => h.song !== null && h.song >= 0);
      if (r.meta.drumsPath && inSong.length > 4) {
        try {
          const ref = drumHits(await Engine.stemsEnvelope(r.meta.drumsPath)).map((h) => ({ t: h.t, id: h.id }));
          const times = inSong.map((h) => h.song as number);
          const window: [number, number] = [Math.min(r.meta.startSong, ...times) - 0.2, Math.max(Engine.stemsPosition(), ...times) + 0.2];
          match = alignedMatch(ref, inSong.map((h) => ({ t: h.song as number, key: h.key })), window);
        } catch { match = null; }
      }
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const slug = r.meta.songName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'take';
      const base = `${slug}-${stamp}`;
      const seconds = samples.length / f.sampleRate;
      const json = {
        app: 'Ghostgrid play-along', version: 1, created: new Date().toISOString(),
        song: { id: r.meta.songId, name: r.meta.songName, playbackRate: r.meta.rate, startSeconds: r.meta.startSong, countInBeats: r.meta.countIn },
        audio: { file: 'audio.wav', sampleRate: f.sampleRate, seconds, note: 'what the iPhone microphone heard: the room, your kit and the song if it came through a speaker' },
        timing: { note: 'hit.t is seconds after the first sample of audio.wav; hit.song is the position in the song (seconds) of the backing at that moment, null when it was not playing', outputLatencySeconds: r.outLat, padCalibrationMs: settings.click.calib.pads },
        audioSession: { route: r.start?.route, routeName: r.start?.routeName, requestedIoBufferSeconds: 0.02, ioBufferSeconds: r.ioBuffer, outputLatencySeconds: r.start?.outputLatency, inputLatencySeconds: r.start?.inputLatency, sampleRate: r.start?.sampleRate, endRoute: endInfo?.routeName, midiSources: Engine.midiSources() },
        referenceMatch: match && { note: 'your hits vs the hits found in the separated drum track, after removing a timing offset per 20 s block (blocks[].shift in ms, positive = you behind the original). meanMs/sdMs = what is left after that.', ...match, hitRate: +match.hitRate.toFixed(3), precision: +match.precision.toFixed(3), meanMs: +match.meanMs.toFixed(1), sdMs: +match.sdMs.toFixed(1), voiceAgree: +match.voiceAgree.toFixed(3) },
        pads: settings.pads.preset,
        hits: hits.map((h) => ({ t: +h.t.toFixed(4), note: h.note, vel: h.vel, pad: h.mapped ? h.key : null, song: h.song === null ? null : +h.song.toFixed(4) })),
      };
      const enc = new TextEncoder();
      const bundle = zip([
        { name: 'audio.wav', data: wavBytes(samples, f.sampleRate) },
        { name: 'hits.mid', data: hitsToMidi(hits) },
        { name: 'labels.txt', data: enc.encode(audacityLabels(hits)) },
        { name: 'take.json', data: enc.encode(JSON.stringify(json, null, 1)) },
      ]);
      const file = new File(Paths.cache, `${base}.zip`);
      try { if (file.exists) file.delete(); } catch { /* overwrite */ }
      file.writeSync(bundle);
      try { new File(f.path).delete(); } catch { /* temp */ }
      const res = { uri: file.uri, name: `${base}.zip`, seconds, hits: hits.length, mb: bundle.length / 1e6, match };
      setResult(res);
      return res;
    } catch (e) {
      setError(t('Recording failed: {{msg}}', { msg: (e as Error).message }));
      return null;
    } finally {
      if (r.micWasOff) { r.micWasOff = false; setMic(false); }
    }
  }, [setMic, settings]);

  const share = useCallback(async () => {
    if (!result) return;
    try { await Sharing.shareAsync(result.uri, { mimeType: 'application/zip', UTI: 'public.zip-archive', dialogTitle: result.name }); }
    catch (e) { setError((e as Error).message); }
  }, [result]);

  const discard = useCallback(() => {
    if (result) { try { new File(result.uri).delete(); } catch { /* gone */ } }
    setResult(null);
  }, [result]);

  return { active, count, result, error, begin, finish, share, discard };
}
