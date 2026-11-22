# S9 editor-media architecture evidence

Status: **passed** on 2026-11-22. The local AVFoundation seam is selected for S11 iOS export.

Decision owner: Wave 3A S9 / ADR 0375.

## Build identity

| Field | Recorded value |
|---|---|
| Git revision | S9 branch `codex/mobile-parity-editor-s9-media`; this document and implementation land in the same squash commit |
| Expo / React Native / Skia | Expo `~58.0.23` / React Native `0.88.1` / Skia `2.14.0` |
| Xcode / simulator runtime | Xcode 27.2 (27B52) / iOS 26.5 |
| Simulator | iPhone 17 Pro `E6CA7391-3BBB-4650-8E42-F1EDBD81F9F1` |
| Build configuration | Release, `iphonesimulator`, arm64, code signing disabled |
| Probe flag absent from `eas.json` | passed; no S9 probe flag is present |
| iOS prebuild | passed in a disposable CNG tree with the unrelated VeyrnoxVision pod excluded |
| Release simulator build | passed; `VeyrnoxEditorMedia` compiled and linked into the disposable app |
| Production bundle exclusion | passed; an iOS production export contained none of the probe route, probe failure markers or embedded fixture bytes |
| Android stub compile | source-reviewed unsupported-platform stub; no duplicate Android native environment was generated for this iOS decision |

## Public seam under test

Record the exact versioned descriptor and implementation revision. A passing run must use the normal module functions—no probe-only native entry point:

1. Skia renders one unique, frame-index-identifiable 1280×720 image for each of 900 frames.
2. `readPixels` returns tightly packed RGBA8 sRGB bytes with row stride `width*4`.
3. JavaScript writes batches of at most eight frames / 32 MiB into the module cache.
4. `appendFrameBatch` consumes and deletes each batch before the next one is admitted.
5. `finishEncode` atomically publishes H.264/AAC MP4.

The fixture is index-identifiable but intentionally low-complexity: most pixels are stable red/blue bands. It proves the complete public ingress and bounded pipeline throughput; it does not predict encode cost for S11's representative combined effects, text, transitions, or high-entropy source frames.

Frame timestamp `i`: `round(i * 1_000_000 / 30)` µs.

## Correctness gate

| Check | Required | Result / evidence |
|---|---:|---|
| Video track | H.264 / `avc1`, 1280×720 | passed in all six reports |
| Audio track | AAC / `mp4a`, stereo 48 kHz | passed in all six reports |
| Video frames | exactly 900 | passed; every indexed frame unique |
| Duration | 30 s ± one frame | 30,000,000 µs in all six reports |
| A/V end skew | ≤ one frame | 0 µs in all six reports |
| Output size | >0 and <25 MiB | 837,201–839,173 bytes |
| Timestamp deltas | nominal 30 fps ±1 µs after track-timescale remux | passed in all six reports |
| Indexed color bands | no missing/duplicate indices | passed in all six reports |
| Red/blue bands | decoded error ≤12 per channel | passed in all six reports |
| Rotated portrait source | aspect-fit 128×72 + transform metadata | passed in all six reports with a real 90° H.264 display matrix, exact green/yellow/red/blue quadrant coordinates and decoded black letterboxing |
| WAV decode | 1,440,000 frames, 2 channels, 48 kHz synthetic 440 Hz stereo | passed through decode, AAC encode and output decode |
| Cancel after admission | no published or partial artifact | passed in all six reports |
| Abandoned session | 30 s idle timeout cleans and unblocks worker | JS lease release has a focused fake-timer regression; the matching native worker timeout is source-reviewed only and is not exercised by the device probe |
| Corrupt input | stable `corrupt-media`, no artifact | passed in all six reports |
| Project/account change | late result suppressed; cache purged | lifecycle and owner-fence regressions passed |
| Release | module-cache artifact removed | passed in all six reports |
| Document inputs | remain read-only and outside cleanup/quota roots | source-reviewed path boundary only; not exercised by the cache-root device probe |
| Retry after cancellation/corrupt refusal | succeeds without reinstall/relaunch | passed in every run: a cancelled encode was followed by a newly admitted encode, and corrupt sampling was followed by valid rotated-source sampling |

Any failed correctness row blocks an export-architecture selection.

## Measured runs

A first-process run terminates the app, launches a fresh process, creates new never-seen frame content and unique paths, and performs no pre-read. It does not claim to evict the host macOS page cache. Warm runs follow in the same process. Audio fixture creation is reported separately; no video render or file-write work is excluded from the end-to-end duration. Project-generation cleanup removes prior in-app report archives when the next fresh process starts, so the host copies each first-process/warm pair immediately after it completes and before launching the next pair; the six copied JSON files are then validated together by `read-editor-media-probe.mjs`.

| Run | Mode | Skia render/readback s | JS write s | native append/encode/finalize s | end-to-end s | bytes written/read | peak batch disk | peak RSS | output MiB |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | first process | 0.859 | 1.529 | 2.589 | 5.363 | 3,317,760,000 / 3,376,498,562 | 29,491,200 | not captured | 0.800 |
| 2 | first process | 0.849 | 1.257 | 2.238 | 4.722 | 3,317,760,000 / 3,376,499,000 | 29,491,200 | not captured | 0.800 |
| 3 | first process | 0.882 | 2.296 | 2.115 | 5.685 | 3,317,760,000 / 3,376,493,153 | 29,491,200 | not captured | 0.798 |
| 4 | warm | 0.838 | 1.097 | 3.148 | 5.447 | 3,317,760,000 / 3,376,493,489 | 29,491,200 | not captured | 0.799 |
| 5 | warm | 0.853 | 1.104 | 2.008 | 4.344 | 3,317,760,000 / 3,376,493,084 | 29,491,200 | not captured | 0.798 |
| 6 | warm | 0.866 | 1.295 | 2.041 | 4.580 | 3,317,760,000 / 3,376,498,307 | 29,491,200 | not captured | 0.800 |

First-process gate: median ≤90 s and every run ≤120 s. Warm runs are diagnostic only.

First-process median: **5.363 s**. Maximum: **5.685 s**. Gate: **passed**.

## Resource and lifecycle observations

- Maximum simultaneous frame batch: 8 frames / 29,491,200 bytes, within the 32 MiB cap.
- The `read` counter is logical public-seam I/O: native consumption of each RGBA ingress batch and decoded PCM artifact, source WAV/media reads, compressed output reads for inspection/sampling/audio decode, plus JavaScript reads of sampled analysis frames. No ingress batch remained after admission.
- Output was 0.798–0.800 MiB and explicit release removed it. Bound PCM was protected from cleanup, quota eviction and release until the encode lease closed.
- Document-root media is read-only to the module and excluded from module-cache eviction by the reviewed path boundary; the six device reports use only the module cache root, so this boundary remains source-reviewed rather than integration-tested in S9.
- Partial artifacts were removed on cancellation/corrupt input; each cold process then completed a clean warm retry.
- Progress stage ordering/monotonicity, owner changes, generation fences, JS idle-lease expiry and explicit post-cancel release are covered by focused lifecycle regressions rather than claimed as device-probe coverage. Native quota, document-root and 30-second worker-timeout branches are source-reviewed only.
- Background execution and physical-device memory/thermals remain final-release qualification items.

## Architecture outcome

Choose exactly one after all evidence exists:

- [x] Local AVFoundation writer seam passes; select it for S11.
- [ ] Pinned maintained Skia export package passes the same build, fixture, audio and cancellation gates; select it for S11.
- [ ] Neither passes; keep S9 analysis primitives and mark S11 export blocked.

Selected outcome: **local AVFoundation writer seam**. The post-remediation six-report host reader returned `architectureEligible: true`, with three unique first-process and three unique warm reports and no failed checks or blockers.

Limitations to carry forward: simulator throughput is not evidence for physical-device thermals, memory pressure, touch behavior, background execution or App Store production parity. The low-spatial-entropy fixture also understates representative S11 composition/encode work, so S11 must add a combined-effect, text, transition and source-frame workload before performance qualification. A real iPhone qualification pass remains mandatory before claiming local-export parity.
