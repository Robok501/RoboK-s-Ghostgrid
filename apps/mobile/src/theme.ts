import { Platform } from 'react-native';

/** Same palette as the web prototypes (dark), so the app and prototypes read as one product. */
export const C = {
  bg: '#0f1214',
  surface: '#171b1e',
  raised: '#21272b',
  fg: '#ebe8e1',
  muted: '#8e979d',
  line: '#2a3135',
  accent: '#e2ab4b',
  accentInk: '#1b1306',
  early: '#6ea9e6',
  late: '#ee7d62',
  good: '#62c48d',
};

export const F = {
  display: Platform.select({ ios: 'AvenirNextCondensed-Heavy', default: undefined }),
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }),
};
