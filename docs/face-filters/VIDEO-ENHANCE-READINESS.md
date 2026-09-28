# Video Enhance production-readiness review

Reviewed 2026-09-28 at `dd23e380bce7228fe8c12f651f45843da2119686`.
Decision: suitable for continued local evaluation; not ready for customer activation.
This is a code/evidence review, not new device testing or a deployment approval.

## Prioritized release gates

| Priority | Finding and evidence | Required exit condition |
| --- | --- | --- |
| P1 | Production is intentionally disabled in both `useVideoEnhancePreview.js` and `videoEnhanceEngine.js`. `lib/contentSecurityPolicy.mjs` enables evaluation only in development and has no production WASM compilation exception. | Choose the production engine and document the CSP decision in an ADR. Test the actual production build and headers before changing activation gates. Do not copy the development evaluation policy into production. |
| P1 | Model/WASM assets are ignored by Git. `prepare-video-enhance.mjs` prepares them locally, while the deployment workflow runs `npm ci` and `build:worker` without that preparation. | Package pinned assets reproducibly, verify the model checksum, retain required notices, and test asset loading from the deployed build. Passing a build with the editor disabled does not verify the engine. |
| P1 | The renderer uses a face-oval mask with eye/brow/lip exclusions, not semantic skin, hand or hair segmentation. One detected face can still contain an occluding hand inside that mask. | Qualify severe profiles, hand-over-eye/mouth, hair, facial hair and varied subjects at normal speed and full resolution. Choose segmentation, a conservative smoothing fallback, or a narrower supported scope based on measured failures. Mild cheek-touch spot checks do not establish protection of hand texture. |
| P1 | Only the local Chromium environment has measured real exports. Audio preflight checks the primary audio codec; it does not establish decoder/encoder availability for a given device. | Establish an explicit supported browser/device matrix and test decode, preview, export, cancellation and playback of the downloaded file on each. Disable unsupported export paths with an actionable message. |
| P2 | `page.js` clears the 15-second load timeout as soon as `loadeddata` fires, before imports, compatibility inspection and tracker initialization finish. The async tracker creation has no deadline or cancellation mechanism. | Bound the entire setup lifecycle, make timeout recovery possible, ignore stale completions and close any instance that finishes after cancellation. Verify with delayed/failed model loading and rapid source replacement. |
| P2 | CPU landmark detection runs synchronously on the UI thread. Export buffers the entire output before making a Blob, with several full-resolution canvases/textures. File-size and duration limits do not establish a decoded-memory or responsiveness budget. | Measure 5/10/15-second 720p/1080p clips, including high-frame-rate inputs, on target devices. Record elapsed time, responsiveness, cancellation latency and memory where measurable. Set supported limits from evidence; consider worker processing or streaming only where measurements justify it. |
| P2 | Export explicitly selects `tracks: 'primary'`. Successful primary-track conversion does not establish preservation of additional audio, subtitle or data tracks. | Define a primary-video/primary-audio contract and reject or clearly disclose additional-track loss before export; test a multi-track fixture. Avoid claiming preservation of every source track. |

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

## Recommended next implementation

First fix the bounded-initialization/recovery gap while keeping the local-only
gate. It is independently testable and improves the prototype without committing
to a production engine or weakening CSP. Then measure performance and device
capabilities before writing the engine/asset/CSP deployment ADR. Keep PR #361
as a draft until the intended release scope and its applicable gates are settled.
