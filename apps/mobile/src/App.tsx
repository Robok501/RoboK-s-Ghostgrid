/** Ghostgrid app shell: header, three tabs (Click · Sketch · Kit & settings) and a bottom tab bar. */
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppProvider } from './AppContext';
import { ClickScreen } from './screens/ClickScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SketchScreen } from './screens/SketchScreen';
import { C, F } from './theme';

type Tab = 'click' | 'sketch' | 'kit';
const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'click', label: 'Click', glyph: '♩' },
  { id: 'sketch', label: 'Sketch', glyph: '𝄢' },
  { id: 'kit', label: 'Kit & settings', glyph: '⚙︎' },
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
  const [tab, setTab] = useState<Tab>('click');
  return (
    <View style={[s.root, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <StatusBar style="light" />
      <View style={s.header}>
        <Text style={s.brand}>GHOSTGRID</Text>
        <Text style={s.tag}>{TABS.find((t) => t.id === tab)!.label}</Text>
      </View>
      <View style={s.body}>
        {/* keep Click mounted so the click keeps running while you look at other tabs */}
        <View style={[s.page, tab !== 'click' && s.hidden]} pointerEvents={tab === 'click' ? 'auto' : 'none'}><ClickScreen /></View>
        {tab === 'sketch' && <View style={s.page}><SketchScreen /></View>}
        {tab === 'kit' && <View style={s.page}><SettingsScreen /></View>}
      </View>
      <View style={[s.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={s.tabBtn} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.label}>
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
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 16, minHeight: 44, paddingTop: 6 },
  brand: { color: C.fg, fontSize: 22, fontWeight: '800', letterSpacing: 1.5, fontFamily: F.display },
  tag: { color: C.muted, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  body: { flex: 1 },
  page: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  hidden: { opacity: 0, zIndex: -1 },
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, backgroundColor: C.surface, paddingTop: 6 },
  tabBtn: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', gap: 2 },
  glyph: { color: C.muted, fontSize: 20, lineHeight: 24 },
  tabLabel: { color: C.muted, fontSize: 11, fontWeight: '600' },
});
