# Spike S1: the web editor in a web view on a real iPhone

**Status:** harness built, **never run on a device**. Nothing here has been seen working on a phone.
**Decides:** option C (native shell + web editor engine in a web view) or option B (native timeline + server render). See [PARITY-2026-10-19.md](../PARITY-2026-10-19.md) section 2 and S1 in section 7.
**Time:** about 45 minutes once the app is installed. About 15 minutes for a first look.

## What the engine needs from its host (read from the code)

| Need | Where it comes from | Risk on iPhone |
|------|---------------------|----------------|
| WebCodecs `VideoEncoder` / `VideoDecoder` | `exportBlocker()` in `app/veyrnox/_lib/editorExport.mjs` refuses export if `VideoEncoder` is missing | iOS web views have WebCodecs only on recent iOS. The harness logs `webcodecs=true/false` on load |
| H.264 encode through the WebKit path | `usesWebKit()` matches `AppleWebKit` without `Chrome`, so a `WKWebView` takes the Safari path in `editorSafariEncoder.mjs` (flushes a frame at a time, 15 s timeout per frame) | Untested inside a `WKWebView`; only tested in Safari |
| `OfflineAudioContext`, AAC encode | audio is mixed offline and added a second at a time | Same |
| Memory | `exportMemoryProblem()` refuses an edit it estimates over 1 GB; decoder buffers are `width*height*4*5` bytes per active clip | **The main risk.** A web view content process is killed under memory pressure with no warning to the page. `onContentProcessDidTerminate` is the only signal |
| File input for import | The media bin's import is an `<input type="file">`; iOS shows its photo picker | Large videos are copied into the web process |
| Session | Bearer token in the page's auth client (`app/lib/authClient.js`) | See "Session handoff" below |
| Timeline limit | `LIMITS.maxSeconds = 60` in `editorTimeline.mjs` | A 60 s timeline is the editor's maximum, so the pass test uses exactly the maximum |
| Export sizes | 720 or 1080 high (`EXPORT_HEIGHTS`), 30 fps | |

Real time means export wall time divided by the timeline length. The pass line is 3x or less.

## What was built

- Route `ai.veyrnox.app://dev-s1-editor` (file `src/app/(app)/dev-s1-editor.tsx`). Nothing links to it. It shows "Spike S1 is off" unless the build was made with `EXPO_PUBLIC_DEV_S1_EDITOR_SPIKE=1`.
- Screen `src/components/dev/EditorSpikeHarness.tsx`: a `WebView` on `{apiBase}/app/editor` with a bar on top (status line, timeline seconds box, Reload, Log, Share).
- Pure logic and the page instrumentation in `src/lib/editorSpike.ts`, tested in `__tests__/editorSpike.test.ts`.
- No server change, no flag, no migration, no dependency change (`react-native-webview` 14.0.1 and `expo-device` were already in `package.json`).

**Session handoff.** The harness fetches a fresh access token, refuses to start with under 20 minutes left, and writes a session record into the page's `localStorage` by injected script, only when `location.origin` equals the API origin. It carries the access token and no refresh token (the web client treats that as a live session until the token expires: `getFreshAccessToken` in `authClient.js`). The refresh token never leaves the app, so Supabase's rotation cannot sign the app out. No token is in any URL. Navigation off the API origin is blocked. A token lasts about an hour, so a run that spans the expiry needs Reload. This is a spike shortcut, not the production design; if S1 passes, the real bridge (for example a one-time code exchanged for the cookie session) needs its own ADR.

**What the page reports** (injected after load; it reads, never clicks): a heartbeat each second, file picks (count, bytes, MIME type; never names), export start and end (a `<progress>` element appearing and disappearing), the finished video's size (a `video/*` blob created), page errors, and the JS heap size if the web view exposes it (WebKit usually does not, so expect "not reported").

**What the app reports:** `onContentProcessDidTerminate` (iOS) and `onRenderProcessGone` (Android) as `terminated` and the web view reloads; app background and foreground; a `frozen` mark when the heartbeat stops for 8 s while the app is in front.

## Before you start (once)

1. Use a staging account that is signed in on the phone's Veyrnox.ai app. Staging has `EDITOR_TIMELINE_ENABLED` and `EDITOR_MULTITRACK_ENABLED` on in `wrangler.jsonc`.
2. Pick **two clips from your photo library**: a 1080p phone video of 30 s or more, and a second one of 30 s or more. Together they must reach 60 s. HEVC (the iPhone default) is a good test, since the editor must decode it. Note their lengths.
3. Build the app onto the phone. Environment variables only reach the bundle if they are set where the bundle is built, so a cloud EAS build does **not** see your shell. Use the local build, in the one checkout that has the native environment (`.claude/worktrees/veyrnox-mobile-app-f52c2f/apps/mobile`), after checking out this PR's branch there:

   ```bash
   EXPO_PUBLIC_APP_ENV=staging EXPO_PUBLIC_DEV_S1_EDITOR_SPIKE=1 npx expo run:ios --device --configuration Release
   ```

   A Release build keeps the dev-client overlay out of the way. If you would rather use EAS, add `EXPO_PUBLIC_DEV_S1_EDITOR_SPIKE=1` as an EAS environment variable for the `preview` profile and build that. Do not add it to `eas.json` in a commit.
4. Do not connect a debugger while timing. Optionally keep the phone plugged in to a Mac with Console open for jetsam lines (step 9 below).
5. Set Auto-Lock to Never for the session, and turn Low Power Mode off. Note the phone model and iOS version.

## Run (one sitting)

Write down each answer as you go; the Share report gives the timings, you add the rest.

1. Open the app. Open `ai.veyrnox.app://dev-s1-editor` on the phone (easiest: type it into Notes and tap it, or paste it into Safari's address bar). The app must already be signed in. You should see the status line `exports 0 | kills 0 | ratio n/a | not yet` above the editor. If you see a red message instead, write it down; that is a result.
2. Tap **Log**. Find the `page ... webcodecs=true offscreen=true` line. **Record both values.** `webcodecs=false` means export cannot run and S1 fails at once (stop; go to the decision table).
3. In the editor, add your two videos with the editor's own import control. Pick the photo library when iOS asks. The log should show `files 2 file(s), ... MB, video/...`. Record the sizes. Note any pause or white screen while importing.
4. Put both clips on the video track, end to end, so the timeline is as close to 60 s as the clips allow. Type the real length (seconds) into the **timeline** box at the top. Under 60 s cannot pass.
5. Add a **crossfade** between the two clips (the Transitions panel; the transition is capped at 2 s). Add one **text** item with a few words over the clip. Play the preview for 10 s. **Record:** does playback stutter, does the crossfade show, does the text show.
6. **Thumb trim check.** Drag a clip's edge with your thumb to trim it by about a second. **Record:** does it follow the thumb, can you hit a small handle, did the page scroll instead.
7. Open Export, choose **1080**, tap Export. Start counting, but the harness times it: it reads `export-start` when the progress bar appears. **Leave the screen on and in front.** Do not touch the phone until the progress bar goes away.
8. When it finishes, the status line shows the ratio and `PASS` or `not yet`. Tap **Log** and **Share**: send the report to yourself.
9. Run the export a **second time**, and during it press the side button to lock the phone for 10 s, then unlock (or swipe home and come back after 10 s). **Record:** did the export finish, restart, or did the log show `terminated`?
10. Repeat step 7 once more with nothing else changed (a third data point), then check the **kills** count in the report.
11. **Check the output.** Try the editor's Download link, and a "Save to Library" or delivery option if one appears. Record whether the log says `web view asked the app to handle a file download` and whether a file arrived. A `blob:` download may not leave the web view; that is a finding, not a failure of S1. If a copy lands in Library, open it in the app's native Library and record: duration (should equal your timeline), whether the crossfade and text are in it, and whether the audio stays in sync from start to end (watch a clap or a beat at 0 s and at 55 s; the pass line is 0.1 s).
12. Optional, if the phone is plugged into a Mac: Console.app, filter on `jetsam`, record any line naming `com.apple.WebKit.WebContent` for the run.
13. Android: repeat steps 1 to 8 on a mid-range Android phone with the same clips (Android build: `EXPO_PUBLIC_APP_ENV=staging EXPO_PUBLIC_DEV_S1_EDITOR_SPIKE=1 npx expo run:android --variant release`). Android renders the page in the system WebView (Chrome), so it takes the non-Safari encoder path.

## What to record (paste this back)

```
Phone / iOS:
Build: local Release / EAS preview
webcodecs= offscreen=
Clip A (length, size, codec): Clip B:
Import: worked / failed (what)   time to import:
Preview playback: smooth / stutters / frozen
Crossfade visible: y/n   Text visible: y/n
Thumb trim: ok / hard / page scrolled
Timeline seconds:
Export 1 (1080): seconds =   ratio =   (from report)
Export 2 (locked mid-run): finished / restarted / killed
Export 3: seconds =   ratio =
Kills in report:   Frozen marks:
Output file reached the app: y/n   duration right: y/n   A/V sync within 0.1 s: y/n
Android (if run): ratio =   kills =
Anything that looked wrong:
```

## Pass and fail

All of these must hold for a pass on the iPhone:

| # | Test | Pass | Where you see it |
|---|------|------|------------------|
| 1 | Import two clips from the photo library | Both arrive, no kill | log `files` line |
| 2 | A 60 s timeline with a crossfade and a text item | Preview plays | by eye |
| 3 | Export 1080 | **Ratio 3.00x or less** on every finished run | report `ratio` line |
| 4 | Web view kill | **`web view kills: 0`** across all runs, including the locked run | report |
| 5 | Locked / backgrounded export | Finishes (or resumes and finishes) without a kill | step 9 |
| 6 | Output | Right duration, audio within 0.1 s, crossfade and text present | step 11 |
| 7 | Thumb trim | You can trim a clip edge by touch | step 6 |

The harness verdict covers rows 3, 4 and the 60 s length only. Rows 1, 2, 5 (the locked case), 6 and 7 are by hand. The mid-range Android phone is a second pass of the same table; the owner's decision on 2026-10-19 asked for both.

Treat `frozen` marks as a warning: a page that stops for more than 8 s while visible would feel broken even without a kill.

## What the result means

| Result | Decision |
|--------|----------|
| All rows pass on iPhone and Android | **Option C.** Build the native shell and host the web engine. Next: an ADR for the real session bridge, a native media-in path (the photo picker inside a web view copies the whole file into the web process), and a download/save path for the finished file |
| Passes on iPhone, ratio over 3x but under about 6x, no kills | **C with a limit.** Cap export at 720 or a shorter timeline on phones, show a progress screen that warns the user not to leave, and re-test. This is the owner's call, not a pass |
| Any kill, or export works only while the screen never locks | **Do not ship C as designed.** Choose **B** (native timeline plus a server render) or render on the existing Fly runner. The Fly runner is not yet shown to run editor documents; that is a separate spike |
| `webcodecs=false`, or export refused by `exportBlocker` | Same as the row above: the engine cannot export on that OS version. Record the iOS version; the answer may differ on a newer OS |
| Passes on iPhone, fails on Android only | C for iOS first, with Android on B or later, or lower the Android floor. Owner's call |
| Import or preview fails (the photo picker, a white screen) but export would pass | Not an S1 pass. Note which; a native import that hands the file in by path may fix it, and that is a second spike |

## Known gaps in this spike (so a result is read correctly)

- Nothing was run. No simulator, no Metro, no build, no `npm install`. Checked only with `tsc --noEmit` and the jest suite, using the existing install from the sibling checkout by symlink.
- The memory number is not measured. The web view does not expose it on iOS; "peak JS heap" is usually "not reported". Judge memory by kills and, if you can, by Console jetsam lines.
- The harness cannot press the page's buttons. Every tap is yours. The timeline length is typed by you because the editor does not expose it.
- A `<progress>` element appearing is how the start and end are detected. If the editor shows another `<progress>` for something else (for example a media probe) the run will start early. If the log's `export-start` looks wrong, trust your own stopwatch and note it.
- Blob download through a `WKWebView` is unverified; step 11 may not give you a file.
- The access-token-only handoff relies on the web client accepting it (`authClient.js` lines around `getFreshAccessToken`). If the page shows the signed-out gate instead of the editor, that is a handoff bug in the harness, not a finding about the engine. Press Reload once, and report what you see.
- The route sits under `(app)`, so it needs a signed-in app. It is not in the tab bar and not in navigation files.
