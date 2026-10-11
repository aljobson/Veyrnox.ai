# Person finishing — 11 October 2026

Status: implemented and locally verified; production release pending.

## Behaviour

Person and body tools adds independently selectable face/body reshape and directional person lighting. The existing isolated, pinned MediaPipe person runtime supplies semantic masks. Reshape uses a smooth inverse 2D warp with bilinear premultiplied-alpha sampling, bounded width/height changes, smoothed region bounds and a cut reset. Face uses a confident face region inside the largest person; body uses that person's silhouette. Lighting uses a bilinearly sampled foreground matte, linear-sRGB exposure, light direction/colour and ambient light. These create ordinary separate MP4 clips. Original source bytes remain unchanged, insertion participates in normal Undo, and existing project metadata saves processed clips through the existing relink contract. No schema, remote provider, price, CSP permission or production flag is added.

## Evidence

All 21 focused geometry, lighting, vision and Worker tests passed; meaningful pixel checks measure narrowing/widening and directional brightness, boundary/background/alpha preservation, invalid input and no-region identity. Product files passed ESLint.

Actual local browser processing of a licensed public NASA person fixture, with an original synthetic AAC tone added locally, produced face, body and lighting results. Each contained 60 H.264 pictures at 1280×680/30 fps over two seconds plus AAC at 48 kHz. All fully decoded. Each decoded PCM SHA-256 equalled the source: `537d792cc3bc643997da4638c639c61c4894e0e9f00318ec55b0f5e656e74255` (192,000 bytes). No footage was sent to a provider.

Explicit local Reticle consequences passed for face/body processing, result insertion/Undo, lighting completion, cancellation (enabled editor, no stale result/extra clip), and refusal of original synthetic footage without a detected person. Reticle coverage was partial for unrelated virtualized rows; hosted Reticle attachment is unavailable. A preliminary hidden-result lighting assertion failed after HMR collapsed its disclosure; reopening it passed the unchanged visible-result assertion. Old affected-flow failures and unknown preparation steps remain preserved; none counts as success. Native browser controls independently started processing and downloaded results.

## Limits

Up to ten seconds and the existing 720p processing bound; no person-region result is emitted when every frame lacks a reliable region. Largest-person tracking is not identity tracking across cuts or overlapping subjects. This is region-based 2D reshaping, not fine eye/jaw landmark controls. Nearby background can bend. Lighting does not recover depth, normals or cast shadows. Inspect edges, highlights, occlusions and movement. Longer footage, multiple people and wider device/quality qualification remain open. These controls do not establish full CapCut parity.
