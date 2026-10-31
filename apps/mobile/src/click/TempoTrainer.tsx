/**
 * Tempo trainer: a graded ladder of short listening and playing exercises that teach you to judge tempo.
 * Rounds of 8 questions; 6 right unlocks the next exercise. Progress stays on the device.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import {
  ANCHORS, DRUM_SOUNDS, LADDER, PASS, PLAY_HITS, ROUND, TIER_NAMES, afterRound, bpmFromHits, gradeChoice, gradeDrift, gradeName,
  gradePlayback, renderClip, type Clip, type Grade, type Question, type RenderedClip,
} from '@ghostgrid/core';
import Engine from '../../modules/ghostgrid-engine';
import { useApp } from '../AppContext';
import { C, F } from '../theme';
import { Btn, Card, Note, Pill, Row, Seg, Toggle, useHoldRepeat } from '../ui';
import type { CoachInput } from '../store';

type Phase = 'ready' | 'playing' | 'answer' | 'countdown' | 'play' | 'feedback' | 'done';
interface Seg_ { from: number; to: number; r: RenderedClip }

const MEMORY_WAIT = 10;
const HOLD_LATE = 0.3;

/** Schedule clips back to back on the engine; returns their engine-time spans. */
function playClips(clips: Clip[], gap = 0.9): Seg_[] {
  let t = Engine.now() + 0.15;
  return clips.map((c) => {
    const r = renderClip(c);
    for (const e of r.events) Engine.scheduleDrum(t + e.t, DRUM_SOUNDS.indexOf(e.sound));
    const seg = { from: t, to: t + r.length, r };
    t += r.length + gap;
    return seg;
  });
}

export function TempoTrainer() {
  const { settings, setEar, setClick, info, on, mic, setMic } = useApp();
  const ear = settings.ear;
  const input = settings.click.input;
  const outLat = info?.outputLatency ?? 0;
  const rungIdx = Math.min(ear.rung, LADDER.length - 1);
  const rung = LADDER[rungIdx];
  const open = (i: number) => ear.openAll || i <= ear.unlocked;

  const [qi, setQi] = useState(0);
  const [score, setScore] = useState(0);
  const [q, setQ] = useState<Question>(() => rung.make(Math.random));
  const [phase, setPhase] = useState<Phase>('ready');
  const [playingIdx, setPlayingIdx] = useState(-1);
  const [grade, setGrade] = useState<(Grade & { extra?: string }) | null>(null);
  const [guess, setGuess] = useState(100);
  const [hits, setHits] = useState(0);
  const [count, setCount] = useState(0);
  const [pressed, setPressed] = useState(false);

  const R = useRef({ segs: [] as Seg_[], timers: [] as ReturnType<typeof setTimeout>[], hits: [] as number[], taps: [] as number[], press: null as number | null, q, phase });
  R.current.q = q;
  R.current.phase = phase;

  const clearTimers = () => { R.current.timers.forEach(clearTimeout); R.current.timers = []; };
  const later = (sec: number, fn: () => void) => { R.current.timers.push(setTimeout(fn, Math.max(0, sec * 1000))); };
  const silence = useCallback(() => { clearTimers(); try { Engine.cancelAfter(Engine.now()); } catch { /* restarting */ } setPlayingIdx(-1); }, []);

  const newQuestion = useCallback((idx: number) => {
    silence();
    const nq = LADDER[idx].make(Math.random);
    setQ(nq);
    setGrade(null);
    setPressed(false);
    setHits(0);
    setGuess((g) => (nq.task === 'name' ? Math.round(g / 5) * 5 : g));
    R.current.hits = []; R.current.taps = []; R.current.press = null; R.current.segs = [];
    setPhase(nq.task === 'cold' ? 'play' : 'ready');
  }, [silence]);

  const startRound = useCallback((idx: number) => {
    setEar({ rung: idx });
    setQi(0);
    setScore(0);
    newQuestion(idx);
  }, [newQuestion, setEar]);

  useEffect(() => () => silence(), [silence]);
  useEffect(() => on('restart', () => { silence(); if (R.current.phase === 'playing') setPhase('ready'); }), [on, silence]);

  const finish = useCallback((g: Grade & { extra?: string }) => {
    silence();
    setGrade(g);
    setPhase('feedback');
    if (g.ok) setScore((s) => s + 1);
  }, [silence]);

  // ---- playing the clips
  const play = () => {
    silence();
    R.current.hits = []; R.current.taps = []; R.current.press = null;
    setHits(0); setPressed(false);
    const segs = playClips(q.clips);
    R.current.segs = segs;
    const now = Engine.now();
    segs.forEach((sg, i) => later(sg.from + outLat - now, () => setPlayingIdx(i)));
    const end = segs[segs.length - 1].to + outLat - now;
    setPhase('playing');
    if (q.task === 'hold') {
      later(end - HOLD_LATE, () => { setPlayingIdx(-1); setPhase('play'); });
    } else if (q.task === 'memory') {
      later(end, () => { setPlayingIdx(-1); setPhase('countdown'); setCount(MEMORY_WAIT); });
      for (let i = 1; i <= MEMORY_WAIT; i++) later(end + i, () => (i === MEMORY_WAIT ? setPhase('play') : setCount(MEMORY_WAIT - i)));
    } else if (q.task === 'drift') {
      later(end, () => { setPlayingIdx(-1); if (R.current.press === null) finish(gradeDrift(R.current.q, segs[0].r, null, null)); });
    } else {
      later(end, () => { setPlayingIdx(-1); setPhase('answer'); });
    }
  };

  /** Replay after answering: sound only, the question stays answered. */
  const replay = () => {
    silence();
    const segs = playClips(q.clips);
    const now = Engine.now();
    segs.forEach((sg, i) => later(sg.from + outLat - now, () => setPlayingIdx(i)));
    later(segs[segs.length - 1].to + outLat - now, () => setPlayingIdx(-1));
  };

  // ---- hits for the playing tasks (tap pad, e-drum, mic), all in engine time
  const addHit = useCallback((t: number) => {
    const r = R.current;
    if (r.phase !== 'play') return;
    if (r.q.task === 'hold' && r.segs.length && t < r.segs[0].to - HOLD_LATE + outLat) return;
    r.hits.push(t);
    setHits(r.hits.length);
    if (r.hits.length >= PLAY_HITS) finish(gradePlayback(r.q, r.hits));
  }, [finish, outLat]);
  useEffect(() => {
    const offs = [
      on('pad', (e) => { if (input === 'pads') addHit(e.time); }),
      on('mic', (e) => { if (input === 'mic') addHit(e.time); }),
    ];
    return () => offs.forEach((f) => f());
  }, [on, addHit, input]);

  const touchTime = (e: GestureResponderEvent) => {
    const now = Engine.now();
    const t = Engine.uptimeToEngine(e.nativeEvent.timestamp / 1000);
    return isFinite(t) && Math.abs(t - now) < 1.5 ? t : now;
  };

  const setInput = async (v: CoachInput) => {
    setClick({ input: v });
    if (v === 'mic' && !mic) { if (!(await setMic(true))) setClick({ input: 'tap' }); }
    if (v !== 'mic' && mic) await setMic(false);
  };

  const next = () => {
    if (qi + 1 >= ROUND) {
      setPhase('done');
      const sc = score;
      setEar((e) => ({ unlocked: afterRound(e.unlocked, rungIdx, sc), best: { ...e.best, [rung.id]: Math.max(e.best[rung.id] ?? 0, sc) } }));
      return;
    }
    setQi(qi + 1);
    newQuestion(rungIdx);
  };

  const answerChoice = (i: number) => finish(gradeChoice(q, i));
  const answerName = () => {
    const tap = bpmFromHits(R.current.taps);
    const g = gradeName(q, guess);
    finish({ ...g, extra: tap ? `Your tapping said ${Math.round(tap.bpm)} BPM` : undefined });
  };
  const driftPress = (e: GestureResponderEvent) => {
    const seg = R.current.segs[0];
    if (!seg || R.current.press !== null) return;
    R.current.press = touchTime(e) - outLat - seg.from;
    setPressed(true);
  };
  const driftDir = (dir: number) => finish(gradeDrift(q, R.current.segs[0].r, R.current.press, dir));

  const listening = q.task !== 'hold' && q.task !== 'memory' && q.task !== 'cold';
  const canReplay = (q.task === 'compare' || q.task === 'anchor' || q.task === 'choose' || q.task === 'range' || q.task === 'name') && phase !== 'feedback';
  const tiers = useMemo(() => [1, 2, 3, 4].map((t) => LADDER.map((r, i) => ({ r, i })).filter((x) => x.r.tier === t)), []);

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <Card title="Ladder">
        {tiers.map((list, ti) => (
          <View key={ti} style={s.tier}>
            <Text style={s.tierName}>{TIER_NAMES[ti + 1]}</Text>
            <View style={s.rungs}>
              {list.map(({ r, i }) => {
                const isOpen = open(i), on_ = i === rungIdx, best = ear.best[r.id];
                return (
                  <Pressable key={r.id} disabled={!isOpen} onPress={() => startRound(i)} accessibilityRole="button"
                    accessibilityState={{ selected: on_, disabled: !isOpen }} style={[s.rung, on_ && s.rungOn, !isOpen && { opacity: 0.35 }]}>
                    <Text style={[s.rungTxt, on_ && { color: C.bg }]} numberOfLines={1}>{isOpen ? '' : '🔒 '}{r.name}</Text>
                    <Text style={[s.rungSub, on_ && { color: C.bg }, best !== undefined && best >= PASS && !on_ && { color: C.good }]}>
                      {best === undefined ? (isOpen ? 'new' : 'locked') : `${best >= PASS ? '✓ ' : ''}${best}/${ROUND}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </Card>

      <Card title={`${rung.name} · ${TIER_NAMES[rung.tier]}`}>
        <Note>{rung.blurb}</Note>
        {phase !== 'done' && (
          <View style={s.progress}>
            {Array.from({ length: ROUND }, (_, i) => <View key={i} style={[s.dot, i < qi && s.dotDone, i === qi && s.dotNow]} />)}
            <Text style={s.score}>{score} right</Text>
          </View>
        )}
      </Card>

      {phase === 'done' ? (
        <Card>
          <Text style={s.big}>{score}/{ROUND}</Text>
          <Text style={s.center}>{score >= PASS
            ? (rungIdx + 1 < LADDER.length ? `Passed. ${LADDER[rungIdx + 1].name} is open.` : 'Passed the whole ladder. Respect.')
            : `${PASS} right unlocks the next one. Again?`}</Text>
          <View style={s.btnRow}>
            <Btn label="Again" onPress={() => startRound(rungIdx)} style={{ flex: 1 }} />
            {rungIdx + 1 < LADDER.length && open(rungIdx + 1) && score >= PASS && <Btn label="Next exercise" onPress={() => startRound(rungIdx + 1)} style={{ flex: 1 }} />}
          </View>
        </Card>
      ) : (
        <Card>
          <Text style={s.prompt}>{q.prompt}</Text>

          {listening && q.clips.length > 0 && (
            <View style={s.clips}>
              {q.clips.map((_, i) => (
                <View key={i} style={[s.clip, playingIdx === i && s.clipOn]}>
                  <Text style={[s.clipTxt, playingIdx === i && { color: C.accentInk }]}>{q.clips.length > 1 ? (i === 0 ? 'First' : 'Second') : playingIdx === i ? 'Playing' : 'Clip'}</Text>
                </View>
              ))}
            </View>
          )}

          {(phase === 'ready' || (canReplay && phase !== 'playing')) && q.clips.length > 0 && (
            <Btn label={phase === 'ready' ? 'Listen' : 'Listen again'} onPress={play} primary={phase === 'ready'} />
          )}

          {/* answers */}
          {(q.task === 'compare' || q.task === 'anchor' || q.task === 'choose' || q.task === 'range') && phase !== 'ready' && phase !== 'feedback' && (
            <View style={s.choices}>
              {q.choices!.map((c, i) => (
                <Pressable key={c} onPress={() => answerChoice(i)} style={({ pressed: p }) => [s.choice, p && { opacity: 0.7 }]} accessibilityRole="button">
                  <Text style={s.choiceTxt}>{c}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {q.task === 'name' && phase !== 'ready' && phase !== 'feedback' && (
            <>
              <GuessDial value={guess} onChange={setGuess} />
              <View style={s.btnRow}>
                <Pressable onPressIn={(e) => { R.current.taps.push(touchTime(e)); if (R.current.taps.length > 12) R.current.taps.shift(); }}
                  style={({ pressed: p }) => [s.tapSmall, p && s.padHit]} accessibilityRole="button" accessibilityLabel="Tap along">
                  <Text style={s.tapSmallTxt}>Tap along</Text>
                </Pressable>
                <Btn label="Check" primary onPress={answerName} style={{ flex: 1 }} />
              </View>
            </>
          )}

          {q.task === 'drift' && phase === 'playing' && !pressed && (
            <Pressable onPressIn={driftPress} style={({ pressed: p }) => [s.pad, p && s.padHit]} accessibilityRole="button" accessibilityLabel="Drifting">
              <Text style={s.padTxt}>Drifting!</Text>
            </Pressable>
          )}
          {q.task === 'drift' && pressed && phase !== 'feedback' && (
            <>
              <Text style={s.center}>Which way did it go?</Text>
              <View style={s.choices}>
                {q.choices!.map((c, i) => (
                  <Pressable key={c} onPress={() => driftDir(i)} style={s.choice} accessibilityRole="button"><Text style={s.choiceTxt}>{c}</Text></Pressable>
                ))}
              </View>
            </>
          )}

          {phase === 'countdown' && <Text style={s.big}>{count}</Text>}

          {(q.task === 'hold' || q.task === 'memory' || q.task === 'cold') && phase !== 'feedback' && (
            <>
              <Row label="Play on">
                <Seg small options={[{ value: 'tap', label: 'Tap' }, { value: 'pads', label: 'E-drum' }, { value: 'mic', label: 'Mic' }]} value={input} onChange={(v) => setInput(v as CoachInput)} />
              </Row>
              {input === 'tap' ? (
                <Pressable disabled={phase !== 'play'} onPressIn={(e) => addHit(touchTime(e))} style={({ pressed: p }) => [s.pad, p && s.padHit, phase !== 'play' && { opacity: 0.4 }]}
                  accessibilityRole="button" accessibilityLabel="Tap pad">
                  <Text style={s.padTxt}>{phase === 'play' ? `${hits}/${PLAY_HITS}` : 'wait…'}</Text>
                </Pressable>
              ) : (
                <View style={[s.pad, phase !== 'play' && { opacity: 0.4 }]}><Text style={s.padTxt}>{phase === 'play' ? `Play! ${hits}/${PLAY_HITS}` : 'wait…'}</Text></View>
              )}
              {phase === 'play' && hits >= 4 && <Btn label="Done" onPress={() => finish(gradePlayback(q, R.current.hits))} />}
            </>
          )}

          {phase === 'feedback' && grade && (
            <View style={s.feedback}>
              <Pill label={grade.ok ? 'Right' : 'Not quite'} strong={grade.ok} />
              <Text style={[s.fbMain, { color: grade.ok ? C.good : C.late }]}>{grade.text}</Text>
              <Text style={s.center}>{q.reveal}</Text>
              {!!grade.extra && <Text style={s.center}>{grade.extra}</Text>}
              <View style={s.btnRow}>
                {q.clips.length > 0 && <Btn label="Hear it again" onPress={replay} style={{ flex: 1 }} />}
                <Btn label={qi + 1 >= ROUND ? 'See result' : 'Next'} primary onPress={next} style={{ flex: 1 }} />
              </View>
            </View>
          )}
        </Card>
      )}

      {rung.id === 'anchors' && (
        <Card title="Learn the anchors">
          <Note>Listen to each one a few times before you start, and try to find them in songs you know.</Note>
          <View style={s.btnRow}>
            {ANCHORS.map((a) => <Btn key={a} label={`${a}`} onPress={() => { silence(); playClips([{ bpm: a, groove: 'click', bars: 2 }]); }} style={{ flex: 1 }} />)}
          </View>
        </Card>
      )}

      <Card title="Options">
        <Toggle first label="Open all exercises" hint="for teachers, or if you already know your tempos" value={ear.openAll} onChange={(openAll) => setEar({ openAll })} />
        <Row label="Progress"><Btn label="Reset" onPress={() => { setEar({ unlocked: 0, best: {}, rung: 0 }); startRound(0); }} /></Row>
      </Card>
    </ScrollView>
  );
}

/** Large BPM readout with −/+ 1 and 5, hold to repeat. */
function GuessDial({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const v = useRef(value);
  v.current = value;
  const set = (d: number) => onChange(Math.max(40, Math.min(240, v.current + d)));
  const m5 = useHoldRepeat(() => set(-5)), m1 = useHoldRepeat(() => set(-1)), p1 = useHoldRepeat(() => set(1)), p5 = useHoldRepeat(() => set(5));
  const btn = (h: ReturnType<typeof useHoldRepeat>, label: string) => (
    <Pressable {...h} style={s.dialBtn} accessibilityRole="button" accessibilityLabel={label}><Text style={s.dialBtnTxt}>{label}</Text></Pressable>
  );
  return (
    <View style={s.dial}>
      {btn(m5, '−5')}{btn(m1, '−1')}
      <View style={s.dialVal}><Text style={s.dialNum}>{value}</Text><Text style={s.dialUnit}>BPM</Text></View>
      {btn(p1, '+1')}{btn(p5, '+5')}
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, gap: 14, paddingBottom: 32 },
  tier: { paddingVertical: 4 },
  tierName: { color: C.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 },
  rungs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  rung: { flexGrow: 1, flexBasis: '30%', minHeight: 52, borderRadius: 12, backgroundColor: C.raised, paddingHorizontal: 8, paddingVertical: 6, justifyContent: 'center' },
  rungOn: { backgroundColor: C.fg },
  rungTxt: { color: C.fg, fontSize: 13, fontWeight: '700' },
  rungSub: { color: C.muted, fontSize: 11, marginTop: 2 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.raised2 },
  dotDone: { backgroundColor: C.muted },
  dotNow: { backgroundColor: C.accent },
  score: { color: C.muted, fontSize: 13, marginLeft: 'auto' },
  prompt: { color: C.fg, fontSize: 18, fontWeight: '700', paddingVertical: 6 },
  clips: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  clip: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  clipOn: { backgroundColor: C.accent, borderColor: C.accent },
  clipTxt: { color: C.muted, fontSize: 14, fontWeight: '700' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 8 },
  choice: { flexGrow: 1, flexBasis: '40%', minHeight: 64, borderRadius: 14, backgroundColor: C.raised2, alignItems: 'center', justifyContent: 'center' },
  choiceTxt: { color: C.fg, fontSize: 22, fontWeight: '800', fontFamily: F.mono },
  pad: { minHeight: 140, borderRadius: 18, backgroundColor: C.raised, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', marginVertical: 8 },
  padHit: { backgroundColor: C.accentSoft, borderColor: C.accent },
  padTxt: { color: C.fg, fontSize: 26, fontWeight: '800', fontFamily: F.display, letterSpacing: 1 },
  tapSmall: { minHeight: 60, paddingHorizontal: 18, borderRadius: 18, backgroundColor: C.raised, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  tapSmallTxt: { color: C.fg, fontSize: 15, fontWeight: '700' },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 6 },
  feedback: { alignItems: 'center', gap: 6, paddingVertical: 6 },
  fbMain: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  center: { color: C.muted, fontSize: 14, textAlign: 'center' },
  big: { color: C.fg, fontSize: 56, fontWeight: '800', textAlign: 'center', fontFamily: F.display },
  dial: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  dialBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  dialBtnTxt: { color: C.fg, fontSize: 16, fontWeight: '700' },
  dialVal: { minWidth: 96, alignItems: 'center' },
  dialNum: { color: C.fg, fontSize: 44, fontWeight: '800', fontFamily: F.display },
  dialUnit: { color: C.muted, fontSize: 11, letterSpacing: 1.2 },
});
