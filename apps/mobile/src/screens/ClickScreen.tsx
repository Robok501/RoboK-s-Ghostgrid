/**
 * Click: the metronome on one screen — tempo, beats, mode, Play. Mode settings and meter & sound open in sheets;
 * the player level lives in Settings. Coach, gap and drop show the timing pad while you play.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  accentGroupStarts, cycleLevel, groupOptions, groupsFor, levelsFor, modesForLevel, sectionLetter,
  type ClickStep, type Level, type Mode,
} from '@ghostgrid/core';
import Engine from '../../modules/ghostgrid-engine';
import { useApp } from '../AppContext';
import { BeatRow } from '../click/BeatRow';
import { CoachPanel } from '../click/CoachPanel';
import { BUILTIN_PRESETS, SUB_NAMES } from '../click/presets';
import { SongMap } from '../click/SongMap';
import { TempoBlock } from '../click/TempoBlock';
import { useClick } from '../click/useClick';
import { C } from '../theme';
import { Btn, Chip, Note, Pill, Row, Seg, SectionTitle, Sheet, Stepper, Toggle, TopBar } from '../ui';
import type { ClickSettings, ClickSound, CoachInput, Preset } from '../store';

export const LEVELS = [
  { level: 1, name: 'First Sticks', sub: 'just the click' },
  { level: 2, name: 'Groove', sub: 'gaps & ramps' },
  { level: 3, name: 'Chops', sub: 'odd meters' },
  { level: 4, name: 'Session Pro', sub: 'everything' },
];
const MODE_ORDER: Mode[] = ['basic', 'coach', 'gap', 'ramp', 'program', 'drop'];
const MODE_NAME: Record<Mode, string> = { basic: 'Basic', coach: 'Coach', gap: 'Gap', ramp: 'Ramp', program: 'Program', drop: 'Drop' };
const MODE_DESC: Record<Mode, string> = {
  basic: 'A plain programmable click. Tap a beat to cycle accent, normal, soft and mute.',
  coach: 'Timing coach: hit on the click and see how early or late every hit is, by tap, mic or your e-drum pads.',
  gap: 'Gap click: the click plays for a few bars, then drops out. Keep playing and land on the one when it returns.',
  drop: 'Random drop-outs: single beats or whole bars go silent without warning, so you stop leaning on the click.',
  ramp: 'Speed builder: the tempo climbs (or falls) by a set step every few bars until it reaches the target.',
  program: 'A song or exercise as sections, each with its own bars, tempo and meter. Plays through or loops.',
};
const INPUT_NAME: Record<CoachInput, string> = { tap: 'tap pad', mic: 'mic', pads: 'e-drum' };

function modeSummary(c: ClickSettings): string {
  switch (c.mode) {
    case 'coach': return `scoring by ${INPUT_NAME[c.input]}`;
    case 'gap': return `${c.gapOn} bar${c.gapOn > 1 ? 's' : ''} on, ${c.gapOff} off`;
    case 'drop': return `${c.dropChance}% of ${c.dropUnit} drop out`;
    case 'ramp': return `${c.bpm} → ${c.rampTarget}, ${c.rampStep > 0 ? '+' : ''}${c.rampStep} every ${c.rampEvery} bars`;
    case 'program': return `${c.program.length} sections${c.loop ? ', looping' : ''}`;
    default: return 'a plain click';
  }
}

export function ClickScreen() {
  const { settings, setClick, setMic, mic, micLevel } = useApp();
  const c = settings.click;
  const k = useClick();
  const [sheet, setSheet] = useState<null | 'mode' | 'meter'>(null);
  const program = c.mode === 'program';
  const showPad = c.mode === 'coach' || c.mode === 'gap' || c.mode === 'drop';
  const modes = MODE_ORDER.filter((m) => modesForLevel(c.level).includes(m));
  const meterBeats = program ? (k.running && k.cur ? k.cur.beats : c.program[0]?.beats ?? 4) : c.beats;
  const meterLine = `${meterBeats}/${c.unit}${c.sub > 1 ? ` · ${SUB_NAMES[c.sub] ?? `${c.sub} per beat`}` : ''} · ${c.sound === 'cowbell' ? 'bell' : c.sound}`;

  const setInput = async (input: CoachInput) => {
    setClick({ input });
    if (input === 'mic' && !mic) { if (!(await setMic(true))) setClick({ input: 'tap' }); }
    if (input !== 'mic' && mic) await setMic(false);
  };
  const setSound = (sound: ClickSound) => {
    setClick({ sound });
    Engine.setClickSound(sound);
    if (!k.running) Engine.scheduleClick(Engine.now() + 0.05, 3);
  };
  const applyPreset = (p: Preset) => setClick({
    bpm: p.bpm, beats: p.beats, unit: p.unit, sub: p.sub, levels: p.levels.slice() as Level[], groups: p.groups ?? null,
    mode: c.mode === 'program' ? 'basic' : c.mode,
  });

  return (
    <View style={s.root}>
      <TopBar title="Click" sub={LEVELS.find((l) => l.level === c.level)?.name} />
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <TempoBlock bpm={c.bpm} shown={k.tempo} meter={`${meterBeats}/${c.unit}`} disabled={program}
          onChange={(bpm) => setClick({ bpm })} onTap={k.tapTempoAt} />

        <BeatRow beats={c.beats} unit={c.unit} groups={c.groups} levels={levelsFor(c.levels, c.beats)} sub={c.sub} cur={k.cur}
          locked={program} onCycle={(i) => setClick((cc) => { const l = levelsFor(cc.levels, cc.beats); l[i] = cycleLevel(l[i]); return { levels: l }; })} />

        <View style={s.pickers}>
          <Pressable onPress={() => setSheet('mode')} style={({ pressed }) => [s.picker, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`Mode ${MODE_NAME[c.mode]}, ${modeSummary(c)}`}>
            <Text style={s.pickLabel}>MODE</Text>
            <Text style={s.pickValue} numberOfLines={1}>{MODE_NAME[c.mode]} ›</Text>
            <Text style={s.pickSub} numberOfLines={1}>{modeSummary(c)}</Text>
          </Pressable>
          <Pressable onPress={() => setSheet('meter')} style={({ pressed }) => [s.picker, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`Meter and sound, ${meterLine}`}>
            <Text style={s.pickLabel}>METER & SOUND</Text>
            <Text style={s.pickValue} numberOfLines={1}>{meterBeats}/{c.unit} ›</Text>
            <Text style={s.pickSub} numberOfLines={1}>{meterLine.split(' · ').slice(1).join(' · ')}</Text>
          </Pressable>
        </View>

        <Status c={c} cur={k.cur} running={k.running} />

        {program && <SongMap program={c.program} loop={c.loop} cur={k.cur} running={k.running} onPlayFrom={(i) => k.start(i)} />}

        {showPad && (
          <CoachPanel input={c.input} running={k.running} last={k.last} log={k.log} tol={c.tol}
            calibrating={k.calibrating} calibCount={k.calibCount} micLevel={micLevel} onTap={(ms) => { k.tap(ms); }} />
        )}
      </ScrollView>

      <View style={s.playBar}>
        <Btn label={k.running ? 'Stop' : 'Play'} primary active={k.running} onPress={() => (k.running ? k.stop() : k.start())} style={{ flex: 1 }} />
      </View>

      <Sheet visible={sheet === 'mode'} title="Mode" onClose={() => setSheet(null)}>
        <View style={s.modes}>
          {modes.map((m) => (
            <Pressable key={m} onPress={() => setClick({ mode: m })} style={[s.modeBtn, c.mode === m && s.modeOn]}
              accessibilityRole="button" accessibilityState={{ selected: c.mode === m }}>
              <Text style={[s.modeTxt, c.mode === m && { color: C.bg }]}>{MODE_NAME[m]}</Text>
            </Pressable>
          ))}
        </View>
        <Note>{MODE_DESC[c.mode]}</Note>
        {modes.length < MODE_ORDER.length && <Note>More modes at a higher player level (Settings).</Note>}
        <View><ModeSettings c={c} setClick={setClick} setInput={setInput} k={k} /></View>
      </Sheet>

      <Sheet visible={sheet === 'meter'} title="Meter & sound" onClose={() => setSheet(null)}>
        <View>
          <Row label="Beats per bar" first>
            <Stepper value={c.beats} min={1} max={16} onChange={(beats) => setClick((cc) => ({ beats, levels: levelsFor(cc.levels, beats), groups: null }))} />
          </Row>
          {c.level >= 3 && (
            <Row label="Beat unit">
              <Seg options={[{ value: 4, label: '♩ 4' }, { value: 8, label: '♪ 8' }]} value={c.unit} onChange={(unit) => setClick({ unit: unit as 4 | 8 })} />
            </Row>
          )}
          {c.level >= 2 && (
            <Row label="Subdivision">
              <Seg options={[1, 2, 3, 4].map((v) => ({ value: v, label: String(v) }))} value={c.sub} onChange={(sub) => setClick({ sub })} />
            </Row>
          )}
          <Row label="Click sound">
            <Seg small options={[{ value: 'click', label: 'Click' }, { value: 'wood', label: 'Wood' }, { value: 'cowbell', label: 'Bell' }, { value: 'hat', label: 'Hat' }]}
              value={c.sound} onChange={(v) => setSound(v as ClickSound)} />
          </Row>
        </View>
        {c.level >= 3 && c.beats >= 4 && (
          <View>
            <SectionTitle>Grouping</SectionTitle>
            <Note>How the beats are counted and shown.</Note>
            <View style={s.chips}>
              {groupOptions(c.beats, c.unit).map((g, i) => {
                const cur = groupsFor(c.beats, c.unit, c.groups).join('+');
                return <Chip key={g.join('+')} label={`${g.join('+')}${i === 0 ? ' · auto' : ''}`} on={g.join('+') === cur}
                  onPress={() => setClick({ groups: i === 0 ? null : g })} />;
              })}
              <Chip label="Accent group starts" onPress={() => setClick({ levels: accentGroupStarts(groupsFor(c.beats, c.unit, c.groups)) })} />
            </View>
          </View>
        )}
        {c.level >= 2 && (
          <View>
            <SectionTitle>Presets</SectionTitle>
            <View style={s.chips}>
              {BUILTIN_PRESETS.filter((p) => c.level >= 3 || p.unit === 4).map((p) => <Chip key={p.name} label={p.name} onPress={() => applyPreset(p)} />)}
              {c.presets.filter((p) => c.level >= 3 || p.unit === 4).map((p, i) => (
                <Chip key={`u${i}`} label={p.name} onPress={() => applyPreset(p)}
                  onRemove={() => setClick((cc) => ({ presets: cc.presets.filter((_, j) => j !== i) }))} />
              ))}
              <Chip label="+ Save current" onPress={() => setClick((cc) => ({
                presets: [...cc.presets, {
                  name: `${cc.bpm} · ${cc.beats}/${cc.unit}${SUB_NAMES[cc.sub] ? ' · ' + SUB_NAMES[cc.sub] : ''}`,
                  bpm: cc.bpm, beats: cc.beats, unit: cc.unit, sub: cc.sub, levels: levelsFor(cc.levels, cc.beats), groups: cc.groups,
                }],
              }))} />
            </View>
          </View>
        )}
      </Sheet>
    </View>
  );
}

function Status({ c, cur, running }: { c: ClickSettings; cur: ClickStep | null; running: boolean }) {
  if (!running || !cur) {
    const idle: Record<Mode, string> = {
      basic: 'Tap a beat to change its accent',
      coach: 'Press Play and hit on every click.',
      gap: `${c.gapOn} bar${c.gapOn > 1 ? 's' : ''} click, ${c.gapOff} bar${c.gapOff > 1 ? 's' : ''} silent. Keep the time yourself.`,
      drop: `Random ${c.dropUnit} go silent after ${c.dropWarm} warm-up bars.`,
      ramp: `${c.bpm} → ${c.rampTarget} BPM, ${c.rampStep > 0 ? '+' : ''}${c.rampStep} every ${c.rampEvery} bars.`,
      program: `${c.program.length} sections${c.loop ? ', looping' : ''}. Tap a section in the song map to start there.`,
    };
    return <Text style={s.status}>{idle[c.mode]}</Text>;
  }
  const bar = `Bar ${cur.bar + 1}`;
  let extra: React.ReactNode = null;
  if (c.mode === 'gap') {
    const cyc = c.gapOn + c.gapOff, p = cur.bar % cyc, on = p < c.gapOn;
    extra = <><Pill label={on ? 'Click' : 'Silent'} strong={!on} /><Text style={s.statusMuted}>{on ? `${c.gapOn - p} until silence` : `${cyc - p} until click returns`}</Text></>;
  } else if (c.mode === 'drop') {
    extra = !cur.audible ? <Pill label="Dropped" strong /> : null;
  } else if (c.mode === 'ramp') {
    const left = c.rampEvery - (cur.bar % c.rampEvery);
    extra = <Text style={s.statusMuted}>{cur.bpm === c.rampTarget ? 'Target reached' : `next step in ${left} bar${left > 1 ? 's' : ''}`}</Text>;
  } else if (c.mode === 'program') {
    const sec = c.program[cur.section];
    return (
      <View style={s.statusRow}>
        <Pill label={`Section ${sectionLetter(cur.section)}`} />
        <Text style={s.statusStrong}>Bar {cur.sectionBar + 1} of {sec?.bars}</Text>
        <Text style={s.statusMuted}>{sec?.beats}/4 at {sec?.bpm}</Text>
      </View>
    );
  }
  return <View style={s.statusRow}><Text style={s.statusStrong}>{bar}</Text>{extra}</View>;
}

function ModeSettings({ c, setClick, setInput, k }: {
  c: ClickSettings; setClick: ReturnType<typeof useApp>['setClick']; setInput: (i: CoachInput) => void; k: ReturnType<typeof useClick>;
}) {
  const { settings, setMicSens } = useApp();
  switch (c.mode) {
    case 'gap':
      return <>
        <Row label="Click on" hint="bars with click"><Stepper value={c.gapOn} min={1} max={16} onChange={(gapOn) => setClick({ gapOn })} /></Row>
        <Row label="Click off" hint="silent bars"><Stepper value={c.gapOff} min={1} max={16} onChange={(gapOff) => setClick({ gapOff })} /></Row>
      </>;
    case 'drop':
      return <>
        <Row label="Drop"><Seg options={[{ value: 'beats', label: 'Beats' }, { value: 'bars', label: 'Bars' }]} value={c.dropUnit} onChange={(v) => setClick({ dropUnit: v as 'beats' | 'bars' })} /></Row>
        <Row label="Chance" hint={`per ${c.dropUnit === 'beats' ? 'beat' : 'bar'}`}><Stepper value={c.dropChance} min={5} max={90} step={5} format={(v) => `${v}%`} onChange={(dropChance) => setClick({ dropChance })} /></Row>
        {c.dropUnit === 'bars' && <Row label="Length" hint="bars per drop-out"><Stepper value={c.dropLen} min={1} max={8} onChange={(dropLen) => setClick({ dropLen })} /></Row>}
        <Row label="Warm-up" hint="bars before drops start"><Stepper value={c.dropWarm} min={0} max={16} onChange={(dropWarm) => setClick({ dropWarm })} /></Row>
      </>;
    case 'ramp':
      return <>
        <Row label="Start" hint="BPM"><Stepper value={c.bpm} min={20} max={300} onChange={(bpm) => setClick({ bpm })} /></Row>
        <Row label="Target" hint="BPM"><Stepper value={c.rampTarget} min={20} max={300} onChange={(rampTarget) => setClick({ rampTarget })} /></Row>
        <Row label="Step" hint="BPM per change"><Stepper value={c.rampStep} min={1} max={20} format={(v) => `+${v}`} onChange={(rampStep) => setClick({ rampStep })} /></Row>
        <Row label="Every" hint="bars"><Stepper value={c.rampEvery} min={1} max={32} onChange={(rampEvery) => setClick({ rampEvery })} /></Row>
      </>;
    case 'coach': {
      const fixKey = c.input;
      return <>
        <Row label="Input"><Seg small options={[{ value: 'tap', label: 'Tap' }, { value: 'mic', label: 'Mic' }, { value: 'pads', label: 'E-drum' }]} value={c.input} onChange={(v) => setInput(v as CoachInput)} /></Row>
        {c.input === 'mic' && <Note>Use headphones or Bluetooth to your module, so the mic hears your drums and not the click.</Note>}
        {c.input === 'mic' && <Row label="Mic sensitivity" hint="higher hears softer hits"><Stepper value={settings.micSens} min={1} max={10} onChange={setMicSens} /></Row>}
        {c.input === 'pads' && <Note>Pair your e-drum in Settings. Every pad is scored, with a breakdown per pad.</Note>}
        {c.level >= 2 && <Row label="Grade against"><Seg options={[{ value: 'beat', label: 'Beats' }, { value: 'sub', label: 'Subdivisions' }]} value={c.grade} onChange={(v) => setClick({ grade: v as 'beat' | 'sub' })} /></Row>}
        <Row label="Window"><Seg small options={[{ value: 10, label: 'Pro ±10' }, { value: 15, label: '±15' }, { value: 25, label: 'Easy ±25' }]} value={c.tol} onChange={(tol) => setClick({ tol })} /></Row>
        {c.level >= 4 && <Row label="Latency fix" hint="shifts every reading"><Stepper value={c.calib[fixKey]} min={-250} max={250} step={2} format={(v) => `${v > 0 ? '+' : ''}${v} ms`} onChange={(v) => setClick((cc) => ({ calib: { ...cc.calib, [fixKey]: v } }))} /></Row>}
        <View style={s.btnRow}>
          <Btn label={k.calibrating ? `Calibrating ${k.calibCount}/8` : 'Calibrate'} onPress={() => k.startCalibration(c.input)} />
          <Btn label="Reset hits" onPress={k.resetHits} />
        </View>
      </>;
    }
    case 'program':
      return <>
        {c.program.map((sec, i) => (
          <View key={i} style={s.secCard}>
            <View style={s.secHead}>
              <Text style={s.secTitle}>Section {sectionLetter(i)}</Text>
              {c.program.length > 1 && <Btn label="Remove" onPress={() => setClick((cc) => ({ program: cc.program.filter((_, j) => j !== i) }))} />}
            </View>
            {(['bars', 'bpm', 'beats'] as const).map((f) => (
              <Row key={f} label={{ bars: 'Bars', bpm: 'BPM', beats: 'Beats per bar' }[f]}>
                <Stepper value={sec[f]} min={f === 'bpm' ? 20 : 1} max={f === 'bpm' ? 300 : f === 'bars' ? 64 : 16}
                  onChange={(v) => setClick((cc) => ({ program: cc.program.map((x, j) => (j === i ? { ...x, [f]: v } : x)) }))} />
              </Row>
            ))}
          </View>
        ))}
        <View style={s.btnRow}>
          <Btn label="+ Add section" onPress={() => setClick((cc) => ({ program: [...cc.program, { ...cc.program[cc.program.length - 1] }] }))} />
        </View>
        <Toggle label="Loop" value={c.loop} onChange={(loop) => setClick({ loop })} />
      </>;
    default:
      return null;
  }
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 16, paddingBottom: 20, gap: 16 },
  pickers: { flexDirection: 'row', gap: 10 },
  picker: { flex: 1, minHeight: 72, borderRadius: 14, backgroundColor: C.surface, paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center' },
  pickLabel: { color: C.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  pickValue: { color: C.fg, fontSize: 18, fontWeight: '700', marginTop: 2 },
  pickSub: { color: C.muted, fontSize: 12, marginTop: 1 },
  status: { color: C.muted, fontSize: 14, textAlign: 'center', minHeight: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 24, flexWrap: 'wrap' },
  statusStrong: { color: C.fg, fontSize: 15, fontWeight: '600' },
  statusMuted: { color: C.muted, fontSize: 14 },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  modeBtn: { flexGrow: 1, flexBasis: '30%', minHeight: 52, borderRadius: 12, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  modeOn: { backgroundColor: C.fg },
  modeTxt: { color: C.muted, fontSize: 15, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 6 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 6 },
  secCard: { borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 10, marginVertical: 4 },
  secHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  secTitle: { color: C.fg, fontSize: 15, fontWeight: '700' },
  playBar: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, backgroundColor: C.bg },
});
