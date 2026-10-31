# Drum app

The drummer's companion: a programmable metronome with training modes, drum notation with voice and e-drum input, realistic kits, a small DAW and stem splitting. iPhone and iPad first, Android second.

## Repository layout

| Path | What |
| --- | --- |
| `packages/core` | Platform-independent logic in TypeScript, with tests. Used by the web prototypes now and by the React Native app next. |
| `prototypes/` | The working web prototypes (Click Coach, Groove Sketch). Self-contained HTML; open in a browser or host on any HTTPS site. |
| `apps/mobile` | *Coming in step 2:* the Expo / React Native app with a native audio engine. |

## Core modules (`@drum-app/core`)

| Module | Contents |
| --- | --- |
| `meter` | Beat groupings (auto and chosen), accent levels, tempo markings, tap tempo |
| `training` | `ClickPlan`: basic, gap, drop, ramp, coach and program modes as a stream of click steps; player levels |
| `timing` | Hit offsets against the click, statistics, calibration, per-pad hit log |
| `groove` | Instruments, ideas and bars on a step grid, edits (beats, grid, bars), counting, swing timing, undo |
| `engrave` | Drum notation engraver to SVG (two voices, beams, rests, tuplets, accents, ghosts, open hi-hat) and an export document |
| `quantize` | Tempo guessing and writing timed hits into an idea |
| `voice` | Beatbox recognition: onset detection, spectral features, taught sounds (k-nearest neighbours), ghost notes and accents |
| `edrum` | MIDI pad mapping for any e-drum: General MIDI, Roland TD, learned pads, velocity to accent and ghost |
| `engine` | The `AudioEngine` interface every platform implements, and a lookahead `Scheduler` |
| `export` | MIDI file writer and reader, ZIP writer, plain-text drum tab |

Design rules for the core: pure functions and plain data, no DOM, no audio calls. Platform code (Web Audio, Web MIDI, CoreMIDI, AVAudioEngine, Oboe) implements `AudioEngine` outside the core.

## Develop

```bash
npm install
npm test          # 89 tests
npm run typecheck
```

Requires Node 20 or newer.

## Roadmap

From the architecture memo in the project:

1. **Core modules from the prototypes, with tests** ← this commit
2. iOS proof of concept: React Native shell + native engine; metronome, Bluetooth MIDI from a Roland TD-27, click kept on Bluetooth while the mic listens
3. Same proof of concept on Android, with measured latency
4. Port Click Coach and Groove Sketch to the app
5. Realistic drum kits (sampler)
6. Small DAW with latency compensation
7. On-device stem splitting

Building the iOS app without a Mac goes through Expo EAS cloud builds and needs an Apple Developer Program membership.
