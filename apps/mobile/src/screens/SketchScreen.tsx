/** Placeholder until Groove Sketch is ported (next round of roadmap step 4). */
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { C } from '../theme';
import { Card, Note } from '../ui';

export function SketchScreen() {
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={s.scroll}>
      <Text style={s.title}>Groove Sketch</Text>
      <Card title="Coming next">
        <Note>
          The notation module arrives in the next build: tap grooves into a grid, see real drum notation, play them back,
          record straight from your e-drum, and turn beatboxing into notes.
        </Note>
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, gap: 14 },
  title: { color: C.fg, fontSize: 28, fontWeight: '800' },
});
