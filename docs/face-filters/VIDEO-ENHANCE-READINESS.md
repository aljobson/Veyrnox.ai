# Video Enhance production-readiness review

Updated 2026-09-28 with local runtime measurements at `1a76094`.
Decision: suitable for continued local evaluation; not ready for customer activation.
Includes local Chromium measurements; this is not a deployment approval or a multi-device qualification.

## Prioritized release gates

| Priority | Finding and evidence | Required exit condition |
| --- | --- | --- |
| P1 | Production is intentionally disabled in both `useVideoEnhancePreview.js` and `videoEnhanceEngine.js`. `lib/contentSecurityPolicy.mjs` enables evaluation only in development and has no production WASM compilation exception. | Choose the production engine and document the CSP decision in an ADR. Test the actual production build and headers before changing activation gates. Do not copy the development evaluation policy into production. |
| P1 | Versioned assets are prepared during builds and verified in `.open-next/assets`; runtime and model provenance notices are retained. | Verify deployed asset loading, MIME/cache headers and model terms. Passing a build with the editor disabled does not verify the production engine. |
| P1 | The renderer uses a face-oval mask with eye/brow/lip exclusions, not semantic skin, hand or hair segmentation. One detected face can still contain an occluding hand inside that mask. | Qualify severe profiles, hand-over-eye/mouth, hair, facial hair and varied subjects at normal speed and full resolution. Choose segmentation, a conservative smoothing fallback, or a narrower supported scope based on measured failures. Mild cheek-touch spot checks do not establish protection of hand texture. |
| P1 | Only local Chromium has measured exports. Preflight now checks detected MP4/AAC scope, source decoder support and H.264 encoding at clip dimensions. | Establish an explicit supported browser/device matrix and test decode, preview, export, cancellation and playback of the downloaded file on each. Disable unsupported export paths with an actionable message. |
| P2 | CPU landmark detection runs synchronously on the UI thread. Export buffers the entire output before making a Blob, with several full-resolution canvases/textures. File-size and duration limits do not establish a decoded-memory or responsiveness budget. | Measure 5/10/15-second 720p/1080p clips, including high-frame-rate inputs, on target devices. Record elapsed time, responsiveness, cancellation latency and memory where measurable. Set supported limits from evidence; consider worker processing or streaming only where measurements justify it. |

## Scope decisions that need not block a limited release

- Opus may remain preview-only with the existing early warning and export guard.
  AAC and silent clips can define an initial export scope. Supporting Opus later
  requires decoded sample-count and timing regression evidence, not just matching
  container duration.
- Library persistence, provider upload and charging are absent. They require
  separate design work only if included in the chosen product scope. A free local
  download workflow does not inherently require a credits or storage integration.
- A commercial SDK is an alternative if the current engine fails qualification,
  not a prerequisite already established by this review.

## Existing evidence and its limits

The latest code CI passed before this documentation review. Automated media
checks run with ffmpeg installed and fail CI if it is unavailable. Local fixtures
covered AAC, silence, variable frame rate, rotation, cancellation and tracking
loss/recovery. Licensed real-motion and mild cheek-touch clips exported 255 and
360 frames respectively within the checker's 1 ms timing tolerance. These are
useful initial examples, not a representative device or visual-quality matrix.
Full provenance and historical results are in [the validation record](VIDEO-ENHANCE.md).

## Setup reliability follow-up, 2026-09-28

The setup deadline finding above is addressed in the local prototype: a single
30-second deadline now covers media loading through tracker creation. Timeout
aborts the attempt and invites selection of the same or another clip. Replaced
attempts suppress stale callbacks; a tracker resolving after cancellation closes
before renderer attachment. Tests cover stalled creation, late cleanup, source
replacement, pre-cancelled setup and initialization failure. Normal loading of
the licensed moving-face clip reached ready in the browser. This bounds async
waiting; it cannot preempt synchronous work that blocks the browser event loop.

## Local performance baseline, 2026-09-28

Measured on macOS 27.0 / arm64 in the Codex in-app Chromium browser, against
local Next development mode after the setup lifecycle fix (`cffe11a`). Natural
look, 30% smoothing, one face, silent H.264 input, 25 fps. Model initialization
finished before timing; each measurement runs from the automation's Export
click through observation of the Download MP4 link. These are single-run
wall-clock observations with automation/wait overhead, not precise encoder-only
measurements. Run order was the order below; warm-up effects were not isolated.

| Input | Observed export time | Output verification |
| --- | --- | --- |
| 5 seconds, 1280×720 | 8.719 seconds | 125 frames, timing/duration within 1 ms, no audio added |
| 10 seconds, 1920×1080 | 12.428 seconds | 250 frames, timing/duration within 1 ms, no audio added |
| 15 seconds, 1920×1080 | 17.220 seconds | 375 frames, timing/duration within 1 ms, no audio added |

Fixtures derive from the licensed Mikhail Nilov / Pexels 8731403 sample in the
validation record, using ffmpeg `-stream_loop -1`, `-t 5/10/15`, scaling to the
listed widths, H.264 CRF 18 and no audio. The 15-second fixture repeats the source
past its 10.2-second end. Local input/output copies and measurements are retained
in ignored `.scratch/video-enhance/performance/`.

All runs completed; export controls re-enabled afterward. This does not measure
peak memory, UI responsiveness during synchronous inference, cancellation latency,
repeated-run variance, high-frame-rate sources or mobile/Safari/Firefox behaviour
in this initial baseline. Repeated measurements below add limited evidence.
Duration and resolution vary together here, so the measurements cannot isolate
resolution scaling. A complete performance gate remains open.

## Cancellation and retry observation, 2026-09-28

Using the same loaded 15-second 1080p fixture at Natural / 30% smoothing,
started export and cancelled it while running. The cancellation message appeared
and Export re-enabled in 0.306 seconds measured from the automation click;
no Download MP4 link remained. A fresh export on the same engine then completed
in 10.580 seconds. Its downloaded output passed the checker: 375 frames,
timestamps/duration within 1 ms and no audio added.

This is one successful cancellation/retry observation, not a worst-case latency
bound. The retry was substantially faster than the prior 17.220-second run,
underscoring warm-up/system-load variability and the need for repeated controlled
measurements before setting a performance target. Peak memory and cancellation
during a long synchronous inference step remain unmeasured.

## Track-contract follow-up, 2026-09-28

Preflight and export now require exactly one detected video track and at most
one detected audio track. Additional audio/video tracks result in a preview-only
warning instead of being silently omitted. The editor explicitly states that
subtitles and descriptive metadata are not included; this is not a subtitle
preservation or detection guarantee. Opus remains separately blocked.

Real-container tests cover extra audio, extra video, audio-only input and valid
single video/audio input. Browser verification confirmed multi-audio preview
remains usable while export is disabled, and selecting a supported clip removes
the warning and restores export. Local suite: 828 passed, one skipped; scoped
lint passed. This addresses the primary audio/video selection finding for the
narrow stated contract, not arbitrary container track preservation.

## Recommended next implementation

ADR-0065 is proposed, and versioned asset packaging is implemented. Decode/encode capability and MP4/AAC format preflight are implemented. Next,
complete device/quality measurements. Local delivery-header checks now pass at the configured compatibility date using
Wrangler 4.142.0; deployed production-preview acceptance remains pending. Keep PR #361 as a draft until the release gates are settled.

## Repeated local performance qualification, 2026-09-28

Measured at `1a76094` on the same macOS 27.0 arm64 / in-app Chromium environment,
with Natural look, 30% smoothing, silent H.264 input and H.264 MP4 output.
Three sequential exports per fixture; each repeat selects a new copy of the input
and initializes a new tracker. Setup is excluded from timing. Measurements span
automation Export click to observation of Download MP4, including polling overhead.
No isolated warm-up, hardware-load control or encoder-only timing is claimed.

| Input (duration–width) | Runs, seconds | Median, seconds |
| --- | --- | --- |
| 5s-1280 | 6.810, 6.141, 5.656 | 6.141 |
| 10s-1920 | 10.764, 10.150, 9.833 | 10.150 |
| 15s-1920 | 13.647, 12.517, 14.221 | 13.647 |

All nine exports retained their expected 125/250/375 frames, source-relative
timestamps and durations within 1 ms, and did not add audio. A separate 5-second
1280×720 60 fps case took 10.796 seconds and retained all 300 frames with the same
timing checks. This 60 fps fixture was made by duplicating frames from the 25 fps
source (`ffmpeg -vf fps=60`), so it tests processing load, not real 60 fps motion.

Fixtures reuse the licensed source and preparation described above. A side-by-side
still at 4 seconds in the 60 fps source/output shows no obvious gross face-mask
misalignment; this resized single-frame check is not temporal or occlusion
qualification. Severe occlusion, varied subjects, full-resolution temporal review,
peak memory, worst-case cancellation and other browsers/devices remain open.

Machine-readable run order, timings, fidelity results and source/output SHA-256
hashes are retained in [the measurement record](video-enhance-performance-2026-09-28.json).
Local media copies remain in ignored `.scratch/video-enhance/repeated-performance/`.
The measurements support continued local evaluation, not customer activation or
a promise that every clip within the current limits will perform similarly.

## Sampled JavaScript heap and cancellation, 2026-09-28

At `5864450` (runtime `1a76094`), tested the same 15-second, 1920×1080,
25 fps silent fixture on local macOS 27.0 arm64 / in-app Chromium. Natural
look, 30% smoothing. Three cancelled exports followed by a complete retry on
the same loaded engine; no reload or forced garbage collection between runs.

CDP `Performance.getMetrics` sampled JS heap approximately every 500 ms plus
metric/UI request overhead. Timing includes automation transport and UI checks.
This is **not total peak memory**: native decoder, GPU, WASM memory and process
resident memory are not accounted for by the JS heap metric. Sampling can miss
short peaks. These measurements cannot set a device memory budget or prove
the absence of leaks.

| Run | Before JS heap, MiB | Sampled max, MiB | After, MiB | Cancel to controls ready, ms |
| --- | --- | --- | --- | --- |
| Cancel after 3.08s output | 27.44 | 31.30 | 31.55 | 285 |
| Cancel after 7.20s output | 28.75 | 32.40 | 30.34 | 285 |
| Cancel after 11.20s output | 30.42 | 34.71 | 31.80 | 286 |
| Complete retry | 31.89 | 35.51 | 28.54 | — |

All three cancellations showed “Export cancelled”, restored Export, and left
no Download link. The complete retry took 10.368 seconds including sampling
and polling overhead. Its download preserved all 375 frames, timing/durations
within 1 ms and no added audio. Selecting the 5-second fixture afterward
restored one-face preview and cleared the old download; JS heap at that point
was 28.46 MiB. Instrumentation was disabled afterward.

This adds three successful mid-export cancellation observations, not a maximum
latency guarantee: a cancellation requested during a long synchronous inference
can still wait for the main thread. Total memory, long-task profiling, genuine
high-frame-rate motion, severe occlusion and the target-device matrix remain open.

[Raw samples and run metadata](video-enhance-memory-2026-09-28.ndjson) include
source/output hashes. Diagnostic media are retained locally under ignored
`.scratch/video-enhance/memory-cancellation/`; no application code changed.

## Asset delivery follow-up, 2026-09-28

The pinned asset directory now has immutable browser caching; the model has an
explicit binary MIME type. The built Worker passed HTTP checks for all asset
hashes/MIME/cache headers, manifest, missing-file 404, private editor HTML, nonce
CSP without evaluation exceptions and the disabled editor. The reusable checker
is `scripts/check-video-enhance-delivery.mjs`.

The installed local workerd rejects the configured 2026-09-01 compatibility date
because its supported maximum is 2026-08-08. These checks used only a local CLI
date override. The repository date, CSP and activation guards remain unchanged.
A matching runtime and deployed-preview verification are still required; this
local result does not close production acceptance.

## Exact-date runtime follow-up, 2026-09-28

Wrangler 4.142.0, run from an isolated npm execution cache, starts the same built
Worker with the unchanged configured compatibility date **2026-09-01**. No date
override was supplied. The complete delivery checker passes: model/runtime and
notice bytes, MIME/cache headers, manifest, missing-file 404, private HTML, nonce
CSP without evaluation exceptions and disabled production editor.

This supersedes the local-date limitation above. The repository dependencies and
lockfile remain unchanged; the reproducible pinned CLI command is in the
[validation record](VIDEO-ENHANCE.md#production-mode-asset-delivery-check).
The temporary local Worker was stopped after testing. Deployed-preview checks,
CSP decision acceptance, enabled-editor tests and device/quality gates remain open.
