# On-device editor media pipeline (S9 / D3)

Status: Accepted for S11 local export on iOS. Release-simulator qualification passed on 2026-11-22.

## Context

The Professional Editor can already author web-compatible timeline fields on the phone, but Scenes, Clip Finder, motion processing and an eventual local export need bounded access to decoded video frames and PCM. The existing Beats audio engine is whole-buffer and optimized for interactive music playback; it is not a streaming editor-media contract. Passing full 720p frame arrays or whole-track PCM arrays over the Expo bridge would also make memory use and cancellation unpredictable.

S11 additionally needs an evidence-backed path from a Skia-composited frame to H.264/AAC. Proving that AVAssetWriter can encode internally generated color bars would not prove that path: the expensive seam may be Skia render/readback, JavaScript file writing, or repeated native ingestion.

## Decision

S9 introduces the local `VeyrnoxEditorMedia` Expo module.

- iOS uses AVFoundation for bounded inspection, 128×72 frame sampling, Float32 little-endian 48 kHz PCM spools, and a file-batched H.264/AAC writer.
- Android registers the same API and returns the stable `unsupported-platform` refusal without permissions, files or hidden fallback.
- Media artifacts live only under account/project-scoped module cache directories. The existing document editor-media root is read-only to the module.
- Every operation has account, project, owner and token identity. Owner/project generation changes cancel work and remove stale module artifacts. Open encode sessions expire after 30 seconds without append or finish.
- Encoding consumes versioned batches of at most eight tightly packed RGBA8 720p frames (row stride `width*4`, sRGB input mapped to BT.709) and deletes each consumed batch. Output is first written as `.partial`, then atomically published.
- Callers explicitly release artifacts. Cache quota/eviction applies only to module-manifested cache files, never imported document media.

S9 selects this module for analysis primitives and the local AVFoundation writer for S11 iOS export.

The local writer becomes the S11 path only if a Release-simulator probe measures the complete public seam: 900 unique Skia renders, `readPixels`, JavaScript file writes, native batch ingestion, encode and finalization. The first-process median must be at most 90 seconds and no run may exceed 120 seconds. Correctness, cancellation, cleanup, A/V timing and disk bounds must all pass.

The complete Release-simulator seam passed three first-process and three warm runs. After the final Claudex remediations, the first-process median was 5.363 s and the maximum was 5.685 s, with all device-probed correctness checks green. A production iOS export contained no probe marker or fixture bytes. The JS idle-lease expiry has a focused fake-timer regression; native document-root exclusion, quota behavior and the matching 30-second worker timeout are source-reviewed only and are not misreported as device/integration results. The implementation binds decoded PCM at encode admission, maintains a bounded one-second native audio lookahead so AVAssetWriter can drain its interleaver, signals end-of-audio when the source is consumed, and ends the writer session at the exact video duration. This avoids both the repeatable frame-56 starvation seen with zero lookahead and the end-of-stream stall seen before explicit audio completion.

A maintained Skia export package is therefore not selected. It remains only a contingency if a future Expo/React Native/AVFoundation revision fails the same probe.

## Protocol invariants

- Stable errors only: `unsupported-platform`, `module-missing`, `invalid-input`, `unsupported-codec`, `corrupt-media`, `cancelled`, `busy`, `disk-full`, `write-failed`.
- Oversized but otherwise decodable input is `invalid-input` with reason `source-too-large`, not a codec error.
- Canonical inputs are limited to the account/project editor document root and module cache root after URL standardization and symlink resolution.
- Presentation time for frame `i` is `round(i * 1_000_000 / fps)` microseconds. Remuxed deltas may differ from the nominal period by at most one microsecond.
- The 512 MiB total quota and the 64 MiB frame, 16 MiB PCM and 25 MiB MP4 caps cover only module-created cache artifacts.
- The module adds no camera, microphone, photo-library or broad storage permission.

## Consequences

- S10 can consume small sampled frames and PCM loudness without inventing another decoder contract.
- S11 owns Skia composition, effects, text, audio DSP and upload; S9 knows nothing about timelines.
- S12 and S13 may reuse bounded decode/encode primitives, but cannot surface native error prose.
- Android editor consumers must present an honest tool-specific unavailable state until a separately reviewed Kotlin implementation lands.
- The simulator decides architecture feasibility, not real-device thermals, background behavior, touch quality or production parity. The S9 fixture is deliberately low-spatial-entropy, so S11 must qualify a representative combined-effect/text/transition/source-frame composition workload. Final export still requires real-iPhone qualification.

## Evidence required to change status

The evidence record is [S9-EDITOR-MEDIA.md](../mobile/spikes/S9-EDITOR-MEDIA.md). It contains the six measured runs, correctness checks, build identity and selected outcome. Simulator throughput is still not a substitute for the final real-iPhone release qualification.
