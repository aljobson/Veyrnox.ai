# Native phone beat editor: build plan

**Date:** 2026-11-18. **Owner direction:** the beat editor is a native mobile view ("Native Mobile view", this session). **Evidence:** [B1 report](spikes/B1-BEAT-ENGINE-WEBVIEW.md) (no device numbers yet). **Plan phase:** P5 of [MUSIC-PLAN-2026-11-18.md](MUSIC-PLAN-2026-11-18.md).

## Key idea: reuse the web engine through a native Web Audio

The web engine takes its `AudioContext` as an argument (`createBeatEngine`, `startVoice(context, ...)`, `buildMixGraph(context, ...)`) and uses only standard nodes: oscillator, gain, biquad, wave shaper, delay, dynamics compressor, stereo panner, buffer source, plus a worklet for mic capture. `react-native-audio-api` (Software Mansion, Expo config plugin, `iosBackgroundMode`, `AudioRecorder` with `inputLatency`) is a native implementation of that API. If it covers those nodes, the phone can run the **same voice and mix code natively** with native screens on top, which gives background audio, native mic permission, and file storage that survives reinstall, without a web view.

Unverified: node coverage (wave shaper, delay feedback, compressor, periodic wave, `OfflineAudioContext` for mixdown), scheduling accuracy, and whether the engine's `window.AudioContext` lookup and `document.hidden` use need a thin adapter. Slice N0 settles this.

## Slices

| Slice | Scope | Pass means |
|---|---|---|
| **N0** engine spike | Add `react-native-audio-api` (native rebuild). Adapter that gives `createBeatEngine` the native context. Dev route: 8 tracks for 5 minutes, pad hit, background with `iosBackgroundMode` | Every node the engine builds is supported; pad to sound and background survival measured on the owner's devices (B1 checklist sections B to D reused) |
| N1 phone screens | Beats home (list, new, open), transport, pads, step grid, mixer strip, per-track instrument, one-hand layout | Make and play a beat on a phone-size screen with no horizontal scroll |
| N2 save | Local save in app storage (the web document format, `beatDocument.mjs`), then cloud save where `beatCloud` is on | A beat survives force-quit and reinstall (cloud) |
| N3 record | `AudioRecorder` mic take on an armed audio track, calibration, take lanes | A take records and plays in sync; music-specific mic permission text |
| N4 render and share | Mixdown through the native offline path, then the existing mixdown upload | A rendered file plays in the library player |
| N5 later | Piano roll, arrangement, AI parts, labs (flags permitting) | Per flag |

## Decisions and gates

- **N0 is the gate.** If `react-native-audio-api` cannot run the voices or misses the latency bar on a mid-range Android or an iPhone, fall back to a small native synth for the sounds the phone needs and keep the document format.
- A new native module means a new App Store build; `UIBackgroundModes: audio` needs review notes (the app plays music the user made).
- No server change: reuses `/api/v1/music/beat-projects` and mixdown routes behind their existing flags (`beatCloud` and `beatLibrarySave` are off in production).
- Shared code stays shared: a seam like `instrumentShared.ts` over `app/veyrnox/_lib/music/beat/*`; no copy.
- Real-device testing is the owner's (B1 checklist); this plan does not claim device results.
- One ADR for "Music beat editor on the phone" (next free number after the open PRs are checked).
