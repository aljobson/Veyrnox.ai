# ADR-0335 — Dark local Photo Studio and vision asset admission

Status: implemented for host qualification; not activated. S0–S3; S3 amendment below.

Frozen work order SHA-256: `81d054aa1f9c50d8c4ed5c74ccb195a4c2c8e906ac99c18e4d3e362473383ce9`.
The checkout and cached `origin/main` are at `8bb562cfb`. ADR-0335 is free in
that ref; the builder could not resolve GitHub to check remote movement.
The host must recheck the ADR number before integration. No publish is authorized.

## Deployment finding and decision (D2a)

ADR-0092 describes middleware as the response policy boundary. In this checkout,
`worker.js` delegates to OpenNext without a vision admission branch,
`wrangler.jsonc` routes only `/showcase/*.mp4` through the Worker first, and
`public/_headers` explicitly documents that Assets delivery bypasses Next headers.
The production workflow builds with `npm run build:worker` and deploys this
configuration. Thus there is no established production guarantee that the
existing vision assets receive the middleware's CSP or flag denial.

Add `/editor-vision/*` to `assets.run_worker_first`. Before delegation to OpenNext,
`serveEditorVision` permits only the known files in the two prefixes and GET/HEAD,
checks runtime bindings, fetches through `env.ASSETS`, and overwrites response CSP
and cache headers. Unknown paths and disabled prefixes return 404 without an
asset fetch. Other asset routes and the speech Worker are unchanged. Middleware
uses the same admission policy for ordinary Next development. Global CSP and
Permissions-Policy are unchanged; this slice never requests a camera.

The existing prefix remains byte-for-byte:
`/editor-vision/mediapipe-1.0.1-multiclass-1-c6748b12-worker-1/`.
It requires only `localInference`, independent of `photoStudio`.

The new prefix is:
`/editor-vision/mediapipe-1.0.1-facelandmarker-1-64184e22-worker-2/`.
It requires BOTH `localInference` and `photoStudio`. Only the new Worker runs
Face Landmarker; the previous person Worker/client protocol is unchanged.
Both releases are prepared and verified. The verifier refuses extra prefixes,
symlinks, file set changes, hashes, sizes and provenance changes. Application
Worker hashes are pinned as well as the model/SDK bytes. Future hair-channel
work belongs to S3 and needs a separate prefix/retention decision; it is not
silently added in S0. No previously opened person tab needs a new protocol.

All admitted files get exactly:

```
default-src 'none'; script-src ORIGIN/PREFIX/ 'wasm-unsafe-eval'; connect-src ORIGIN/PREFIX/; worker-src 'none'; base-uri 'none'; object-src 'none'
```

`ORIGIN/PREFIX/` is the validated exact origin and selected immutable prefix.
There is no `unsafe-eval`, blob Worker, nested Worker, external SDK host or page
WASM allowance. Admitted GET and HEAD use `Cache-Control: no-cache`, even for
immutable bytes: a browser may keep the file but must revalidate here before each
use, so a later flag-off decision applies to the next request while an unchanged
file costs a 304, not a re-download of the ~28 MB runtime (no-store was the first
draft; it also made every request a full Worker-served transfer). Already-loaded
code is not remotely revoked. Denials and any non-delivered upstream status use
no-store, and denials a deny-all CSP.

The previous runtime is 28,624,644 bytes; the new runtime is 16,009,877 bytes.
Combined assets are 44,634,521 bytes, 14 files excluding manifests, with largest
asset 16,371,837 bytes. Retention makes the former single-prefix 32 MiB total
impossible. The proposed explicit budget deviation is **48 MiB combined**, while
retaining the 32 MiB per-prefix and 25 MiB per-file bounds. These are Assets bytes,
not SSR/Worker bundle bytes; model code never enters the SSR import graph.

## Gates and privacy (D7)

Add `PHOTO_STUDIO_ENABLED: 'photoStudio'` to the existing grouped flag reader.
Production and staging configuration values are unchanged: the new key is
absent and therefore off. No new Worker binding is added; JSON remains under
1024 characters (covered by a test). The server layout returns not-found, and
middleware denies direct requests before streaming to ensure HTTP 404. The custom
Worker also denies the route before Next can redirect its internal alias. Both
`/app/photo-studio` and its internal `/veyrnox/app/photo-studio` path are covered.

A localStorage preview preference can reveal the client only after that server
gate. It cannot enable assets. No public navigation entry is added; Vey filters its generated route inventory
through the same flag. The host can
set the two grouped keys to string `"true"` in a local/staging configuration and
choose “Open local preview” on the route for qualification.

Images, names, landmarks, settings and masks are never sent to a service or
persisted. Only the preview opt-in is stored. An inference job transfers a bitmap
with maximum edge 384 and returns 478 Float32 xyz points only for exactly one
face. A second face disables face tools; zero/invalid/error results clear masks.
Workers close on completion, timeout, source change and unmount. Bitmap ownership
is released even when decoding races cancellation. No identity recognition,
analytics payload, provider call, Credits operation or server upload is added.

## Photo engine and limits (D1, S1)

Pure effect definitions, original SVG geometry, polygon tables, colour maths,
One-Euro smoothing and bounded undo history live in `packages/live-edit` as
plain JavaScript. Mobile sources are unchanged; a Node test transpiles the actual
mobile `instantLooks.ts` and compares all nine looks at several strengths.
The polygon edges are checked against the installed SDK's connection tables.

The WebGL2 renderer uses the bilateral kernel lifted from Video Enhance, which
now imports the same kernel. Skin masks have expanded eye, eyebrow and lip holes.
Blemish soften reduces local texture, not semantic blemish detection. Teeth/eye
controls brighten only light, low-chroma pixels inside conservative polygons;
they cannot identify actual teeth/sclera under every pose or lighting condition.
The two original sampled RGB tone curves are LUT-style looks, not external LUTs.

The same full-resolution drawing function produces preview and PNG/JPEG export,
including original SVG-path stickers. Zero adjustments bypass shader arithmetic
and copy the decoded source exactly; this promises decoded pixels, not identical
compressed files. JPEG removes alpha. Compare is transient and never changes the
exported stack. Export cannot complete into a superseded source. Eight stickers
and 100 undo entries bound UI state; source limits are 50 MiB, 24 megapixels and
8192 pixels per edge, additionally restricted by the device's WebGL limits.
Larger images are explicitly refused, never silently downscaled. Decoding freezes
one bitmap, including for animated PNG/WebP input; this slice edits a still.

This is still-photo S1: inference is once per source; controls redraw on animation
frames. No camera, video, makeup, hair or wig path is implemented. The One-Euro
filter is tested but no 15 Hz inference or 16–33 ms GPU performance claim is made.
There is no native install or dependency change. New web copy uses i18n keys with
shared English beta copy, following the Music precedent; reviewed translations
are required before localized rollout. This localization limitation is explicit.

## Qualification

`scripts/probe-photo-studio-worker.mjs` requires the real `.open-next` build. It
starts local Wrangler with a disposable configuration/static JWKS, tests all four
flag combinations, checks GET/HEAD statuses, CSP, cache policy and body hashes for
both Worker/model pairs, and stops its process group. It never overwrites an
existing `.dev.vars`. `--serve` keeps only the final local enabled instance for
the host's browser proof; Ctrl-C stops it.

The separate Playwright proof uses software WebGL flags and original synthetic
pixels, the actual renderer and actual retained person client. Harness modules
are intercepted; all Worker/model/SDK requests reach the built Worker. It checks
page WASM denial, shader compilation, orientation, zero pixels, skin holes,
no-face rendering, combined PNG export equality, old-prefix processing and the
new model's no-face path. It is not a real-face visual quality qualification.
See `docs/face-filters/PHOTO-STUDIO-S0-S1-REPORT.md` for executed and blocked checks.

## S3 amendment — hair confidence protocol and recolour (D2a/R8)

Built on committed S0–S2 `7de8d64d3`. The original deployment findings above
record S0; the wildcard Worker-first route is now established. S3 changes only
the shared admission helper, with **no** `wrangler.jsonc`, `middleware.js`,
`worker.js`, global CSP or Permissions-Policy changes.

New current segmentation prefix:
`/editor-vision/mediapipe-1.0.1-multiclass-1-c6748b12-hair-worker-2/`.
The retained segmentation prefix stays
`/editor-vision/mediapipe-1.0.1-multiclass-1-c6748b12-worker-1/`.
The current Face Landmarker prefix is unchanged. There are three physical
prefixes: current hair segmentation, exactly one previous segmentation release,
and current face inference (a different model, not an extra previous release).

Existing person clients continue to select the old prefix by default. Their
admission requires `localInference` only, including when `photoStudio` is off.
Only the new Photo Studio hair client opts into the hair prefix, which requires
both flags, like Face Landmarker. All three prefixes use the same scoped response
CSP and no-cache/revalidation policy. Production remains dark.

The original Worker is frozen at `scripts/editor-vision-worker.mjs`, with the
original 3,222 bytes and SHA-256
`3208a143547fc9000de7f351dd56612be2cfaf2ece41eebfbeb1a4c0f0935ca0`.
The old manifest's `source` field names that actual frozen build input. The
hair Worker lives at `scripts/editor-vision-hair-worker.mjs`; its new manifest
names that file directly. There is no source override or duplicate v1 source.
Preparation and verification both read the declared source and verify its pin.
Preparation reuses the already verified local model, avoiding a download, and
verifies the exact three-prefix inventory. All eight retained files, including
the manifest, were SHA-256 compared before/after preparation and are identical.

The pinned `@mediapipe/tasks-vision` 1.0.1 `vision.d.ts` provides `getLabels()` and
Float32 confidence masks. The pinned TFLite's embedded `labels.txt` is exactly
`background, hair, body-skin, face-skin, clothes, others` (one per line).
The new Worker verifies that order at initialization, copies **class 1** before
closing SDK results, and transfers HAIR alongside the existing channels.
Input remains <=384 pixels per edge; output remains <=512 pixels per edge.
All four Float32 channels must have width × height finite values in [0,1].
Maximum transferred masks are 4,456,448 bytes (17 bytes × 512²); hair adds at
most 1,048,576 bytes. Legacy clients do not require hair. Opted-in clients do,
and any supplied hair channel is validated. Photo Studio alone accepts the
existing 8192-edge source limit before bounded bitmap decoding.

**Budget deviation: proposed, pending owner approval.** The implementation
uses a combined cap of **72 MiB** instead of 48 MiB. The owner has not approved
this increase; passing checks does not constitute approval.
Retaining the previous segmentation runtime while shipping the current hair
runtime and face runtime cannot fit 48 MiB. Counts excluding manifests:

| Release | Bytes | Files |
| --- | ---: | ---: |
| Previous segmentation | 28,624,644 | 7 |
| Current face | 16,009,877 | 7 |
| Current hair segmentation | 28,625,163 | 7 |
| Combined | 73,259,684 | 21 |

Per-prefix 32 MiB and per-file 25 MiB bounds remain. Largest file is 16,371,837
bytes. This is static Assets storage, not an increase to the server Worker
bundle by those amounts. Removing the previous prefix requires a later explicit
retained-client-window decision; it is not part of this slice.

### Still-photo effect contract

One face result is required before the separate segmentation job starts. The face
Worker closes first to avoid retaining two model heaps. Both workers terminate
on completion, source replacement, timeout or unmount. Missing/multiple faces,
unavailable inference and an empty hair matte disable hair; statuses are announced
and an inference failure offers Retry photo. Stills need no temporal smoothing.
No camera, mobile, wig, reconstruction, migration or provider work is included.

Pigment presets/swatches support all-over colour, ombre and highlights. The
LAB-like design intent is implemented as linear-light luminance/chroma separation:
source Rec.709 luminance is kept, shade chroma is substituted, then contracted
into RGB gamut instead of clipping. This preserves luminance even near black or
white; it cannot turn black hair into a bright blonde. Highlights select brighter
source strands rather than inventing new geometry. Ombre interpolates pigments
from roots to tips along the detected hair region's vertical extent.

The renderer reuses the ADR-0092 0.2–0.8 smooth confidence matte; a bounded RGBA8
confidence texture is linearly sampled and feathered on the GPU. This quantizes
confidence to 1/255. Hair never changes alpha, deletes pixels or reconstructs the
background. At strength zero the neutral stack copies decoded pixels exactly;
with other effects active, hair contributes no arithmetic to the colour.
Preview and export share the same render function, with history and comparison
using normalized hair settings. Colours are pigment data; interface chrome uses
existing theme tokens. English beta copy follows the S0–S2 locale mechanism.

### S3 host proof

The probe checks GET/HEAD, body hashes, response CSP and cache policy for all
three Worker/model pairs under all four flag combinations. In particular, the
previous pair must still return 200 with CSP when localInference=true and
photoStudio=false. The Playwright proof processes pixels through that old client
and prefix, and checks the new actual Worker hair channel separately.

The real-renderer hair proof uses original synthetic plateaus and stored 3×3
analytic RGB crops with tolerance 2/255. It collects expected/actual misses
instead of stopping on the first crop. Edge/highlight transitions use relations,
not hand-derived steep-gradient goldens. It also checks monotonic strength,
orientation/background exclusion, linear luminance, unchanged alpha, missing and
multiple faces, cleared masks and combined makeup/hair PNG export equality.

Real portrait quality remains a host qualification, using ADR-0092's private
NASA-style fixture handling (never commit images). Set `PHOTO_HAIR_FIXTURE` to
a private JSON manifest containing `image` (relative to the manifest), its
`sha256`, and manually verified normalized `backgroundRects` as [x,y,w,h]. The
second Playwright test verifies the image hash, one face, a confident hair peak
and **maximum hair alpha <0.05 at every sampled known-background pixel**. Missing
fixture input is reported as a skipped test, never as model-quality evidence.
See `docs/face-filters/PHOTO-STUDIO-S3-REPORT.md` for executed and deferred checks.

## S3 inspection round 1 — mask admission, association and upload failures

H1: Hair readiness now requires confidence >0.5 in at least 0.5% of mask pixels,
rounded up, with a minimum of two pixels even for an 8×8 mask. At 256×256 this is
328 pixels. This is a conservative speck/haze guard, not a calibrated model-quality
claim: it accepts modest visible hair areas while refusing sparse clutter. Very
small or distant hair can consequently remain off; the in-app help says so.
The ombre extent is the 2nd–98th percentile of row mass, weighted by the existing
confidence matte over those >0.5 pixels. Weak edges still feather but do not set
the bounds; tiny isolated extremes do not stretch the root-to-tip gradient.

H2: After the one-face gate, before upload, the engine computes 8-connected
components on the bounded hair mask. Component membership uses confidence that
survives the existing RGBA8 quantization and 0.2 matte floor, so invisible haze
cannot join regions. It retains every component with a >0.5-confidence pixel
inside a face-relative anchor box. The box is the canonical face-oval bounds
expanded by **0.5 face widths on each side, 1 face height upward and 0.25 face
heights downward**, clamped to the image. These generous margins accommodate
crown volume, curls and hair near the jaw; preserving the whole attached component
keeps long hair below that box and separate locks on both sides. Components with
no confident anchor overlap are zeroed before readiness/bounds calculation.

This is spatial association, not identity recognition. A nearby second person's
hair inside the expanded box, or hair physically touching/visibly connected to
the subject's hair, can still be retained and recoloured. In-app help explicitly
warns about touching/closely standing people and asks for space around one person.
The heuristic and its margins need broad portrait qualification; no such quality
claim is inferred from the synthetic fixtures.

H3: Processor initialization/segmentation failures retain the hair-unavailable
Retry path. Filtering/renderer errors use a separate path. `invalid-hair-mask`
clears hair and announces an internal preview failure without a Retry control;
other upload errors report `onError('graphics-lost')`. The renderer invalidates
its old hair state before an upload and explicitly checks context loss and GL
errors. Even failure while clearing a mask routes to the graphics error handler,
not an inference retry loop. Other edits remain usable after an invalid mask.

Focused tests cover the area cutoff, isolated specks, robust bounds, both side
locks/connected long hair, a distant second blob, missing faces, filtering before
upload, lost context, malformed masks and failures during clearing. The browser
proof now exercises selection and speck rejection using plateau/relational checks;
its stored RGB goldens are unchanged. The private portrait proof checks readiness
of the associated mask in addition to the existing raw background-alpha check.
The host reported the prior revision green (7,966 tests, HTTP probe 56/56 and
real-GPU Playwright hair checks); those results are preserved as prior evidence.
This revision's GPU/build qualification is for the host to re-run.

## S3 final inspection round — face availability and truthful provenance

F1: A failed Face Landmarker initialization/detection sets a failure flag. Once
masks are cleared, hair reports `unavailable` and exposes its existing Retry
control. `face-required` remains for genuine no-face/multiple-face results.
Lifecycle tests cover both initialization and inference exceptions without
starting hair inference or blaming the photo.

F2: Restore the historical `scripts/editor-vision-worker.mjs` filename to the
original v1 bytes; put the hair implementation in
`scripts/editor-vision-hair-worker.mjs`. Delete the uncommitted duplicate v1
source and remove `releaseSource`. Both prepare and verify use each asset's
literal declared `source`. All local sources, including the now explicitly
pinned notices, must match their declared byte count and digest in verification.
The new hair manifest's source entry changes to its actual input; its Worker,
model and SDK bytes do not change. No frozen v1 served file changes.

Before and after preparation, all eight v1 files were checked against cached
`origin/main` `290437f9fceef707a3673bc27ce6c4c2cee76100`: the model/SDK pins,
Git blobs for the Worker/notices, and that ref's manifest serialization. The v1
manifest remains SHA-256
`4ddc36005488fb2fde13b2af9f8e4a5a499979dc956aa91253ade23d7ab98310`.
A unit test locks that manifest digest (all paths, sources, sizes and hashes),
checks every Worker source directly, and checks exactly three releases/seven
assets each with totals 28,624,644 + 16,009,877 + 28,625,163 = 73,259,684 bytes.
The **72 MiB cap is proposed, pending owner approval**; it is not approved by
these tests or by the host's successful qualification of an earlier revision.
