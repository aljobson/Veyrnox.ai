# Native beat editor: full-parity slice list

**Date:** 2026-11-20. **Owner instruction (relayed by the coordinator):** complete the full gap between mobile and web; the phone gets the Music beat editor too. **Builds on:** [BEAT-NATIVE-PLAN-2026-11-18.md](BEAT-NATIVE-PLAN-2026-11-18.md) (N0 to N5), [N0 audit](spikes/N0-NATIVE-ENGINE.md), [B1 report](spikes/B1-BEAT-ENGINE-WEBVIEW.md). **Web reference:** `app/veyrnox/app/music/beats/**`, `app/veyrnox/_components/music/beat/*`, `app/veyrnox/_lib/music/beat/*`, ADRs 0345 to 0349.

## Where it stands

| Slice | State |
|---|---|
| B1 spike (PR 2407) | Report and web view harness. Draft |
| N0 engine (PR 2428) | `react-native-audio-api` adapter and dev route; **device gate not run**. Draft |
| N1 phone screens (PR 2467) | Home, transport, pads, step grid, mixer strip, instrument picker. Draft; `ledger` red is production migration drift, not this PR |
| TestFlight build | Blocked on the `git.a0.dev` push, then approved by the owner; build number pending |

Nothing here has run on a device. Every later slice is proven with jest and `tsc` and carries the same "no device result" line until the owner runs it.

## Rules for every slice

- Native screens only; the web engine's document and voice code is reached through seams (pattern `src/lib/instrumentShared.ts`), never copied.
- One PR per slice, draft, stacked on the previous slice. **Never merge, never enable auto-merge**; the coordinator merges.
- A beat route that answers off or unavailable shows the off state (probe by call; no new server flags). `beatCloud`, `beatLibrarySave`, `magicBar` and mixdown are off in production: build behind the server's off state.
- Paid or content-sending POSTs (Beat AI) are registered in `aiConsent.ts` and `hardPaywall.ts`, tested through the real guard, and show the price before spend (`generation-quotes` first).
- UI work reports the `docs/design-goal-criteria.md` lines as checked, not applicable or not checked. Strings go through `t()`; keys in en and the parity suites.
- iOS builds are local Xcode, no EAS; heavy steps through `~/.local/bin/with-build-slot` with `-jobs 2`. Do not touch the iPhone 17 Pro simulator without the owner.
- Native additions (the audio library, microphone) are stated in the PR: expected disk cost, permission text, App Review impact.

## Remaining slices against the web editor

| # | Slice | Web source | Notes and gaps carried from N0 |
|---|---|---|---|
| N2 | **Save and versions.** Local save of the beat document; versions panel; cloud save and conflict dialog behind `beatCloud` (off state first) | `useBeatProject`, `useBeatCloudSync`, `BeatCloudConflictDialog`, `BeatVersionsPanel`, `BeatLibrary*`, ADR-0345 | Document format is the web one (`beatDocument.mjs`); survives force-quit; cloud shows off state when the route says so |
| N3 | **Arrangement and regions.** Song view, regions on tracks, drag and trim with touch, ruler, cycle, region inspector and actions | `BeatArrangement`, `BeatRegion*`, `BeatRuler`, `useRegionDrag`, `beatOps` | Touch drag with a hold-to-move model, not hover |
| N4 | **Piano roll and keyboard.** Note edit, velocity, quantize, MIDI preview, on-screen keyboard; instrument library | `BeatPianoRoll`, `BeatPianoToolbar`, `BeatKeyboard`, `BeatInstrumentLibrary`, `BeatMidiPreview` | Phone-sized roll (scroll and pinch zoom); piano keys use the N0 voices |
| N5 | **Mixer, effects, automation.** Channel strips, master strip, send buses, effect rack, automation lanes, meters | `BeatMixer`, `BeatChannelStrip`, `BeatMasterStrip`, `BeatEffectRack`, `BeatAutomationLane`, `BeatMeter` | **G1:** no native compressor, so the master dynamics are a stand-in. **G2:** the distortion effect's Drive cannot change after creation: fix on the web side (new shaper per change, or include drive in the strip signature) before exposing Drive |
| N6 | **Microphone takes.** Arm an audio track, record, calibration, take lanes and waveforms, recovery of an unsaved take | `useBeatAudioRecording`, `BeatRecordPanel`, `BeatTakeLanes`, `BeatTakeWaveform`, `BeatLatencyCalibration`, ADR-0349 | **G3:** no `AudioWorklet`, so `AudioRecorder` from `react-native-audio-api`. Native mic permission and `UIBackgroundModes` stated in the PR; takes in app storage (not web IndexedDB) so they survive reinstall only with cloud |
| N7 | **Export and mixdown.** Render to WAV, share, and the mixdown to a private song | `BeatExportDialog`, `beatMixdown`, `beatMixdownSave`, `beatWav`, ADR-0346 | Needs the library's `OfflineAudioContext` (unverified; N0 flagged it); mixdown flag off in production, so the off state first |
| N8 | **Beat AI parts.** Generate, stems, target stems, extend, replace; Magic Bar | `BeatAiActionSheet`, `BeatGenerateSheet`, `BeatMagicBar`, `useBeatAiRequest`, ADR-0347 | **Quote first, paid.** Registered in `aiConsent.ts` and `hardPaywall.ts`, price before spend, one charge on replay (idempotency key). `beatAi` pending owner price decision on the web, so build behind the off state |
| N9 | **Labs, sounds and song seed.** Labs instruments that belong to the editor, sound packs, template picker, song seed, coach marks, shortcut sheet equivalents | `BeatTemplatePicker`, `BeatSongSeed`, `BeatCoachMarks`, `labs.mjs`, `beatSounds` | Only what the editor itself uses; standalone Labs is Music P5 |

## Order and gates

1. Get PRs 2407, 2428 and 2467 green and out of draft (rebase or merge main; the `ledger` red on 2467 is production migration drift unrelated to it; `pr gate` red is out of API credit and not required).
2. N2 first (a beat that is never lost), then N3, N4, N5 and N6 in that order; N7 after N5 and N6; N8 and N9 last.
3. The N0 device gate decides the audio backend before N6 and N7 are called done. If the library fails the latency or glitch bar, swap the audio interface implementation to a small native synth; the screens and documents do not change.
4. Each slice is built by a claudex loop session (Codex reviews the plan and builds with `--model gpt-6-astra --effort high`, a fresh Claude inspects), one PR each.
