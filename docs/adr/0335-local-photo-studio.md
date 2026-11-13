# ADR-0335 — Dark local Photo Studio and vision asset admission

Status: implemented for host qualification; not activated. S0 and S1 only.

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
