# ADR-0338 — Dark local Photo Studio and vision asset admission

Status: implemented for host qualification; not activated. S0–S3; S3 amendment below.

Frozen work order SHA-256: `81d054aa1f9c50d8c4ed5c74ccb195a4c2c8e906ac99c18e4d3e362473383ce9`.
The checkout and cached `origin/main` are at `8bb562cfb`. ADR-0338 is free in
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

## S4 mobile amendment — offline still and short-clip frame editing

The unchanged S4 implementation and review amendments are retained in the
[S4 appendix](0338-photo-studio-s4-appendix.md).

## S4 review round 1 amendment

See the [unchanged review amendment](0338-photo-studio-s4-appendix.md#s4-review-round-1-amendment).

## Supported photo formats (S4 review round 2)

See the [unchanged format contract](0338-photo-studio-s4-appendix.md#supported-photo-formats-s4-review-round-2).

## S5a — web still-photo 2D wigs (D6, S5, binding R4)

Implemented dark on S0–S4 `395e3d030`. Web only: no mobile changes, 3D,
live camera, inference protocol/prefix changes, dependencies or activation.
**These are stylised placeholders that prove the pipeline, not photo-real wigs.**

Six original vector SVGs in `public/photo-studio/wigs/` are authored by Veyrnox
in code, licence `owned`. No image provider, Credits or third-party artwork is
used. `packages/live-edit/wigs.js` records IDs, literal name keys, dimensions,
forehead/temple/ear-adjacent anchor IDs/positions and file SHA-256 hashes. Assets
have transparent face openings and use only paths, local masks and local clips.
CI's `liveEditWigs.test.mjs` verifies every manifest entry, provenance, anchors,
hash and absence of executable/external resources. Same-origin Image loading
uses the existing sticker-compatible `img-src 'self'` policy; the real browser
proof decodes every SVG under the strict page CSP. No policy changes are needed.

Least-squares similarity fits all five anchors in source pixels (correct aspect),
with scale, roll and translation. Anchor membership is verified against installed
`@mediapipe/tasks-vision` **1.0.1** FACE_OVAL connections and `regions.js`.
234/454 are ear-adjacent face boundary points, not detected ears. Size is clamped
to 0.75–1.30 and vertical offset to ±0.15 fitted wig widths along the rolled axis.
A piecewise-affine mesh is omitted by judgment for these stylised placeholders;
face-width accuracy/realism is limited. The depth-difference pose proxy uses
234–454 for yaw and 10–152 for pitch, with z in x-coordinate units. It fades
smoothly from 20° to 35° and is off at 35° on either axis, with an announced
message. These are heuristic pose estimates, not calibrated physical angles.
Missing/invalid landmarks, face loss and multiple faces disable the overlay.

**R4 supersedes D6's hair-hiding wording.** The photo is never erased or
reconstructed. Source-over compositing preserves the source wherever the wig is
transparent; natural hair outside the silhouette remains visible. The hair mask
only feathers partially covered wig edges, measures uncovered natural hair and
drives existing recolour. Above 15% uncovered associated hair mass (minimum two
covered mask pixels), the UI announces the literal translation key whose copy is
“Tuck your hair or choose a longer style”. The estimate includes opacity and
pose fade; without a confident mask the UI explicitly reports unknown coverage.
Mask-grid sampling makes this an estimate, not strand-accurate segmentation.

The overlay is clipped by the face oval minus a shallow hairline cap (upper
oval pulled 12% toward the chin), plus expanded eye/brow/lip exclusions. Clipping
subtracts only from the overlay. Face below the hairline stays above the wig.
Overlay rasterization is bounded to a 1024-pixel longest edge before full-source
WebGL2 compositing; large exports can show soft edges. This explicit quality
limit bounds transient canvases without changing photo/export resolution.

Tint shares existing hair shades, mode and strength. Both natural hair and wig
use the same linear-light luminance-preserving recolour function. Web settings
extend the unchanged shared S4 tables so the mobile byte-sync contract is intact.
Wig style/fit/opacity/tint share undo/redo, compare and export. Opacity zero takes
the exact neutral bypass, and contributes zero arithmetic to an active GPU stack.
Export waits for the selected SVG and snapshots settings, even during compare;
asset failure refuses export. Source replacement/unmount cancels pending images,
releases canvases/textures and suppresses late updates. No animation is added.

Limits: front-facing stills only; side angles fade out. Hats cannot be removed;
glasses and ears are not separately segmented, so frames extending outside the
face oval can be covered. Long hair remains outside short styles; no background
reconstruction is claimed. There is no portrait-quality, latency or realism claim.

CPU proof covers anchors/transforms, clamps, pose, coverage, manifest/provenance,
history and asset/export ownership. The extended actual WebGL2 proof uses only
original synthetic fixtures, flat plateaus/relations (2/255 tolerance), exact
zero/compare/PNG checks, all six assets, protected features and the long-hair to
short-wig case. Every pixel/channel miss includes expected/actual; suite errors
are collected too. GPU/build qualification remains host work, not inferred from
CPU tests. See [S5a execution report](../face-filters/PHOTO-STUDIO-S5A-REPORT.md).

## S6 — web 3D wigs (owner approved three.js, 2026-11-12)

Web only, dark behind the same `photoStudio` flag. No mobile change (mobile 3D
is S9 and needs a native build), no Worker or CSP change, no Credits, no provider.
**These are stylised procedural wigs that turn with the head. They are not photo-real.**

**Dependency.** `three` 0.187.0 (MIT) is a pinned `devDependency`, not a runtime
import. `scripts/sync-three-vendor.mjs` copies its two ES modules into
`public/photo-studio/vendor/three-0.187.0/` with the licence and a SHA-256
manifest. The page loads them with a native dynamic `import()` of that same-origin
path (`webpackIgnore`/`turbopackIgnore`), only when a 3D style is first chosen
(about 2.1 MB uncompressed). They are never bundled, so the Worker script does not
grow and the bundler traps (jose, supabase-js, tsx) are not touched. They are
static Assets like the wig SVGs: public, ungated, no identity. `script-src 'self'`
already allows them; three.js needs no `eval`. `tests/liveEditWig3d.test.mjs` fails
if `package.json`, the loader URL, the manifest and `node_modules/three` disagree.

**Art.** Four wigs (pixie crop, bob, long hair, curtain fringe) are generated by
`buildWigMesh` from a few parameters: a dome, a skirt of chosen length and flare,
strand-streaked vertex colours. Provenance is `authored by Veyrnox in code`,
licence `owned`. There are no meshes or textures to license.

**Pose.** `headFrame` builds an orthonormal head frame from landmarks 234, 454,
10 and 152 (x right, y down, z toward the viewer, z in x units), no canonical
face model needed. The mesh sits in local units (x,z in half head widths, y in
face heights) and one matrix places it. This is a landmark-depth heuristic, not a
calibrated camera pose. A depth-only head proxy hides the part of the wig behind
the head. Size and vertical offset reuse the 2D controls. The wig fades from 40°
to 62° of yaw or pitch (3D turns with the head, so later than the 2D 20°-35°).

**Never over the face.** The face opening is cut per pixel in the fragment shader
(`faceWindowGlsl`, the same constants as the tested `inFaceWindow`), so the
hairline is a smooth curve at any photo size; a grid-based cut left teeth the size
of a grid cell. The existing 2D carve (`carveFace`: face oval minus a shallow cap,
eyes, brows, lips) then runs on the rendered overlay as a backstop. The photograph
is never masked or erased. Natural hair outside the wig stays visible, uses the
same hair-mask coverage estimate and shows the same "tuck your hair" hint. The
wig is tinted by the existing wig and hair tint controls.

**Integration.** `createWigLayer` hands 3D styles to `createWig3dLayer`, which
returns the same `{active, image, opacity, coverage, status}` the 2D layer does, so
the renderer, history, compare, export and live camera paths are unchanged. Settings
accept 3D ids only through the web normalizer `normalizeWigWeb`; the shared 2D
normalizer that mobile uses does not learn them. The overlay is drawn on its own
offscreen WebGL context (a second context only while a 3D wig is chosen) and copied
to a 2D canvas, so the colour and alpha path matches the 2D wigs exactly. The context
is released when the layer is no longer needed (see Failure and lifecycle).

**Failure and lifecycle (inspection round 1).** `prepare()` rejects with
`wig-unavailable` when the module download or graphics start fails, so an export is
refused like a failed 2D wig asset, never silently wigless; `render()` never throws
and reports `unavailable`. A lost WebGL context drops the cached overlay and reports
`unavailable` until three.js restores it, then asks for a redraw; an empty frame is
never cached as a wig. A render that throws releases every GPU object (renderer,
geometries, materials, listeners, the canvas) and the next `prepare()` rebuilds from
scratch. Choosing None or a 2D style closes the 3D layer and its WebGL context after a
1.5 s pause (hold-to-compare draws the plain photo for a moment and must not destroy
the layer or cancel an export that is waiting on it); the downloaded module stays
cached. `prepare()` also draws the chosen wig once, and a shader compile/link failure
(three.js logs it, it does not throw; captured through `debug.onShaderError`) rejects
the export and is never cached as a wig. A preparation that outlived a closed layer is
redone against the current one. The shader squares by multiplication, because `pow()`
of a negative base is undefined in GLSL ES. The browser proof checks rows only the
shader decides (under the hairline, above the carved face, both sides of the centre
line) and exercises context loss, a failed render and release; a mutation run showed it
catches a broken left half and a mishandled lost context. Compare while the module
download is still pending is not covered by an automated test (the module is cached
after the first load in the proof page). Note: the proof's software
GPU squares negative numbers correctly, so it cannot show the `pow()` bug itself.

**Rollback.** Remove the four `WIGS_3D` buttons; nothing else depends on the module.

**Not verified here.** Phone speed and memory with a second WebGL context, the live
camera with a 3D wig at frame rate, real faces (the proof uses a synthetic face),
Safari/iOS, and any look beyond "reads as a wig on a synthetic face".

## S8 and S9 — mobile live camera and mobile 3D wigs (owner: "complete the build", 2026-11-13)

Mobile only, dark behind `PHOTO_STUDIO_ENABLED` (still `false` in the committed source; flipping it is a release decision).
**No new native module, no native rebuild for the code itself, no Credits, no provider.** Nothing here has run on a phone or
in a WKWebView/Android WebView yet; it was proved only in desktop Chromium from a `file://` page, in software Skia and in jest.

**Decision (S8): the camera lives in the offline WebView, not in a native camera library.** The app has no camera module
(no expo-camera, no vision-camera, no worklets), and the only camera path a native build offers without one is the system
picker. The existing offline WebView document (`assets/live-edit/runtime.html`, which already runs the pinned MediaPipe face and
hair models for stills) now also contains the web live engine (`liveEngine.js`, `renderer.js`, `camera.js`), bundled by
esbuild from the same source files as the web studio, so mobile and web cannot drift. A visible WebView (`LiveCameraView`)
shows its canvas; the screen's own controls send the effect settings as JSON. Rejected: vision-camera plus Skia frame
processors (new native module and rebuild, worklets, blind to test without a device), expo-camera (new native module, snapshots
only). Cost of this choice: MediaPipe runs in WASM on the CPU inside a WebView, so frame rate on a phone is unknown until
measured, and `getUserMedia` from a local `file://` document in WKWebView / Android WebView is the main unproven risk.
The code reports `camera-unsupported` or `camera-blocked` honestly and the person can still pick a photo.

**Permission and privacy.** `ImagePicker.requestCameraPermissionsAsync()` (already installed) runs before the WebView is
mounted: a denied permission never reaches `getUserMedia`. The WebView has `mediaCapturePermissionGrantType="grant"` and inline
playback; the hidden still-photo WebViews have neither. The page requests video only (`audio:false`), starts only after the
person taps Live camera, stops on Stop, on a hidden page and when the app leaves the foreground, and unmounting destroys the
WebView (which releases the camera). Frames never leave the document: CSP is `default-src 'none'` with data: only, no
network, and the Playwright proof asserts no non-`file:`/`data:` request. Take photo sends one JPEG (about 1 MB) over the
bridge; it is validated (bounded base64 JPEG data URL, id matched to the pending request, one answer per request), written
to the cache and sent through the normal still flow, so hair recolour and wig coverage work at full quality; the cache copy
is deleted afterwards. Hair recolour is not run live (16 MB model, same as web).

**Protocol.** Every reply from the page is untrusted: strict allowlists for statuses and error codes, size caps, malformed
messages ignored; an unknown error code becomes the generic failure rather than being ignored (a dead camera must be shown).
`liveMessage` normalizes the settings stack before sending. The page adds an `error.detail` (underlying error name/message,
no user data) only for diagnosing a device that reports a generic code. A 90 s start timeout covers decoding the ~40 MB of
models on a slow phone.

**Fix found on the way (S4 correction).** The S4 runtime loaded MediaPipe's WASM through the `module` loader variant
(`vision_wasm_module_internal.js`, which uses `import.meta`) from a classic script, which can never run in a page
("ModuleFactory not set"): the S4 hidden runtime could not initialise on any device. It now uses the classic variant
(`vision_wasm_internal.js/.wasm`), pinned by size and SHA-256 in `prepare-live-edit.mjs` (not added to the shared web asset
inventory, so the web asset budget is unchanged). S4's claims about on-device inference were therefore unverified, and
the first real run was in this change.

**S9 — 3D wigs on mobile.** In live mode they are the same engine as web (three.js is inlined in the document as
`globalThis.__veyrnoxThree`; the layer prefers it over its dynamic import; the 2D wig art maps to inlined `data:` images through
`globalThis.__veyrnoxAssetUrl`). For a still photo the hidden WebView renders the overlay: the app sends the landmarks and
the photo size, the page returns one full-image RGBA PNG (already fitted and face-carved by the same code as web), and Skia
composites it in `planWig`/`drawWig` exactly like the 2D wig, so preview and save stay one code path (tested byte-identical).
The overlay is rendered at strength 1 and the app applies strength and the pose fade, so one overlay serves every strength.
Overlays are cached by style, size, offset, photo size and a hash of the landmarks (four kept); a different slider value needs a
new overlay, requested after the slider settles, one request at a time, latest wins, 30 s timeout then `unavailable`. Save is
disabled while a 3D wig is still loading. `Stack`/`normalizeStack` accept the four 3D ids on mobile through the same wrapper the
web uses; the shared 2D normalizer is unchanged.

**Dependencies and size.** `three` (MIT, root devDependency) is bundled into the runtime document by esbuild at build time;
its licence text is carried inside the document and as `THREE-LICENSE.txt` beside it (esbuild drops legal comments).
`prepare-live-edit.mjs` now also requires the web engine sources and three at build time (monorepo root, as before).

**Inspection round 1 (S8/S9) and what changed.** (1) Camera capability is per document: only the visible view loads the page
with `#live`; every other document (the hidden still and 3D-wig views) has `getUserMedia` replaced by a function that always
refuses, rejects every `live.*` operation, and iOS capture is denied explicitly. Android's WebView grants capture whenever the
app holds the permission, so on Android the in-page refusal is the control, not the prop. (2) Replies are checked against their
own headers before anything decodes them: the PNG/JPEG header must state the claimed size, within a budget (overlay: at most
1024 on a side and exactly the size the request implies; camera photo: at most 4096 on a side and 8.5 megapixels). (3) An
export pins the overlay it starts with and refuses, instead of silently omitting the wig, if it is missing. (4) A crashed or
stalled hidden 3D view is terminal: the request in flight, the one waiting and every later one end as `unavailable`, and a
document that does not finish loading in 45 s does the same. (5) `live.stop` during start-up cancels the start before the camera is
opened (a generation counter checked after every await); the proof fails without that check. (6) A partial fade draws the
wig faded, as the 2D wig does; only a fully faded one (fade 0) draws nothing. (7) The runtime manifest records a SHA-256 for every
bundler input and embedded asset (36 files: the web engine, the shared packages, three.js, the wig art), and Metro refuses a
stale runtime after any of them changes. (8) A capture that cannot be written deletes its partial cache file. (9) A camera
error no longer hides the still-photo status after another photo is chosen.

**Inspection round 2 (S8/S9).** (1) `react-native-webview` hands every URL outside `originWhitelist` to the OS browser BEFORE
asking `onShouldStartLoadWithRequest`; all three views therefore use `originWhitelist={['*']}` and let the strict callback be the only
gate (a page that tries to navigate to a web address with captured data in it is refused, not opened). (2) The callback now
also requires the exact fragment for the view's role: hidden views reject `#live`, so a hidden document can never reload itself
as the camera document; the camera view accepts only `#live`. The page closes `getUserMedia` on the instance and on
`MediaDevices.prototype`, non-writable and non-configurable. **Residual, stated plainly:** on Android the WebView grants capture
whenever the app holds CAMERA and the iOS deny prop does not exist there, so the platform does not enforce the boundary; the
control is that every byte of page code is ours and shipped inside the app, the CSP forbids network and external scripts,
navigation is locked, and the camera call is closed in code. Code execution inside a hidden document would defeat it; no such path is known.
(3) Base64 length must be a multiple of 4 and a decode failure is caught at the cache boundary: the overlay ends as
`unavailable` and the next request still goes out. (4) Returning from the background with the camera closed no longer shows the
still-photo loading message.

**Not verified.** Any phone, WKWebView or Android WebView behaviour; camera frame rate and thermals; the 90 s start budget;
Android WebView camera permission handling; background/foreground transitions with the camera on; 24 MP 3D overlay time and
memory; looks as a live camera filter list (the strip shows plain tiles without a photo). The real-device test is the next
step.

## First phone test feedback (owner, 2026-11-13) — Apple-style editor and realistic wigs on mobile

**What the owner found on an iPhone 17 Pro Max.** The editor works. The 3D wigs "don't look real", and the tools were expected to "look and feel like
what Apple would give you to edit a picture".

**Decision 1 — wigs on mobile become the existing AI wigs.** The 2D and 3D wigs are code-drawn, stylised shapes. They cannot look photo-real, and more
tuning would not change that. The mobile editor no longer offers them. The wig engine, its tests and the web photo studio are unchanged; a hidden wig
in a saved stack still renders and exports. A new **AI wig** tool opens the existing Face Filters flow, whose `face-costume` model already draws
`wig_blonde`, `wig_pink`, `wig_curly` and `wig_powdered` on a photo. That flow shows the catalog price, asks for consent and uploads the photo, so the
editor itself still never uploads anything. The owner chose this over licensed wig assets (live, free per use, but needs art we do not have) and over
dropping wigs.

**Photo hand-over (follow-up, same day).** Opening the tool offers the current photo to Face Filters once. The editor makes its own JPEG copy
(the editor keeps full-size PNGs, which can exceed the server's size limit), `faceFilterHandoff` holds it for the signed-in account only, and Face Filters
claims it on open, validates it like a picked photo (type, size, resolution), owns it and deletes it like any picked copy. An unclaimed copy is deleted when
replaced, cleared or claimed by another account. Face Filters opens on the `face-costume` model with `wig_blonde` selected when the catalog offers it,
so the person only chooses a style and runs it. Opening the tool from the live camera releases the camera first. The effects already applied in the
editor (makeup, hair colour, looks) are not baked into the photo that is sent; the AI model works from the original. **Limit:** more styles than the
four server wigs need a new catalog row and a verified provider endpoint, which is a separate decision.

**Decision 2 — Apple Photos layout.** The screen is one photo that fills the space, a top row (photos, camera, undo, redo, save), and a dock with a tool
strip (Looks, Retouch, Makeup, Hair, AI wig) whose selected tool opens its panel above it. Touch and hold the photo to see the original; for a screen
reader the photo has an activate action that toggles the comparison. Sliders became a ruler-style **dial**: the ruler slides under a fixed needle, a
haptic tick fires every 5%, and a screen reader steps by 10% with increment and decrement. Makeup shades and hair shades are round colour dots taken from
the engine's own shade table, so a dot is exactly what gets painted. Live camera keeps a shutter button with Stop and Switch camera either side.
Text uses the type ramp and spacing uses `ds.space` steps; no colour literal was added outside the engine's shade data.

**Verified.** Dial maths (drag direction, needle position, haptic steps, clamping, screen-reader steps) and the panels (hair colour locked until a hair mask
exists, makeup locked without exactly one face, second shade only for ombre and highlights, the AI wig button opening `/face-filters`, the tool strip)
have unit tests. Typecheck, the translation checks in all 11 languages and lint (0 errors) pass.
**Not verified.** How it looks and feels on the phone, including dial responsiveness and haptic strength, 375 pt widths, Dynamic Type at the largest size,
VoiceOver, and light versus dark appearance. The web photo studio still has the older stacked layout and the 2D and 3D wigs.

## Web photo studio follows the same decisions (2026-11-13)

**Tabbed panel.** The right-hand controls were one long stack. They are now four tabs (Adjustments, Virtual makeup, Hair recolour, Stickers) and only the
chosen tool is shown, like the Photos editor. The tab row is a real tab list: arrow keys move and focus the next tab, Home and End jump, only the chosen tab
is in the tab order, and the panel is labelled by its tab. The tool's own heading became screen-reader-only so the name is announced once. The tab row
follows the width of its own panel (one column when very narrow, two, then four), because at a 1024 px screen the panel is only about 160 px wide and four
tabs in a row clipped "Hair recolour" and "Adjustments". The logic of the keys lives in `_lib/liveEdit/tabs.js` and is unit-tested.

**Wigs leave the web panel too.** For the same reason as on mobile (code-drawn wigs cannot look photo-real), the 2D and 3D wig controls are no longer shown.
The layers, their tests and a saved wig setting are unchanged, so this can be reversed by re-adding one component. There is no web AI-wig flow to hand
over to: the `face-costume` model is staged (migration 0445) and the web has no Face Filters screen, so the web has no realistic-wig option for now. The
camera help line no longer says "wigs".

**Verified in a real browser (desktop 1024 px and phone 375 px, dev server):** the tabs fit without clipping and the page does not scroll sideways; a click
selects a tab and swaps the panel; the arrow keys, Home and End move the selection and focus; and no wig text appears in the panel.
**Not verified:** a signed-in session (the sign-in dialog was hidden for the layout check only), a real photo and face on the page, contrast in dark mode,
Safari, and VoiceOver.
