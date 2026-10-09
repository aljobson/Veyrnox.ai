# ADR-0065 — Video Enhance production runtime and asset delivery

Status: **Proposed**, 2026-09-28. No production activation or security-policy
change is implemented by this ADR. Related: PR #361, ADR-0060.

## Problem and proposed decision

The local Video Enhance prototype processes short clips with MediaPipe Face
Landmarker, a WebGL filter and Mediabunny export. Production currently rejects
the engine and disallows WASM compilation. Versioned model/runtime assets are now
packaged and verified in the Worker artifact; this does not enable the editor.
Green deployment checks therefore do not demonstrate a working production editor.

Propose a limited, free, browser-local release using the pinned prototype engine,
conditional on the quality/device gates below. Retain local download, with no
provider media upload, Library write, generation job or credits transaction.
This is a proposed product scope, not a statement that launch has been approved.

Initial qualification target: desktop Chromium, one face, one video track,
zero or one AAC audio track, MP4 input/output, at most 15 seconds, 100 MiB and
1920 pixels on the longest edge. These are ceilings, not proven device guarantees.
Reject other audio codecs for export in this initial scope, including Opus.
Disclose subtitle/metadata omission. Retain preview-only guidance where supported.
Require actual decode/encode capability checks; browser identity alone is not enough.

## Engine and asset packaging

1. Keep MediaPipe 1.0.1, Mediabunny 1.60.0 and the current model digest pinned
   until a separately qualified upgrade. Reassess the engine if occlusion gates fail.
2. Extend the preparation script to produce a versioned same-origin asset path
   and a manifest of model/runtime names, hashes, sizes and license notices.
   Validate every expected file and fail the build on a checksum or manifest mismatch.
3. Prepare assets after dependency installation and before the first Next/OpenNext
   build in both preview and production build entrypoints. Verify that the files
   reach `.open-next/assets`; do not depend on ignored files from a developer's disk.
4. Use the existing Workers static-assets binding. Cloudflare deploys the configured
   asset directory with the Worker; integration must verify the generated artifact,
   not just `public/`. See [Workers static assets](https://developers.cloudflare.com/workers/static-assets/).
5. Serve immutable versioned assets with correct JS/WASM MIME types. Keep HTML
   nonce/private-cache behaviour from ADR-0060. Check actual response headers because
   static asset routing may not traverse application middleware.
6. Retain SDK/model license and notice material in the deployed artifact and
   release inventory. No stock test footage is shipped as a runtime asset.

Model downloads happen during artifact preparation. User-selected video stays
on the device; a production network test must verify this claim during preview,
export, cancellation and error recovery. No media/file names enter telemetry.

## Proposed CSP exception and document boundary

Propose adding `wasm-unsafe-eval` only to the enabled enhancement document's
`script-src`, preserving its nonce and existing source allowlists. Keep JavaScript
`unsafe-eval` and script `unsafe-inline` absent. MDN distinguishes the narrower
WASM permission from JavaScript string evaluation in its
[script-src documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src#unsafe_webassembly_execution).
This expands executable capabilities for that document and requires acceptance
of this security decision; it is not a harmless asset-header adjustment.

ADR-0060 explicitly established that client navigation can retain the initiating
document's policy. A route condition alone is insufficient. This proposal changes
the navigation assumption for the enhancement boundary only:

- Enter through a full-document navigation, including every desktop/mobile link,
  redirect and programmatic entry. Prefetched client navigation must not instantiate
  the editor under another page's document policy.
- Leave through full-document navigation to restore the ordinary document policy.
  Test browser history, refresh, direct links, legacy `/veyrnox/app/enhance`, query
  strings and client navigation in both directions. Match only canonical editor
  documents after the existing redirect rules; do not expand an `/app/*` policy.
- The same policy must reach the framework's request nonce handling and HTML
  response. Do not add a competing second CSP header through static configuration.
- Test a harmless WASM module on the editor and verify it remains blocked on
  unrelated documents. Verify JavaScript evaluation and unapproved inline scripts
  remain blocked everywhere. No wildcard or new external script/connect host.

If the pinned runtime needs broader evaluation privileges, stop this rollout.
Evaluate a separately served worker runtime or an isolated-origin editor in a
new amendment. A worker may improve responsiveness, but OffscreenCanvas/runtime
compatibility and its own CSP must be proven before selecting that alternative.

## Activation, acceptance and rollback

Introduce a proposed server-controlled `VIDEO_ENHANCE_ENABLED` flag defaulting to
false. The server-rendered editor, navigation and CSP decision must agree; missing
or malformed values fail closed. localStorage may not override a disabled server
flag. This flag controls feature availability, not authorization to sensitive data.

Before any enabled preview: verify the clean-build asset manifest, checksums,
MIME/cache headers, notices, CSP boundary and disabled-flag behaviour. Use a real
production-mode Worker preview, not the development server's relaxed policy.

Before customer activation: qualify full-resolution temporal quality on varied
subjects, severe profiles and hand/hair occlusion; measure repeated 5/10/15-second
exports, memory, cancellation and setup recovery on each declared supported device;
verify exported playback, frame timing and decoded AAC audio. Explicitly reject
unqualified formats/devices. The two licensed examples and single-machine timings
in the readiness review are initial evidence, not completion of these gates.

Roll out first to an enabled non-production preview, then a deliberately limited
customer scope only after the applicable gates pass. Monitor aggregate error stage
and timing only if telemetry is separately implemented with a clear data contract.

Rollback: disable the server flag and restore the ordinary editor-document CSP;
retain versioned assets long enough for existing documents to finish or fail safely.
Already-open local editors cannot be instantly revoked by a server flag without an
explicit refresh/revalidation mechanism. A security rollback must include a reviewed
deployment revert and document reload strategy. No database rollback is required
for the proposed local-only scope.

## Implementation status, 2026-09-29

Asset packaging, immutable static delivery and decode/encode format preflight
are implemented. Disabled-editor delivery passed locally and on the deployed
version identified in the [delivery report](../face-filters/VIDEO-ENHANCE-DELIVERY.md).
Current code CI is green at `80fe649`. Local lifecycle regression and browser
checks are recorded in the readiness review. These implementation results do
not accept this ADR or complete the device/quality, model-terms or enabled
production-preview gates.

## Implementation sequence

1. Build/version/verify asset packaging while retaining current development-only guards.
2. Add capability/format preflight and complete device/quality measurements.
3. After acceptance of the CSP decision, implement the document boundary, matching
   nonce policies and default-off server flag with security regression tests.
4. Run production-preview acceptance and record evidence before activation.

Alternatives: retain the prototype locally (current behaviour); use a commercial
SDK after measured quality/cost evaluation; or use server processing with a new
upload, privacy and cost design. None is silently substituted by this proposal.

Evidence: [validation record](../face-filters/VIDEO-ENHANCE.md) and
[readiness review](../face-filters/VIDEO-ENHANCE-READINESS.md).
