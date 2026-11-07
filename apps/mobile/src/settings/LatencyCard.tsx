/**
 * Latency test: the app plays accent clicks and listens to them with the microphone, so the delay of the audio route
 * (phone speaker, Bluetooth, ...) is measured without anyone playing. Run it once over the phone speaker and once over Bluetooth.
 */
import React, { useRef, useState } from 'react';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { analyzeLoopback, loopbackSchedule, type LoopbackResult } from '@ghostgrid/core';
import Engine from '../../modules/ghostgrid-engine';
import { useApp } from '../AppContext';
import { readVoiceFile } from '../sketch/usePlayer';
import { Btn, Card, Note } from '../ui';
import { t } from '../i18n';

interface Run { at: string; route: string; routeName: string; reportedMs: number; ioBufferMs: number; result: LoopbackResult }

const COUNT = 20;

export function LatencyCard() {
  const { mic, setMic, settings } = useApp();
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true); setMsg(t('Preparing…'));
    const wasOff = !mic;
    try {
      if (wasOff && !(await setMic(true))) { setMsg(t('The microphone is off. Allow it in Settings → Ghostgrid.')); return; }
      Engine.ensureRunning(false);
      Engine.setClickSound('click');
      if (!Engine.startRecording()) { setMsg(t('The microphone could not start.')); return; }
      const info = Engine.info();
      const sched = loopbackSchedule(Engine.now(), COUNT, 1.2);
      let next = 0;
      // clicks go to the engine just before they are due, not all at once
      await new Promise<void>((resolve) => {
        timer.current = setInterval(() => {
          const now = Engine.now();
          while (next < sched.length && sched[next] < now + 0.6) { Engine.scheduleClick(sched[next], 3); next++; }
          setMsg(t('Measuring… {{n}}/{{of}}', { n: Math.min(next, COUNT), of: COUNT }));
          if (now > sched[sched.length - 1] + 1.2) { if (timer.current) clearInterval(timer.current); timer.current = null; resolve(); }
        }, 100);
      });
      const f = Engine.stopRecording();
      const samples = readVoiceFile(f.path);
      try { new File(f.path).delete(); } catch { /* temp */ }
      const result = analyzeLoopback(samples, f.sampleRate, f.startTime, sched);
      setRuns((r) => [...r, { at: new Date().toISOString(), route: info.route, routeName: info.routeName, reportedMs: Math.round((info.outputLatency + info.ioBuffer) * 1000), ioBufferMs: Math.round(info.ioBuffer * 1000), result }]);
      setMsg(result.valid < COUNT / 2 ? t('Only {{n}} of {{of}} clicks were heard. Hold the phone close to the speaker, turn the volume up and try again.', { n: result.valid, of: COUNT }) : '');
    } catch (e) {
      setMsg(t('Test failed: {{msg}}', { msg: (e as Error).message }));
    } finally {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      try { Engine.setClickSound(settings.click.sound); } catch { /* keep */ }
      if (wasOff) setMic(false);
      setBusy(false);
    }
  };

  const share = async () => {
    try {
      const file = new File(Paths.cache, 'ghostgrid-latency-test.json');
      try { if (file.exists) file.delete(); } catch { /* overwrite */ }
      file.writeSync(JSON.stringify({ app: 'Ghostgrid latency test', version: 1, runs }, null, 1));
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json' });
    } catch (e) { setMsg((e as Error).message); }
  };

  if (Platform.OS === 'web') {
    return <Card title="Latency test"><Note>{t('The latency test is in the iPhone app for now.')}</Note></Card>;
  }
  const last = runs[runs.length - 1];
  const other = last && [...runs].reverse().find((r) => r.routeName !== last.routeName);
  return (
    <Card title="Latency test">
      <Note>{t('Measures how long sound takes from the app to your ears, with nobody playing. 1) Switch the sound to the iPhone speaker (Control Center, hold the audio card, AirPlay icon) and run it. 2) Switch to your drum module over Bluetooth, hold the phone close to the module’s speaker or headphones, and run it again.')}</Note>
      <Btn label={busy ? t('Measuring…') : 'Run test (20 clicks, 30 s)'} primary onPress={run} />
      {!!msg && <Note>{msg}</Note>}
      {runs.map((r, i) => (
        <Note key={i}>
          {`${r.routeName}: ${r.result.valid}/${COUNT} heard · ${Math.round(r.result.medianMs)} ms · ±${r.result.spreadMs.toFixed(1)} ms · ${r.result.driftMsPer10s >= 0 ? '+' : ''}${r.result.driftMsPer10s.toFixed(1)} ms per 10 s · iOS says ${r.reportedMs} ms`}
        </Note>
      ))}
      {last && other && last.result.valid >= COUNT / 2 && other.result.valid >= COUNT / 2 && (
        <Note>{t('{{a}} adds about {{ms}} ms compared with {{b}}; iOS reports {{rep}} ms for that difference.', { a: last.routeName, b: other.routeName, ms: Math.round(last.result.medianMs - other.result.medianMs), rep: last.reportedMs - other.reportedMs })}</Note>
      )}
      {runs.length > 0 && <Btn label="Share results" onPress={share} />}
    </Card>
  );
}
