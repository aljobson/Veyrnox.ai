# Slice N0 — can the web beat engine run on `react-native-audio-api`?

**Date:** 2026-11-18. **Plan:** [BEAT-NATIVE-PLAN-2026-11-18.md](../BEAT-NATIVE-PLAN-2026-11-18.md), slice N0. **Predecessor:** [B1 report](B1-BEAT-ENGINE-WEBVIEW.md).

## Status, stated plainly

- **Done (proved with Jest and `tsc` only):** the audit below, the adapter, the dev route, the Expo plugin config, 14 tests.
- **Not done:** no native build, no install of the library, no simulator, no device. **No real-device result exists.** Nothing here says the gate is passed or failed on a phone.
- The library was audited from its published docs (`react-native-audio-api` 1.0.1, the `main` docs, 2026-11-18), not from running it. Where a doc line and the real behaviour differ, the device run settles it.

## Recommendation (on paper)

**Proceed to the device run; do not call the gate passed.** Of the node kinds the engine builds, the library implements all but one, and the one it lacks (compressor) has a working stand-in that changes the sound, not whether it plays. Two library deviations (connect return value, wave shaper curve set-once) are handled or pinned. That is enough to justify one native build for the owner's checklist. The fall-back in the plan (a small native synth, same document format) stays the plan if the pad estimate is over 100 ms, the eight tracks glitch, or the missing limiter makes the mix unusable.

## What the engine needs, against the library

Read from `beatEngine.js`, `beatVoices.js`, `beatMixGraph.js`, `beatEffects.js`, `beatOutput.js`, `beatNaturalVoices.js`, `beatWavetable.js`, `instrumentEngine.js` (the factory calls it makes, counted by grep), against the library's Web Audio coverage page.

| Engine use | Where | Library 1.0.1 | Verdict |
|---|---|---|---|
| `createGain`, `createOscillator`, `createBiquadFilter` (lowpass, lowshelf, peaking, highshelf) | everywhere | implemented | OK |
| `createBufferSource`, `createBuffer`, `getChannelData` (noise, reverb impulse) | `instrumentEngine.js`, `beatEffects.js` | implemented | OK |
| `createDelay(0.1)` with feedback loop | guitar string, delay effect | implemented; DelayNode has tail time | OK, listen for loop stability |
| `createConvolver` + `buffer` (room reverb) | `beatEffects.js` | implemented; buffer must be 1, 2 or 4 channels at the **context's** sample rate | OK: the engine already resamples the impulse to `context.sampleRate` |
| `createStereoPanner` | `beatOutput.js`, strips | implemented | OK |
| `createPeriodicWave(real, imag)` + `setPeriodicWave` | wavetable voice | implemented, same signature | OK |
| `createWaveShaper` + `oversample = '2x'` | guitar drive, distortion effect | implemented | OK for one `curve` set (see G2) |
| `setTargetAtTime`, `cancelScheduledValues`, `cancelAndHoldAtTime`, `exponentialRampToValueAtTime`, `linearRampToValueAtTime`, `setValueAtTime` | envelopes, strips | all documented on `AudioParam` | OK; `cancelAndHoldAtTime` exists, so the web fallback branch is not needed |
| `source.onended = fn` | voice clean-up sentinel | documented (assigning returns a subscription; `null` removes) | OK |
| `node.disconnect()` (no argument) | clean-up | documented: disconnects all outputs | OK |
| `context.resume()`, `close()`, `currentTime`, `sampleRate`, `state`, `destination` | engine | documented | OK |
| `OfflineAudioContext` (+ `startRendering`) | `instrumentEngine.js:171` (mixdown), N4 | implemented (WPT coverage about 51%) | OK for N0 (not used live); **verify in N4** |
| `AudioContext` constructor lookup `window.AudioContext` | `beatEngine.js:8` | n/a | **Adapter** (see below) |
| `createDynamicsCompressor` | `beatOutput.js` (master), `beatMixGraph.js` (limiter), `beatEffects.js` (compressor fx) | **not implemented** (`DynamicsCompressorNode` is marked unsupported) | **G1** |
| `a.connect(b).connect(c)` chaining | all voices, `beatOutput.js` | docs: `connect` "Returns `undefined`" | **G0** |
| `AudioWorklet` (mic capture) | `beatCapture.js`, N3 only | not implemented | **G3**, N3 |

Scheduling: the web scheduler is clock based (`context.currentTime`, 150 ms look-ahead, 25 ms JS timer) and runs on the JS thread of the app, not a web view. That is the same design as the web page. The library exposes `baseLatency` and `outputLatency` on `AudioContext`; the dev route adds both to the JS time to estimate pad-to-sound. It is an estimate, not a speaker loopback. Whether a busy JS thread (8 tracks, React renders) delays `setTimeout` enough to starve the 150 ms window is a device question; the route counts timer gaps over 250 ms as `stalls`.

## Gaps

| # | Gap | Handling in this PR | Risk left |
|---|---|---|---|
| **G0** | `connect()` returns nothing in the library docs; the engine chains on the return value | `chainable()` patches each node the context makes so `connect` returns its destination (a spec-conforming result passes through). Test with a mock whose `connect` returns `undefined` | If the library's node objects are frozen or native host objects that refuse a patched property, the first voice throws. First thing the device run shows |
| **G1** | No `DynamicsCompressorNode`: the master output, the optional master limiter and the track compressor effect are dynamics processors | `passThroughCompressor()`: a real `GainNode` carrying inert `threshold/knee/ratio/attack/release` objects, so the engine's writes do not throw. **It does not compress.** Reported as `dynamicsCompressor` in `report.gaps` | Eight loud tracks can clip: the master gain stays 0.8 with nothing behind it. Listen on the device. Real fixes: upstream adds the node, a small native module, or a WaveShaper soft limiter (needs a connect-aware wrapper) |
| **G2** | `WaveShaperNode.curve` can be set **once**; `beatEffects.js` sets it again when `drive` changes | Not handled (a web change is needed: build a new shaper, or include drive in `stripSignature`). Pinned by a test that expects the throw. Voices (guitar drive) set the curve once, so they are fine | The track **distortion effect** breaks when its Drive control moves. N1 must not expose that control until fixed |
| **G3** | No `AudioWorklet` | Not in N0. N3 uses `AudioRecorder` (the plan already says so) | None for N0 |
| **G4** | `window.AudioContext` is read inside `createBeatEngine()` | `withWindowAudioContext()` answers it for the length of that one call, then restores the previous value (also when it throws). No web file is edited. A later one-line web change (`createBeatEngine({ context })`) would remove the trick | Low. The engine reads it once, at creation |
| **G5** | Heap on Hermes | `HermesInternal.getInstrumentedStats()` (`js_heapSize`, else `js_allocatedBytes`); shows `n/a` if absent | The field names are from memory of Hermes, not verified; native memory used by the audio engine is not included |

Also noted, not gaps: the library needs Node 22 or newer to install (`engines`; CI already uses 22) and lists `react` and `react-native` as `*` peers, so **Expo 58 / React Native 0.88.1 compatibility is unverified** until the first prebuild.

## What this PR adds

| File | Role |
|---|---|
| `apps/mobile/src/lib/beatNative/shared.ts` | Typed seam over `app/veyrnox/_lib/music/beat/beatEngine.js` (pattern: `instrumentShared.ts`). No web code copied |
| `apps/mobile/src/lib/beatNative/nativeContext.ts` | The adapter: wrapper over the native context (G0, G1), the `window.AudioContext` hand-off (G4), lazy `require('react-native-audio-api')` |
| `apps/mobile/src/lib/beatNative/session.ts` | Eight-track loop on the shared engine (drum kits, bass, piano, guitar, synth, wavetable), pad hit with latency estimate, stats, Hermes heap |
| `apps/mobile/src/components/dev/NativeBeatEngineHarness.tsx`, `src/app/(app)/dev-n0-beat.tsx` | Dev-only route `ai.veyrnox.app://dev-n0-beat`, off unless `EXPO_PUBLIC_DEV_N0_BEAT_SPIKE=1`; Start 8 tracks, Pad, readout of tracks, seconds, context state, stalls, heap, pad estimate, and app-state changes |
| `apps/mobile/package.json`, `package-lock.json` | `react-native-audio-api` pinned to `1.0.1` (lockfile updated with `--package-lock-only`; nothing installed) |
| `apps/mobile/app.json` | Plugin `react-native-audio-api`: `iosBackgroundMode: true` (adds `UIBackgroundModes: audio`), mic text, Android media-playback foreground service, **no** `RECORD_AUDIO` (recording is N3; the app still blocks it) |
| `apps/mobile/__tests__/beatNativeAdapter.test.ts`, `__tests__/helpers/mockNativeAudio.ts`, `appConfig.test.ts`, `visibleStrings.test.ts` | 14 adapter tests plus the config pin and the dev-route exemption |

**Mic wording.** `expo-image-picker`, `expo-audio` and this plugin all write `NSMicrophoneUsageDescription`; the last plugin wins, so this one is last and its text names both uses ("a voiceover in the editor or a take in the beat maker"). A test pins the order. Owner call: App Review reads this string.

**Not changed:** `apps/mobile/src/lib/music/*` (the P0 to P2 client), any web file, any server or migration.

## What the tests prove

The mock context implements exactly the node kinds the docs list as supported and nothing else (no compressor; `connect` returns nothing; the wave shaper curve is settable once). Driving the **real** web `createBeatEngine`, `startVoice`, drum, piano, bass, guitar, synth and wavetable voices through it for two bars:

- every node kind the engine asked for is in the supported set;
- `oscillator`, `gain`, `biquad`, `bufferSource`, `waveShaper`, `delay`, `periodicWave`, `stereoPanner` were all exercised;
- gated voices get a release (no note held forever); pad estimate, heap, context state and stats are read;
- `window.AudioContext` is restored after creation.

This proves the adapter and the audit's reading of the code. It does not prove the library behaves as its docs say, or that anything is audible.

## Owner steps: device and simulator (not run; need your word)

**Do not use the iPhone 17 Pro simulator** while the paid QA is running. A native build is required (new native module); `UIBackgroundModes` changes the app's capabilities, so use a development client or a TestFlight-style build, not Expo Go.

1. Use the canonical mobile environment (`/Users/aljobson/Documents/GitHub/Veyrnox.ai/.claude/worktrees/veyrnox-mobile-app-f52c2f/apps/mobile`, path confirmed to exist) or an ordinary owner checkout; check this branch out there after the PR merges or by branch. Run `~/.local/bin/storage-install-preflight` first. Expected cost of a native iOS build: several GB of Pods and DerivedData (an estimate, not measured); clean the generated caches afterwards.
2. `npm ci` (the lockfile now lists the library), then build with `EXPO_PUBLIC_DEV_N0_BEAT_SPIKE=1` on a physical iPhone and a mid-range Android (EAS development profile or local `expo run:ios --device`).
3. Open `ai.veyrnox.app://dev-n0-beat`. Reuse B1 checklist sections A to D (replace "web PAD" with **Pad**; there is no native-pad bridge):
   - A: **Start 8 tracks**: drums, bass, keys, guitar, lead and pad should sound; the header shows `tracks 8`, `ctx running`. Any red error in the Log, especially on the first note, is G0 or an unsupported call: copy it.
   - B: tap **Pad** 20 times; note latest and worst estimate (pass line 100 ms) **and** a by-ear or slow-motion figure, because the on-screen number leaves out the speaker path.
   - C: five minutes, screen on: `300/300s`, `stalls` stays 0, note heap, crackle, heat. Listen for clipping on the loud bars (G1).
   - D: Home for 30 s, lock for 30 s, then return. Does the sound continue (it should now, with the audio background mode)? Does the header's `audio` time keep advancing?
4. Optional on a build with the library: add one track with the **Distortion** effect in a scratch test to confirm G2 (not reachable from this route).
5. Report: pass, or the failing line. Then the plan's decision applies: fall back to a small native synth if latency, glitches or the missing limiter fail.

## Unverified (read before relying on this)

Everything about the library's behaviour (G0's patch, G1's stand-in, onended timing, scheduling accuracy under a busy JS thread, convolver and delay-feedback stability, the Expo 58 / RN 0.88.1 build) comes from its documentation. ESLint could not run in this checkout (its install is another checkout's older `node_modules`); `tsc` reports no error in the new files (the 21 existing errors come from that older install).
