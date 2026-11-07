// Clock check: no sound, no speaker. Do the engine clock, the microphone clock and the phone's real-time clock
// run at the same speed? Used to tell a real Bluetooth delay creep from a timing error in the latency test.
import React, { useRef, useState } from 'react';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { analyzeClocks, type ClockCheckResult, type ClockSample } from '@ghostgrid/core';
import Engine from '../../modules/ghostgrid-engine';
import { useApp } from '../AppContext';
import { Btn, Card, Note } from '../ui';
import { t } from '../i18n';

interface Run { seconds: number; at: string; route: string; routeName: string; ioBufferMs: number; sampleRate: number; micRate: number; result: ClockCheckResult; samples: ClockSample[] }

const isWeb = Platform.OS === 'web';
const SECONDS = 90;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

export function ClockCard() {
  const { mic, setMic } = useApp();
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
      if (!Engine.startRecording()) { setMsg(t('The microphone could not start.')); return; }
      const info = Engine.info();
      const w0 = now(), e0 = Engine.now();
      const samples: ClockSample[] = [];
      let micRate = info.sampleRate;
      await new Promise<void>((resolve) => {
        timer.current = setInterval(() => {
          const w = now() - w0;
          const p = Engine.recordedProgress();
          if (p.rate > 0) micRate = p.rate;
          if (p.rate > 0 && p.frames > 0) samples.push({ wall: w, engine: Engine.now() - e0, mic: p.frames / p.rate });
          setMsg(t('Checking the clocks… {{n}}/{{of}} s', { n: Math.min(Math.round(w), SECONDS), of: SECONDS }));
          if (w >= SECONDS) { if (timer.current) clearInterval(timer.current); timer.current = null; resolve(); }
        }, 1000);
      });
      const f = Engine.stopRecording();
      if (!isWeb) { try { new File(f.path).delete(); } catch { /* temp */ } }
      const result = analyzeClocks(samples);
      setRuns((r) => [...r, { seconds: SECONDS, at: new Date().toISOString(), route: info.route, routeName: isWeb ? 'browser' : info.routeName, ioBufferMs: Math.round(info.ioBuffer * 1000), sampleRate: info.sampleRate, micRate, result, samples }]);
      setMsg('');
    } catch (e) {
      setMsg(t('Test failed: {{msg}}', { msg: (e as Error).message }));
    } finally {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      if (wasOff) setMic(false);
      setBusy(false);
    }
  };

  const share = async () => {
    try {
      const file = new File(Paths.cache, 'ghostgrid-clock-check.json');
      try { if (file.exists) file.delete(); } catch { /* overwrite */ }
      file.writeSync(JSON.stringify({ app: 'Ghostgrid clock check', version: 1, runs }, null, 1));
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json' });
    } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <Card title="Clock check">
      <Note>{t('No sound needed. For 90 seconds the app compares the clock of the audio engine, the microphone clock and the phone clock. If they agree, a delay that keeps growing in the latency test is real; if not, the test itself drifts. Run it once with the drum module connected over Bluetooth and once without.')}</Note>
      <Btn label={busy ? t('Checking…') : 'Run clock check (90 s)'} primary onPress={run} />
      {!!msg && <Note>{msg}</Note>}
      {runs.map((r, i) => (
        <Note key={i}>
          {`${r.routeName} · engine ${r.sampleRate} Hz, mic ${r.micRate} Hz · engine vs phone clock ${r.result.engineVsWallPpm.toFixed(0)} ppm · mic vs engine ${r.result.micVsEnginePpm.toFixed(0)} ppm (${r.result.creepMsPer10s.toFixed(2)} ms per 10 s) · wobble ${r.result.wobbleMs.toFixed(2)} ms · ${r.result.verdict === 'agree' ? t('the clocks agree') : r.result.verdict === 'mismatch' ? t('the clocks DISAGREE') : t('unclear, run it again')}`}
        </Note>
      ))}
      {runs.length > 0 && <Btn label={t('Share results')} onPress={share} />}
    </Card>
  );
}
