// Web only: can the phone make the drum module play the click itself over Bluetooth MIDI?
// Two experiments: MIDI clock (the module's own metronome follows our tempo) and click notes (we play a sound on the
// module beat by beat). Nothing accumulates over Bluetooth MIDI, unlike Bluetooth audio.
import React, { useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import Engine from '../../modules/ghostgrid-engine';
import { Btn, Card, Chip, Note } from '../ui';
import { t } from '../i18n';

const SECONDS = 30;
const NOTES: { label: string; note: number }[] = [
  { label: 'Claves (75)', note: 75 },
  { label: 'Side stick (37)', note: 37 },
  { label: 'Cowbell (56)', note: 56 },
  { label: 'Snare (38)', note: 38 },
];

export function MidiClockCard() {
  const [kind, setKind] = useState<'clock' | 'notes'>('clock');
  const [bpm, setBpm] = useState(100);
  const [ahead, setAhead] = useState(false);
  const [note, setNote] = useState(75);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  if (Platform.OS !== 'web') return null;
  const E = Engine as any;

  const stop = (sendStop: boolean) => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (sendStop && kind === 'clock') E.midiSendAt([0xfc], performance.now());
    setBusy(false);
  };

  const run = () => {
    if (busy) { stop(true); setMsg(t('Stopped.')); return; }
    const target = E.midiTarget?.() as string | undefined;
    if (!target) { setMsg(t('No MIDI output yet. Connect your module with "Connect Bluetooth MIDI" in the E-drum card first.')); return; }
    setBusy(true);
    const lookahead = ahead ? 30 : 0;
    const t0 = performance.now() + 300;
    const tick = 60000 / (bpm * 24);   // ms per clock pulse
    const beat = 60000 / bpm;
    let n = 0, sent = 0, started = false;
    timer.current = setInterval(() => {
      const now = performance.now();
      const end = t0 + SECONDS * 1000;
      for (;;) {
        let due: number, data: number[] | null = null, off: number[] | null = null;
        if (kind === 'clock') {
          if (!started) { due = t0; data = [0xfa]; } else { due = t0 + n * tick; data = [0xf8]; }
        } else { due = t0 + n * beat; data = [0x99, note, 100]; off = [0x99, note, 0]; }
        if (due > now + lookahead || due >= end) break;
        E.midiSendAt(data, due); sent++;
        if (off) E.midiSendAt(off, due + 60);
        if (kind === 'clock') { if (!started) started = true; else n++; } else n++;
      }
      if (now >= end) { stop(true); setMsg(t('Done: {{n}} messages sent to {{to}}.', { n: sent, to: target })); return; }
      setMsg(t('Sending to {{to}}… {{n}} messages, {{s}}/{{of}} s', { to: target, n: sent, s: Math.max(0, Math.round((now - t0) / 1000)), of: SECONDS }));
    }, 8);
  };

  return (
    <Card title="MIDI click test">
      <Note>{t('Can the drum module play the click itself, over Bluetooth MIDI, so no Bluetooth audio is needed? Connect the module first, then pick what to send and press the button. Clock: set the module to follow external MIDI clock (see its manual: sync / clock source) and start its metronome. Notes: the module plays the chosen sound when it receives the note.')}</Note>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Chip label="MIDI clock" on={kind === 'clock'} onPress={() => setKind('clock')} />
        <Chip label="Click notes" on={kind === 'notes'} onPress={() => setKind('notes')} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {[80, 100, 120].map((b) => <Chip key={b} label={`${b} bpm`} on={bpm === b} onPress={() => setBpm(b)} />)}
      </View>
      {kind === 'notes' && (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {NOTES.map((n) => <Chip key={n.note} label={n.label} on={note === n.note} onPress={() => setNote(n.note)} />)}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <Chip label="Send exactly on time" on={!ahead} onPress={() => setAhead(false)} />
        <Chip label="30 ms ahead, with timestamps" on={ahead} onPress={() => setAhead(true)} />
      </View>
      <Btn label={busy ? t('Stop') : kind === 'clock' ? 'Send MIDI clock (30 s)' : 'Send click notes (30 s)'} primary onPress={run} />
      {!!msg && <Note>{msg}</Note>}
    </Card>
  );
}
