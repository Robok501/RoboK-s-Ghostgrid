/**
 * Latency test: the app plays accent clicks and listens to them with the microphone, so the delay of the audio route
 * (phone speaker, Bluetooth, ...) is measured without anyone playing. Run it once over the phone speaker and once over Bluetooth.
 */
import React, { useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { analyzeLoopback, loopbackSchedule, type LoopbackResult } from '@ghostgrid/core';
import Engine from '../../modules/ghostgrid-engine';
import { useApp } from '../AppContext';
import { readVoiceFile } from '../sketch/usePlayer';
import { Btn, Card, Chip, Note } from '../ui';
import { t } from '../i18n';

interface Run { count: number; at: string; route: string; routeName: string; reportedMs: number; ioBufferMs: number; result: LoopbackResult }

const isWeb = Platform.OS === 'web';
const COUNT = 20;
const LONG = 60;

export function LatencyCard() {
  const { mic, setMic, settings } = useApp();
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // in the browser the route has no name of its own: say what you are measuring
  const [webLabel, setWebLabel] = useState('Phone speaker');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const run = async (count = COUNT) => {
    if (busy) return;
    setBusy(true); setMsg(t('Preparing…'));
    const wasOff = !mic;
    try {
      if (wasOff && !(await setMic(true))) { setMsg(t('The microphone is off. Allow it in Settings → Ghostgrid.')); return; }
      Engine.ensureRunning(false);
      Engine.setClickSound('click');
      if (!Engine.startRecording()) { setMsg(t('The microphone could not start.')); return; }
      const info = Engine.info();
      const sched = loopbackSchedule(Engine.now(), count, 1.2);
      let next = 0;
      // clicks go to the engine just before they are due, not all at once
      await new Promise<void>((resolve) => {
        timer.current = setInterval(() => {
          const now = Engine.now();
          while (next < sched.length && sched[next] < now + 0.6) { Engine.scheduleClick(sched[next], 3); next++; }
          setMsg(t('Measuring… {{n}}/{{of}}', { n: Math.min(next, count), of: count }));
          if (now > sched[sched.length - 1] + 1.2) { if (timer.current) clearInterval(timer.current); timer.current = null; resolve(); }
        }, 100);
      });
      const f = Engine.stopRecording();
      const samples = isWeb ? (Engine as any).recordedSamples() as Float32Array : readVoiceFile(f.path);
      if (!isWeb) { try { new File(f.path).delete(); } catch { /* temp */ } }
      const result = analyzeLoopback(samples, f.sampleRate, f.startTime, sched);
      setRuns((r) => [...r, { count, at: new Date().toISOString(), route: info.route, routeName: isWeb ? webLabel : info.routeName, reportedMs: Math.round((info.outputLatency + info.ioBuffer) * 1000), ioBufferMs: Math.round(info.ioBuffer * 1000), result }]);
      setMsg(result.valid < count / 2 ? t('Only {{n}} of {{of}} clicks were heard. Hold the phone close to the speaker, turn the volume up and try again.', { n: result.valid, of: count }) : '');
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

  const last = runs[runs.length - 1];
  const other = last && [...runs].reverse().find((r) => r.routeName !== last.routeName);
  return (
    <Card title="Latency test">
      <Note>{isWeb ? t('Measures how long sound takes from this page to your ears, with nobody playing. 1) Pick Phone speaker, make sure the sound comes out of the phone itself, and run it. 2) Connect the phone to your drum module over Bluetooth audio, pick Bluetooth, hold the phone close to the module\'s speaker or headphones, and run it again.') : t('Measures how long sound takes from the app to your ears, with nobody playing. 1) Switch the sound to the iPhone speaker (Control Center, hold the audio card, AirPlay icon) and run it. 2) Switch to your drum module over Bluetooth, hold the phone close to the module’s speaker or headphones, and run it again.')}</Note>
      {isWeb && (
        <>
          <Note>{t('What are you measuring now? Pick it before you run the test.')}</Note>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Chip label="Phone speaker" on={webLabel === 'Phone speaker'} onPress={() => setWebLabel('Phone speaker')} />
            <Chip label="Bluetooth" on={webLabel === 'Bluetooth'} onPress={() => setWebLabel('Bluetooth')} />
          </View>
        </>
      )}
      <Btn label={busy ? t('Measuring…') : 'Run test (20 clicks, 30 s)'} primary onPress={() => run(COUNT)} />
      {!busy && <Btn label="Long test (60 clicks, 90 s)" onPress={() => run(LONG)} />}
      {!!msg && <Note>{msg}</Note>}
      {runs.map((r, i) => (
        <Note key={i}>
          {`${r.routeName}: ${r.result.valid}/${r.count} heard · ${Math.round(r.result.clicks.find((c) => c.latencyMs !== null)?.latencyMs ?? 0)} → ${Math.round([...r.result.clicks].reverse().find((c) => c.latencyMs !== null)?.latencyMs ?? 0)} ms (median ${Math.round(r.result.medianMs)}) · trend ${r.result.driftMsPer10s >= 0 ? '+' : ''}${r.result.driftMsPer10s.toFixed(1)} ms per 10 s · wobble ±${r.result.trendJitterMs.toFixed(1)} ms · ${isWeb ? "browser" : "iOS"} says ${r.reportedMs} ms`}
        </Note>
      ))}
      {last && other && last.result.valid >= last.count / 2 && other.result.valid >= other.count / 2 && (
        <Note>{t('{{a}} adds about {{ms}} ms compared with {{b}}; the system reports {{rep}} ms for that difference.', { a: last.routeName, b: other.routeName, ms: Math.round(last.result.medianMs - other.result.medianMs), rep: last.reportedMs - other.reportedMs })}</Note>
      )}
      {runs.length > 0 && <Btn label="Share results" onPress={share} />}
    </Card>
  );
}
