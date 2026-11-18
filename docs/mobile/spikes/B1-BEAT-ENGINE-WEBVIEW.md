# Spike B1 — can the web beat engine run in a web view on the phone?

**Date:** 2026-11-18. **Plan:** [MUSIC-PLAN-2026-11-18.md](../MUSIC-PLAN-2026-11-18.md), Spike B1. **Decides:** the shape of phase P5 (web view shell or phone-scoped native editor).

## Status, stated plainly

- **Real-device results are NOT done.** Nothing in this report was measured on an iPhone or an Android phone. Simulator and desktop latency prove nothing about a device. The owner checklist at the end is the real test.
- **The iPhone 17 Pro simulator run is NOT done.** Blocker: that simulator is in use by another session's paid-row QA (Release build, mid-flow on the Create screen), and the installed app is a Release build with an embedded bundle, so my harness cannot reach it without replacing the app or foregrounding Safari on that simulator. Either would wreck the other session's run. The canonical checkout (`veyrnox-mobile-app-f52c2f`) is also on an older branch with uncommitted work from another session, and its `node_modules` do not match main. See "Simulator run: what is needed" below.
- What **was** measured: the real engine, bundled unmodified, running in a desktop Chromium page (the Browser pane). That proves the harness page and the engine code work; it says nothing about WebKit-on-iOS timing.

## Owner direction (2026-11-18)

The owner said the beat engine "needs to be mobile view": the phone gets a phone-shaped editor, not the desktop page shrunk into a web view. This agrees with recommendation item 4 below and points to the phone-scoped path for P5. It does not yet settle whether the audio engine is native or the web engine in a hidden audio-only web view; the device checklist answers that.

## Recommendation (a recommendation only)

**Build a phone-scoped native editor for P5; do not wrap the web editor in a web view as the main path.** Reasons, in order of weight:

1. **Background playback cannot work as built.** The app sets `enableBackgroundPlayback: false` for `expo-audio` and declares no `UIBackgroundModes: audio` (`apps/mobile/app.json`). A web view's Web Audio stops when iOS suspends the app. Even with the mode on, the web scheduler only buffers 1.5 s ahead while the page is hidden (`beatScheduler.mjs:20`), and hidden-page timers are throttled, so a live-scheduled song would run dry within seconds. The only design that survives backgrounding is playing a rendered file (the mixdown, ADR-0346) through the native player. That is a native feature either way.
2. **Takes live in the web view's storage.** ADR-0349 keeps mic takes in IndexedDB. A web view's store is per app install, can be cleared under storage pressure, and disappears on reinstall; the phone's cloud save is off in production (`beatCloud` absent). Losing a recorded take is the worst failure a music tool can have.
3. **The mic path needs three native changes anyway:** a music-specific `NSMicrophoneUsageDescription` (today's text says "voiceover in the editor"), `mediaCapturePermissionGrantType` on the web view, and on Android the `RECORD_AUDIO` runtime grant (`recordAudioAndroid` is false today). Those are native rebuilds, so the "ship it without a store release" advantage of a web shell is mostly gone for the editor's most valuable feature.
4. **The editor UI is desktop-shaped.** About 590 KB of source across `_components/music/beat` and `_lib/music/beat` (the editor entry alone is 20 KB, plus piano roll, arrangement, mixer, take lanes, shortcut sheet). It targets pointer and keyboard; a phone-sized mixer and piano roll are a redesign regardless of where the pixels are drawn.

**What a web view is still good for:** the **engine core is small and works** (see below). If P5 builds a native UI, the voice and mix code can be reused in a hidden audio-only web view for rendering, or ported. The decision between "reuse the engine in a headless web view" and "reimplement on a native audio engine" is a smaller follow-up spike, and it only matters if live (not rendered) native-quality latency is needed. The honest open question is device latency, which only the checklist can answer. If a mid-range Android or an iPhone fails the 100 ms bar, the web view path is dead for pads; if both pass comfortably, items 2 and 3 still stand.

## What the engine needs from the browser

Read from source (`app/veyrnox/_lib/music/beat/*`, `_components/music/beat/*`, `public/audio-worklets/`, ADR-0349):

| Need | Where | Web view risk |
|---|---|---|
| Web Audio: `AudioContext` / `webkitAudioContext`, oscillators, gain, biquad, wave shaper, delay, dynamics compressor, stereo panner, buffer sources | `beatEngine.js`, `beatVoices.js`, `beatMixGraph.js`, `beatEffects.js`, `beatOutput.js` | Fine on WKWebView; the engine already falls back to the prefixed constructor |
| Context starts suspended until a user gesture | `engine.resume()` | Needs a tap inside the page; a native-button start would not unlock it |
| `OfflineAudioContext` + `decodeAudioData` | `beatMixdown.js`, `beatSongAsset.js`, `beatAssets.js` | Fine; memory is the risk on a 5-minute render |
| **`AudioWorklet`** (capture) | `beatCapture.js`, `public/audio-worklets/beat-capture-worklet.js` loaded with `addModule('/audio-worklets/...')` | Needs a secure context and a same-origin URL. A page served from the real origin works; a `loadHTMLString` page needs an `https` base URL (harness does this with `https://beat-spike.invalid/`) |
| **`getUserMedia`** with echo cancellation, noise suppression and AGC off, mono | `beatCapture.js` | WKWebView supports it (iOS 14.3+) but needs the native permission string and a grant setting. Not exercised here |
| `MediaRecorder` | not used; capture is worklet PCM | None |
| **IndexedDB** (takes, 1 GB guard) | `beatStore.js`, `beatTakeStore.js`, `instrumentTakeDb.js` | Works, but see recommendation item 2 |
| `localStorage` (latency calibration, 90-day expiry) | `beatLatency.mjs` | Fine |
| Permissions Policy `microphone=(self)` on `/app/music/beats/:path*` | `next.config.mjs` (ADR-0349) | Applies only when the page is loaded from the real origin as a full navigation |
| Same-origin API with the user's session | `useBeatCloudSync.js`, `beatAi*` | The existing S1 hosted-editor handoff (`webEditorSession.ts`: access token injected by script before load, refresh token stays native) covers it. Reusable as is |
| `document.hidden` / `visibilitychange` / `pagehide` | scheduler, cloud sync | Behaviour on app background is the open question; see recommendation item 1 |

**Cost of loading standalone.** The real engine (`createBeatEngine` plus voices, mix graph, effects, wavetable, natural voices, the real capture worklet as text) bundles with esbuild to **34 KB minified in one HTML page** with no network request. The full editor is a Next route (`/app/music/beats/[id]`, client-only via `next/dynamic`, `ssr: false`) behind `MUSIC_RUNTIME_FLAGS.beatEditor`, so loading it means a signed-in session, the Cloudflare Worker, and the app's CSP. The harness uses the stripped engine entry; the full hosted page can be tried by pointing the existing S1 harness at `/app/music/beats/new` (one constant, `EDITOR_PATH` in `src/lib/editorSpike.ts`).

## What the app already has

- `react-native-webview` **14.0.1** is installed and in `Podfile.lock`: no new native module is needed to try this.
- Existing web view bridges: `TurnstileView`, `YouTubeEmbed`, `OddlingFigure/Portrait`, `LiveCameraView` (`mediaCapturePermissionGrantType="grant"`), `VisionBridge`, `Wig3dBridge`, `WobnimoView`, and the S1 hosted editor. The hosted editor is the only one that carries a session: `webEditorSession.ts` writes a seed (access token only, `refresh_token: null`) into `localStorage` through `injectedJavaScriptBeforeContentLoaded`, refuses to run off the app origin, and the harness limits navigation to that origin. That pattern authenticates the beat page too.
- Gaps for audio in a web view: `UIBackgroundModes: audio` absent; `expo-audio` `enableBackgroundPlayback` false; mic permission text names voiceover only; Android `recordAudioAndroid` false.

## The harness (dev-only, in this PR)

- Route `src/app/(app)/dev-b1-beat.tsx`, open with `ai.veyrnox.app://dev-b1-beat` on a build made with `EXPO_PUBLIC_DEV_B1_BEAT_SPIKE=1`. Without the flag a release build redirects Home.
- `scripts/build-beat-spike.mjs` bundles `scripts/beat-spike/entry.js` (imports the real `createBeatEngine`) into `src/lib/beatEngineSpikeHtml.ts`. **The committed file is an empty stub** so no release bundle carries the engine; run the script before a spike build and `git checkout` that file afterwards.
- The page has: a **web PAD** (tap inside the page), **Start 8 tracks** (the real voices: 808 drums, sub bass, lead synth, pad synth, grand piano, organ, steel guitar, electric piano, scheduled with a 250 ms look-ahead like the editor's scheduler), **Capabilities** (Web Audio, worklet, `getUserMedia`, IndexedDB, `outputLatency`, storage quota, and a load test of the real capture worklet from a blob), and **Mic probe**.
- The native header shows: track count, seconds played of 300, AudioContext state, JS heap, web-view kills, frozen-page flag, median pad latency for web taps and for a **native pad button** (tap on a native button, bridged into the page with `injectJavaScript`), background check, and a Share button that produces a text report.
- Pad latency is measured as: handler time in the page, plus audio-clock time from the hit until the first audible sample reaches a tap on the pad bus (an `AudioWorklet` probe that ignores the music), plus, for the native pad, the native-to-page bridge delay. **It does not include the speaker path.** `outputLatency` is shown when the browser reports it (Safari does not), so the device checklist adds a by-ear or loopback figure.
- Tested: `__tests__/beatEngineSpike.test.ts` (9 tests: message parsing, verdict logic, report text). `tsc` shows no errors in the new files.

## Measurements (desktop Chromium, NOT a phone, NOT WebKit)

Real engine, 8 tracks scheduled, pad pressed while the music plays. Browser pane, macOS, 48 kHz.

| Reading | Value |
|---|---|
| Engine loads and 8 tracks play with no errors | yes; 212 notes in 10 s, context `running`, 0 timer stalls |
| Pad: page handler time | 0.1 to 0.3 ms |
| Pad: audio-clock time to first sample at the bus | 0.4 ms typical (5.4 ms once); first hit after start was a spin-up outlier (-15.6 ms, an artefact of the context just starting) |
| Native-pad bridge (simulated 5 ms delay passed in) | tracked as given; real bridge cost needs a device |
| `baseLatency` / `outputLatency` | 5.3 ms / 24 ms (Chromium reports both; Safari does not report `outputLatency`) |
| JS heap | 2 to 3 MB at 10 s (grows with notes only if nodes leak; not run for 5 minutes) |
| Capabilities | Web Audio, worklet, `getUserMedia`, `MediaRecorder`, IndexedDB, OfflineAudioContext all present; real capture worklet loaded from a blob |

These numbers show the **software path is cheap**: the engine adds well under 10 ms before the platform's own output latency. On a phone the figure that decides pass or fail is the platform's output latency plus WKWebView / Android WebView audio scheduling, which is not measurable here.

## Reading against the plan's bar

| Plan bar | Result |
|---|---|
| Pad hit to sound under 100 ms | **Not tested on a device.** Software path measured at under 10 ms on desktop. Device total unknown |
| 8 tracks play 5 minutes | **Not tested for 5 minutes anywhere.** 8 tracks ran cleanly for the ~10 s tried on desktop. No web-view kill or memory reading exists yet |
| Survives backgrounding | **Expected to FAIL as the app is configured** (no background audio mode; web view suspended). Source reading, not a measurement. Needs the device check |

**Overall: inconclusive on the numbers; the recommendation rests on the structural items 1 to 3 above, which do not depend on device latency.**

## Simulator run: what is needed

Question for the owner or the QA session: **may this spike use the iPhone 17 Pro simulator?** Cheapest non-destructive path, once the QA run is idle:

1. Fill the stub: `ESBUILD_PATH=<root>/node_modules/esbuild/lib/main.js node apps/mobile/scripts/build-beat-spike.mjs`.
2. A dev-client or Release build of **this branch** with `EXPO_PUBLIC_DEV_B1_BEAT_SPIKE=1` (about 1 to 2 GB of build cache). The installed app cannot be reused: it is a Release build with an embedded bundle from an older branch. Build in the canonical environment after that checkout's other session has committed or moved on; do not build over its uncommitted work.
3. Launch, open `ai.veyrnox.app://dev-b1-beat`, tap Start, Capabilities, tap the web PAD and the NATIVE PAD ten times each, background for 30 s, return, and read the header or Share the report.

Expected on a simulator: Web Audio runs through the Mac's audio stack, so latency is not representative of any phone.

## Owner checklist: real iPhone and mid-range Android

Use one iPhone (any recent model) and one mid-range Android (for example a 2021 to 2023 phone with 4 to 6 GB RAM) on **headphones on a cable if you have them** and then **speaker**. Build with `EXPO_PUBLIC_DEV_B1_BEAT_SPIKE=1` after running the build script (steps above). Record the device model and OS version. Tick each line; paste the Share report back.

**A. Starts and sounds**
1. Open `ai.veyrnox.app://dev-b1-beat`. The page shows PAD, Start, Stop, Capabilities, Mic probe. [ ]
2. Tap **Capabilities**. Write down: `worklet`, `getUserMedia`, `indexedDB`, `captureWorklet` (must say "loaded from blob"), `outputLatency` (may say unsupported), `storageQuotaMb`. [ ]
3. Tap **Start 8 tracks**. You hear drums, bass, synths, piano, guitar. Header shows `tracks 8`, `ctx running`. [ ]

**B. Pad latency (the 100 ms bar)**
4. Tap the web **PAD** 20 times, spaced out. Read `pad web` median. Pass is under 100 ms **plus** the speaker path. [ ]
5. Tap **NATIVE PAD** 20 times. Read `pad native` median (it includes the native-to-page bridge). [ ]
6. By ear: record a screen video with the phone's mic near the speaker, or use a second phone's 240 fps slow-motion on finger and speaker, and count frames from finger down to sound. Pass is under 100 ms total. Note it with and without Bluetooth headphones (Bluetooth adds 100 to 250 ms; flag it, do not average it in). [ ]

**C. Eight tracks for five minutes**
7. Leave **Start 8 tracks** running with the screen on and the phone unplugged. At 300 s the header shows `300/300s`, `kills 0`, no `FROZEN`. Note `heap`, peak heap, any crackle or dropout you hear, and battery and heat change (percent and "warm/hot"). [ ]
8. While running, open the **Log**: look for `terminated`, `frozen`, `ctx` changes (`suspended`, `interrupted`). [ ]

**D. Backgrounding (expected to fail)**
9. Start playback. Press Home or switch apps for 30 seconds, then return. Note: did sound continue while away (yes or no and for how long)? Is the header `bg ok` or `bg FAIL`? Did it resume without a tap? [ ]
10. Lock the screen for 30 seconds with playback running. Same notes. [ ]
11. Take a phone call or play a Siri request during playback if practical; note whether sound comes back. [ ]

**E. Microphone**
12. Tap **Mic probe**. Note whether a permission prompt appears, whether it is granted, and the text in the prompt (iOS will show the voiceover wording). On Android note the runtime prompt. Repeat after force-quitting the app: does it ask again? [ ]

**F. Memory and kills**
13. Run steps 3 and 7 three times in a row without restarting the app. Note any `terminated` log line (iOS content process killed) or Android "render process gone". [ ]
14. Optional: open the full hosted editor by changing `EDITOR_PATH` in `src/lib/editorSpike.ts` to `/app/music/beats/new` and running the S1 harness: add three tracks and record a take for 30 s; note load time, any freeze, and whether the take is still there after force-quitting and reopening. [ ]

**Pass reading:** B4 and B6 under 100 ms on both phones, C7 clean on both, D9 and D10 "kept playing". Any miss on B or C ends the web view path for pads. Any "no" on D confirms recommendation item 1; D is expected to be "no" on iOS.

## Unverified

- Every WebKit and phone behaviour above. Items 1 and 2 of the recommendation are source and configuration reading, not tests.
- Whether the hosted `/app/music/beats/[id]` page loads and plays inside the web view with the injected session (code path reused from S1, not run here for beats).
- Whether iOS clears IndexedDB for an app web view under storage pressure or after a 7-day idle window; stated as a risk, not confirmed.
- Android WebView behaviour for any of the above.
