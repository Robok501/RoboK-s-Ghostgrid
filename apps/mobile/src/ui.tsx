/** Small design system shared by all screens. Every control is at least 44 pt (Apple HIG). */
import React, { useRef } from 'react';
import { PanResponder, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { C, F, HIT } from './theme';

export function Card({ title, children, style }: { title?: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[u.card, style]}>
      {!!title && <Text style={u.cardTitle}>{title.toUpperCase()}</Text>}
      {children}
    </View>
  );
}

export function Row({ label, hint, children, first }: { label: string; hint?: string; children?: React.ReactNode; first?: boolean }) {
  return (
    <View style={[u.row, !first && u.rowLine]}>
      <View style={u.rowText}>
        <Text style={u.rowLabel}>{label}</Text>
        {!!hint && <Text style={u.hint}>{hint}</Text>}
      </View>
      {children}
    </View>
  );
}

export function Value({ children, good }: { children: React.ReactNode; good?: boolean }) {
  return <Text style={[u.value, good && { color: C.good }]}>{children}</Text>;
}

export function Toggle({ label, hint, value, onChange, first }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; first?: boolean }) {
  return (
    <Row label={label} hint={hint} first={first}>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: C.accent, false: C.line }} accessibilityLabel={label} />
    </Row>
  );
}

/** Runs `fn` once on press and repeats while held. */
export function useHoldRepeat(fn: () => void) {
  const t1 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t2 = useRef<ReturnType<typeof setInterval> | null>(null);
  const f = useRef(fn);
  f.current = fn;
  const stop = () => { if (t1.current) clearTimeout(t1.current); if (t2.current) clearInterval(t2.current); t1.current = null; t2.current = null; };
  const start = () => { f.current(); stop(); t1.current = setTimeout(() => { t2.current = setInterval(() => f.current(), 70); }, 420); };
  return { onPressIn: start, onPressOut: stop };
}

export function Stepper({ value, onChange, min, max, step = 1, format }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => string;
}) {
  const v = useRef(value);
  v.current = value;
  const set = (d: number) => onChange(Math.max(min, Math.min(max, v.current + d)));
  const dn = useHoldRepeat(() => set(-step));
  const up = useHoldRepeat(() => set(step));
  // swipe the number left or right too (one step per 12 points); up and down stays scrolling
  const live = useRef({ set, step, min, max, onChange });
  live.current = { set, step, min, max, onChange };
  const start = useRef(value);
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderGrant: () => { start.current = v.current; },
    onPanResponderMove: (_, g) => {
      const L = live.current, nv = Math.max(L.min, Math.min(L.max, start.current + Math.round(g.dx / 12) * L.step));
      if (nv !== v.current) L.onChange(nv);
    },
    onPanResponderTerminationRequest: () => false,
  })).current;
  return (
    <View style={u.stepper}>
      <Pressable {...dn} style={u.stepBtn} accessibilityRole="button" accessibilityLabel="Decrease"><Text style={u.stepTxt}>−</Text></Pressable>
      <View {...pan.panHandlers} style={u.stepValBox}><Text style={u.stepVal}>{format ? format(value) : value}</Text></View>
      <Pressable {...up} style={u.stepBtn} accessibilityRole="button" accessibilityLabel="Increase"><Text style={u.stepTxt}>+</Text></Pressable>
    </View>
  );
}

export function Seg<T extends string | number>({ options, value, onChange, small, wide }: {
  options: { value: T; label: string; disabled?: boolean }[]; value: T; onChange: (v: T) => void; small?: boolean; wide?: boolean;
}) {
  return (
    <View style={[u.seg, wide && { flexShrink: 0 }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={String(o.value)} disabled={o.disabled} onPress={() => onChange(o.value)} accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: o.disabled }} style={[u.segBtn, small && u.segSmall, wide && { flex: 1 }, on && u.segOn, o.disabled && { opacity: 0.35 }]}>
            <Text style={[u.segTxt, on && u.segTxtOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Btn({ label, onPress, primary, active, disabled, style }: {
  label: string; onPress: () => void; primary?: boolean; active?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [u.btn, primary && u.primary, active && u.active, disabled && { opacity: 0.4 }, pressed && { opacity: 0.75 }, style]}>
      <Text style={[u.btnTxt, primary && u.primaryTxt, active && u.activeTxt]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress, onRemove }: { label: string; on?: boolean; onPress: () => void; onRemove?: () => void }) {
  return (
    <View style={[u.chip, on && u.chipOn]}>
      <Pressable onPress={onPress} style={u.chipMain} accessibilityRole="button" accessibilityLabel={label}>
        <Text style={[u.chipTxt, on && u.chipTxtOn]}>{label}</Text>
      </Pressable>
      {onRemove && (
        <Pressable onPress={onRemove} style={u.chipX} accessibilityRole="button" accessibilityLabel={`Remove ${label}`}>
          <Text style={u.chipXTxt}>×</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Pill({ label, strong }: { label: string; strong?: boolean }) {
  return <View style={[u.pill, strong && u.pillStrong]}><Text style={[u.pillTxt, strong && u.pillTxtStrong]}>{label.toUpperCase()}</Text></View>;
}

export const Note = ({ children }: { children: React.ReactNode }) => <Text style={u.note}>{children}</Text>;

export const u: Record<string, any> = StyleSheet.create({
  card: { backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  cardTitle: { color: C.muted, fontSize: 12, fontWeight: '600', letterSpacing: 1.6, marginTop: 4, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, gap: 12 },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  rowText: { flexShrink: 1 },
  rowLabel: { color: C.fg, fontSize: 15, fontWeight: '500' },
  hint: { color: C.muted, fontSize: 12, marginTop: 1 },
  value: { color: C.fg, fontSize: 15, fontFamily: F.mono },
  note: { color: C.muted, fontSize: 14, lineHeight: 20 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: { width: HIT, height: HIT, borderRadius: 10, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { color: C.fg, fontSize: 22 },
  stepValBox: { minHeight: 44, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  stepVal: { minWidth: 58, textAlign: 'center', color: C.fg, fontSize: 16, fontWeight: '600', fontFamily: F.mono },
  seg: { flexDirection: 'row', backgroundColor: C.raised, borderRadius: 12, padding: 3, gap: 2, flexShrink: 1 },
  segBtn: { minHeight: 40, minWidth: HIT, paddingHorizontal: 10, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segSmall: { paddingHorizontal: 8 },
  segOn: { backgroundColor: C.surface },
  segTxt: { color: C.muted, fontSize: 14, fontWeight: '600' },
  segTxtOn: { color: C.fg },
  btn: { minHeight: HIT, paddingHorizontal: 16, borderRadius: 12, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  btnTxt: { color: C.fg, fontSize: 15, fontWeight: '600' },
  primary: { backgroundColor: C.accent, minHeight: 60, borderRadius: 18 },
  primaryTxt: { color: C.accentInk, fontSize: 24, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', fontFamily: F.display },
  active: { backgroundColor: C.fg },
  activeTxt: { color: C.bg },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.raised, borderRadius: 10 },
  chipOn: { backgroundColor: C.fg },
  chipMain: { minHeight: HIT, paddingHorizontal: 12, justifyContent: 'center' },
  chipTxt: { color: C.fg, fontSize: 14, fontWeight: '500' },
  chipTxtOn: { color: C.bg },
  chipX: { width: 36, minHeight: HIT, alignItems: 'center', justifyContent: 'center' },
  chipXTxt: { color: C.muted, fontSize: 18 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: C.raised },
  pillStrong: { backgroundColor: C.accent },
  pillTxt: { color: C.fg, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  pillTxtStrong: { color: C.accentInk },
});

/** Screen title bar: title (and optional subtitle) on the left, actions on the right. Replaces the app-wide header. */
export function TopBar({ title, sub, onTitle, right, compact }: { title: string; sub?: string; onTitle?: () => void; right?: React.ReactNode; compact?: boolean }) {
  const t = (
    <View style={{ flexShrink: 1 }}>
      <Text style={[u.topTitle, compact && { fontSize: 18 }]} numberOfLines={1}>{title}{onTitle ? <Text style={u.topChevron}> ▾</Text> : null}</Text>
      {!!sub && <Text style={u.topSub} numberOfLines={1}>{sub}</Text>}
    </View>
  );
  return (
    <View style={[u.topBar, compact && { minHeight: 44, paddingTop: 0 }]}>
      {onTitle ? <Pressable onPress={onTitle} style={u.topTitleBtn} accessibilityRole="button" accessibilityLabel={`${title}, change`}>{t}</Pressable> : <View style={u.topTitleBtn}>{t}</View>}
      <View style={u.topRight}>{right}</View>
    </View>
  );
}

/** A page sheet with a title and Done: for settings that belong to the current screen. */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={u.sheet}>
        <View style={u.sheetHead}>
          <Text style={u.sheetTitle}>{title}</Text>
          <Btn label="Done" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={u.sheetBody} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </Modal>
  );
}

/** A tappable row that opens something (a sheet or a sub-page): label, current value, chevron. */
export function NavRow({ label, value, hint, onPress, first }: { label: string; value?: string; hint?: string; onPress: () => void; first?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}${value ? `, ${value}` : ''}`}
      style={({ pressed }) => [u.row, !first && u.rowLine, pressed && { opacity: 0.6 }]}>
      <View style={u.rowText}>
        <Text style={u.rowLabel}>{label}</Text>
        {!!hint && <Text style={u.hint}>{hint}</Text>}
      </View>
      <Text style={u.navValue} numberOfLines={1}>{value ? `${value}  ` : ''}<Text style={u.chev}>›</Text></Text>
    </Pressable>
  );
}

/** Plain section title (instead of a bordered card) for grouping on a screen. */
export const SectionTitle = ({ children }: { children: string }) => <Text style={u.section}>{children.toUpperCase()}</Text>;

Object.assign(u, StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, minHeight: 52, paddingTop: 4 },
  topTitleBtn: { flex: 1, minHeight: 44, justifyContent: 'center' },
  topTitle: { color: C.fg, fontSize: 26, fontWeight: '800', fontFamily: F.display, letterSpacing: 0.5 },
  topChevron: { color: C.muted, fontSize: 18 },
  topSub: { color: C.muted, fontSize: 12, marginTop: -2 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheet: { flex: 1, backgroundColor: C.bg },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  sheetTitle: { color: C.fg, fontSize: 22, fontWeight: '800' },
  sheetBody: { padding: 16, paddingTop: 0, gap: 14, paddingBottom: 40 },
  navValue: { color: C.muted, fontSize: 15, flexShrink: 1, textAlign: 'right' },
  chev: { color: C.muted, fontSize: 22 },
  section: { color: C.muted, fontSize: 12, fontWeight: '600', letterSpacing: 1.6, marginTop: 8, marginBottom: 2 },
}));
