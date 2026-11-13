# ADR-0338 amendment S5b — 2D wigs in mobile Live Edit

Status: implemented and dark. Mobile Live Edit stays behind `PHOTO_STUDIO_ENABLED` (default false); this adds no flag, permission, native module or dependency.

## Decision

Mobile Live Edit gains the same six stylised wig overlays as web Photo Studio (S5a), fitted from the same face landmarks with the same maths. A wig is drawn over the finished picture, once, by the one shared `renderEffectStack`, so the on-screen preview and the saved image always agree.

## What is shared with web, and how drift is prevented

`packages/live-edit/wigs.js` (manifest, anchors, SHA-256 per art file) and `wigFit.js` (similarity fit, pose fade, protected-face polygon, coverage and edge maths) are copied verbatim into `apps/mobile/src/lib/liveEdit/shared/` by `scripts/sync-live-edit.mjs`, with the existing byte-for-byte parity test extended to both files. Nothing about fitting is re-implemented on mobile.

## Art delivery (and why PNG, not SVG)

The web art is SVG. React Native Skia on a phone can draw SVG natively, but its software build used for tests parses SVG through the browser DOM and cannot rasterise it in Node, so SVG drawing could not have been tested at all. The sync script therefore pre-renders each SVG to a 1024×1280 PNG and embeds all six (about 0.4 MB, 0.54 MB as base64) in the generated `shared/wigAssets.js`. Each entry records the SHA-256 of the SVG it was rendered from; a jest test checks it against the manifest and against the SVG on disk, so a changed web wig fails mobile until it is re-synced. `--check` verifies hashes and dimensions without re-rendering (PNG bytes differ between rasteriser versions). The images are decoded once per style. The art is the owner-approved original placeholder set from S5a, not photo-real wigs.

## Rendering

After the shader passes (look, smoothing, makeup, hair colour) the wig image is drawn with the similarity transform, clipped so eyes, brows, mouth and the face below the hairline stay uncovered (`protectedFace` plus the feature polygons, the same ones as web). Opacity is the strength times the pose fade; a head turned too far fades the wig out entirely. Tint reuses the chosen hair shade as a **luminance-preserving colour matrix**, so the wig keeps its own light and shade and transparent pixels are never tinted (a blend-mode filter would colour them). The web's ombre and highlight modes are not applied to the wig on mobile; it takes the solid shade.

## Natural hair is never removed

As on web (R4), a wig never deletes or reconstructs the photographed hair. If the hair mask shows hair left outside the wig, the screen says "tuck it in or choose a longer style". Coverage is measured from the wig's real silhouette sampled on the hair-mask grid. Without a hair mask the status is "coverage unknown", not "ready".

## Verified (software Skia, not a device)

`scripts/proof-live-edit-skia.mjs` renders all six wigs through the real Skia pipeline on a synthetic face: each changes the picture; **no pixel inside the protected face, eye, brow or mouth polygons changes**; a pixie sits above the face; preview and export are byte-identical; strength 0, a lost face, two faces and a too-turned head draw nothing; opacity and size are real controls; the tint never reaches pixels the wig does not cover; and the coverage hint obeys its relations (`ready`, `uncovered`, `coverage-unknown`). jest covers asset integrity, the clamps and unknown-style rejection, undo/redo and the tint matrix.

## Not verified

Rendering on a real iPhone or Android device, frame cost, and memory (a 24 MP photo plus a 1024×1280 wig image) are untested. The software proof is not a claim about iOS or Android drawing. The wig is not shown on live video: mobile Live Edit is photos and chosen clip frames only (the camera slice, S8, is separate).
