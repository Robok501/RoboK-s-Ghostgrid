/** Settings: audio route, e-drum pairing and pad map (incl. learning pads), velocity rules, calibrations. */
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { INSTRUMENTS, NOTATION_STYLES, PAD_NAMES, applyLevel, exampleIdea, notationStyle, notesFor, staffName, type PadKey } from '@ghostgrid/core';
import { LEVELS } from './ClickScreen';
import type { ClickSettings } from '../store';
import { Score } from '../sketch/Score';
import Engine from '../../modules/ghostgrid-engine';
import { useApp } from '../AppContext';
import { C } from '../theme';
import { Btn, Card, Chip, Note, Row, Seg, Stepper, Toggle, TopBar, Value } from '../ui';
import { LANGUAGES, deviceLanguage, t } from '../i18n';

/** On-time window that comes with each player level (the Coach can still change it). */
export const LEVEL_TOL: Record<number, number> = { 1: 40, 2: 25, 3: 25, 4: 15 };

const LEARN_ORDER: PadKey[] = ['bd', 'sn', 'hh', 'hh+o', 'hf', 't1', 't2', 'ft', 'rd', 'cr'];

export function SettingsScreen() {
  const { info, error, settings, setKeepBt, setMicSens, setPads, setClick, setSketch, sources, pedal, lastHit, learning, setLearning, mic, setLang } = useApp();
  const sk = settings.sketch;
  const style = useMemo(() => notationStyle(sk.style, sk.custom), [sk.style, sk.custom]);
  const example = useMemo(() => exampleIdea(), []);
  const { width } = useWindowDimensions();
  const p = settings.pads, calib = settings.click.calib;
  const bt = info?.route === 'bluetooth';

  const c = settings.click;
  const setLevel = (level: number) => {
    const next = applyLevel({ sub: c.sub, mode: c.mode, unit: c.unit, groups: c.groups }, level) as Pick<ClickSettings, 'sub' | 'mode' | 'unit' | 'groups'>;
    setClick({ ...next, level, tol: LEVEL_TOL[level] ?? c.tol });
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <TopBar title="Settings" />
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={s.scroll}>
      {!!error && <Text style={s.error}>{error}</Text>}

      <Card title="Language">
        <View style={s.chips}>
          <Chip label={t('Like the iPhone ({{lang}})', { lang: LANGUAGES.find((l) => l.code === deviceLanguage())?.name })} on={settings.lang === 'auto'} onPress={() => setLang('auto')} />
          {LANGUAGES.map((l) => <Chip key={l.code} label={l.name} on={settings.lang === l.code} onPress={() => setLang(l.code)} />)}
        </View>
      </Card>

      <Card title="Player level">
        <Note>Shows the options that fit where you are. A lower level keeps the Click screen simple and gives the Coach a wider on-time window.</Note>
        <View style={s.chips}>
          {LEVELS.map((l) => <Chip key={l.level} label={`${t(l.name)} · ${t(l.sub)} · ±${LEVEL_TOL[l.level]} ms`} on={c.level === l.level} onPress={() => setLevel(l.level)} />)}
        </View>
      </Card>

      <Card title="Audio out">
        <Row label="Playing through" first><Value good={bt}>{info ? `${info.routeName || info.route}${bt ? ' · Bluetooth' : ''}` : t('starting…')}</Value></Row>
        <Row label="Output delay" hint="measured by iOS; Bluetooth adds most of it"><Value>{info ? `${Math.round(info.outputLatency * 1000)} ms` : '–'}</Value></Row>
        <Row label="Sample rate"><Value>{info ? `${Math.round(info.sampleRate)} Hz` : '–'}</Value></Row>
        <Toggle label="Keep click on Bluetooth" hint="also while the microphone listens" value={settings.keepBt} onChange={setKeepBt} />
        <Row label="Microphone"><Value>{t(mic ? 'on' : 'off')}</Value></Row>
        <Row label="Mic sensitivity" hint="Coach · Mic, voice to notes and teaching"><Stepper value={settings.micSens} min={1} max={10} onChange={setMicSens} /></Row>
      </Card>

      <Card title="E-drum">
        <Note>{sources.length ? t('Connected: {{names}}', { names: sources.join(', ') }) : t('No MIDI device yet. Pair your module over Bluetooth, or connect it with a USB cable.')}</Note>
        <View style={s.btnRow}><Btn label="Pair Bluetooth MIDI" onPress={() => Engine.showBluetoothMidi()} /></View>
        <Row label="Note map">
          <Seg options={[{ value: 'roland', label: 'Roland TD' }, { value: 'gm', label: 'General MIDI' }]} value={p.preset} onChange={(preset) => setPads((x) => ({ ...x, preset }))} />
        </Row>
        <Row label="Last hit"><Text style={s.mono} numberOfLines={2}>{lastHit || t('none yet')}</Text></Row>
        <Row label="Hi-hat pedal" hint="0 = open … 127 = closed"><Value>{pedal === null ? t('not received yet') : `${pedal} · ${t(pedal >= p.hhClosedAt ? 'closed' : 'open')}`}</Value></Row>
        <Row label="Hi-hat closed from" hint="pedal position"><Stepper value={p.hhClosedAt} min={40} max={127} step={5} onChange={(hhClosedAt) => setPads((x) => ({ ...x, hhClosedAt }))} /></Row>
        <Row label="Accent from velocity"><Stepper value={p.acc} min={60} max={127} step={5} onChange={(acc) => setPads((x) => ({ ...x, acc }))} /></Row>
        <Row label="Ghost snare below" hint="velocity"><Stepper value={p.ghost} min={10} max={80} step={5} onChange={(ghost) => setPads((x) => ({ ...x, ghost }))} /></Row>
      </Card>

      <Card title="Learn pads">
        <Note>For modules that send other notes: tap an instrument, then hit its pad.</Note>
        <View style={s.chips}>
          {LEARN_ORDER.map((key) => {
            const ns = notesFor(p, key);
            const on = learning === key;
            return <Chip key={key} on={on} label={`${t(PAD_NAMES[key])} · ${on ? t('hit the pad…') : ns.length ? ns.join(', ') : '–'}`}
              onPress={() => setLearning(on ? null : key)} />;
          })}
        </View>
        <View style={s.btnRow}><Btn label="Forget learned pads" onPress={() => setPads((x) => ({ ...x, custom: {} }))} /></View>
      </Card>

      <Card title="Notation">
        <Note>How the score is written. Switching only redraws it; your grooves don't change.</Note>
        <View style={s.chips}>
          {NOTATION_STYLES.map((st) => <Chip key={st.id} label={t(st.name)} on={sk.style === st.id} onPress={() => setSketch({ style: st.id })} />)}
          <Chip label="Custom" on={sk.style === 'custom'} onPress={() => setSketch({ style: 'custom', custom: sk.custom.map && Object.keys(sk.custom.map).length ? sk.custom : { voices: style.voices, map: { ...style.map } } })} />
        </View>
        <Note>{t(style.blurb)}</Note>
        {sk.style === 'custom' && (
          <>
            <Row label="Voices" hint="hands up, feet down — or all in one">
              <Seg options={[{ value: 2, label: 'Two' }, { value: 1, label: 'One' }]} value={sk.custom.voices} onChange={(voices) => setSketch({ custom: { ...sk.custom, voices: voices as 1 | 2 } })} />
            </Row>
            {INSTRUMENTS.map((ins) => {
              const pl = style.map[ins.id];
              const set = (patch: Partial<typeof pl>) => setSketch({ custom: { ...sk.custom, map: { ...sk.custom.map, [ins.id]: { ...pl, ...patch } } } });
              return (
                <Row key={ins.id} label={t(ins.name)} hint={staffName(pl.step)}>
                  <View style={s.inline}>
                    <Seg small options={[{ value: 'note', label: '●' }, { value: 'x', label: '×' }]} value={pl.head} onChange={(head) => set({ head: head as 'x' | 'note' })} />
                    <Stepper value={pl.step} min={-4} max={12} onChange={(step) => set({ step })} />
                  </View>
                </Row>
              );
            })}
          </>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Score idea={example} width={Math.max(560, width - 64)} style={style} count={false} selectedBar={null} />
        </ScrollView>
      </Card>

      <Card title="Calibration">
        <Note>Set in Click → Coach with Calibrate (8 hits on the click). Reset here.</Note>
        {(['tap', 'mic', 'pads'] as const).map((k, i) => (
          <Row key={k} label={{ tap: 'Tap pad', mic: 'Microphone', pads: 'E-drum pads' }[k]} first={i === 0}>
            <View style={s.inline}>
              <Value>{`${calib[k] > 0 ? '+' : ''}${calib[k]} ms`}</Value>
              <Btn label="Reset" onPress={() => setClick((cc) => ({ calib: { ...cc.calib, [k]: 0 } }))} />
            </View>
          </Row>
        ))}
      </Card>

      <Text style={s.footer}>{t('Ghostgrid {{v}} · settings and ideas stay on this device', { v: '0.5' })}</Text>
    </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, gap: 14, paddingBottom: 32 },
  error: { color: C.late, fontSize: 14 },
  btnRow: { flexDirection: 'row', gap: 8, paddingVertical: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 4 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mono: { color: C.fg, fontSize: 13, fontFamily: 'Menlo', flexShrink: 1, textAlign: 'right' },
  footer: { color: C.muted, fontSize: 12, textAlign: 'center' },
});
