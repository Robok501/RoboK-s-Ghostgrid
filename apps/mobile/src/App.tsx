/**
 * Ghostgrid app shell: five tabs (Click · Trainer · Sketch · Songs · Settings) and a bottom tab bar.
 * Each screen draws its own title bar; there is no app-wide header.
 */
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './AppContext';
import { TempoTrainer } from './click/TempoTrainer';
import { ClickScreen } from './screens/ClickScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SketchScreen } from './screens/SketchScreen';
import { SongsScreen } from './screens/SongsScreen';
import { C } from './theme';
import { TopBar } from './ui';

type Tab = 'click' | 'trainer' | 'sketch' | 'songs' | 'settings';
const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'click', label: 'Click', glyph: '♩' },
  { id: 'trainer', label: 'Trainer', glyph: '◎' },
  { id: 'sketch', label: 'Sketch', glyph: '𝄢' },
  { id: 'songs', label: 'Songs', glyph: '♫' },
  { id: 'settings', label: 'Settings', glyph: '⚙︎' },
];

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const insets = useSafeAreaInsets();
  const { stopAll, on } = useApp();
  const [tab, setTab] = useState<Tab>('click');
  const win = useWindowDimensions();
  const compact = win.width > win.height && Math.min(win.width, win.height) < 600;
  const go = (t: Tab) => {
    // the trainer plays its own clips: stop the click first so the two don't talk over each other
    if (t === 'trainer' && tab !== 'trainer') stopAll();
    setTab(t);
  };
  const goRef = React.useRef(go);
  goRef.current = go;
  React.useEffect(() => on('goTab', (t) => goRef.current(t)), [on]);
  return (
    <View style={[s.root, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <StatusBar style="light" />
      <View style={s.body}>
        {/* Click and Songs stay mounted, so they keep playing while you look at another tab */}
        <View style={[s.page, tab !== 'click' && s.hidden]} pointerEvents={tab === 'click' ? 'auto' : 'none'}><ClickScreen /></View>
        {tab === 'trainer' && <View style={s.page}><TopBar title="Tempo trainer" /><TempoTrainer /></View>}
        {tab === 'sketch' && <View style={s.page}><SketchScreen /></View>}
        <View style={[s.page, tab !== 'songs' && s.hidden]} pointerEvents={tab === 'songs' ? 'auto' : 'none'}><SongsScreen /></View>
        {tab === 'settings' && <View style={s.page}><SettingsScreen /></View>}
      </View>
      {/* phone held sideways: a compact tab bar (icon and label side by side), like iOS does */}
      <View style={[s.tabBar, { paddingBottom: compact ? Math.max(insets.bottom, 2) : Math.max(insets.bottom, 8) }, compact && { paddingTop: 2 }]} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <Pressable key={t.id} onPress={() => go(t.id)} style={[s.tabBtn, compact && s.tabBtnCompact]} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.label}>
              <Text style={[s.glyph, on && { color: C.accent }]}>{t.glyph}</Text>
              <Text style={[s.tabLabel, on && { color: C.fg }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  body: { flex: 1 },
  page: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  hidden: { opacity: 0, zIndex: -1 },
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, backgroundColor: C.surface, paddingTop: 6 },
  tabBtn: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabBtnCompact: { minHeight: 40, flexDirection: 'row', gap: 6 },
  glyph: { color: C.muted, fontSize: 20, lineHeight: 24 },
  tabLabel: { color: C.muted, fontSize: 11, fontWeight: '600' },
});
