# ADR-0351: Swap templates on Kling O1 with an approved local result clip

Status: Accepted for dark implementation; owner activation pending
Date: 2026-11-17

## Decision and evidence

Add a server-owned clip path for non-blocked template contracts whose source
prompt satisfies `swapNeedsSourceVideo`. The catalog offer is
`kling-o1-reference`, endpoint `fal-ai/kling-video/o1/video-to-video/reference`
(ADR-0301). The owner’s paid probe successfully replaced the person in a
community creator's finished generation using one reference picture. The
recorded price evidence is $1.68 per 10 seconds; the existing catalog charges
47 credits per 5 seconds and 94 per 10 seconds. No price is changed here.

The source audit establishes 127 eligible swap templates, 56 with a recorded
source and 71 without one. The recorded clips match the published showcase
results, not original input videos: `result_clip_not_original`. The original
inputs are not recorded. This finding does not automatically approve any clip.
No candidate names, private source URLs or real clip hashes are published here.

Use the local `public/showcase/<previewFile>` resolved through `TEMPLATE_CLIPS`,
checking its hash against `localPreviewSha256` in the two source audits. The
recorded CDN is outside ADR-0331's allowed host. The importer has no network
source or download fallback. Existing showcase clips provide a five-second
window, have no audio, and need explicit upscaling to meet O1's minimum side.

## Request, admission and replay

`POST /api/v1/generations` accepts `template_swap: "<template id>"` only through
its own gate. `template_swap`, `template_clip` and `swap` are mutually exclusive;
multiple fields return 400 `template_source_conflict`. Without the new field,
the existing template guard still returns `template_blocked` for these recipes.
The new path bypasses the template recipe check and initial generic input
validation, then validates its own contract and the effective inputs.

`TEMPLATE_SWAP_CLIP_ENABLED` is on only for exact `"true"`. It ships absent from
`wrangler.jsonc`; no binding is added. Off or unpublished returns 404
`template_swap_not_found`, never a silently ignored field. Both the public
approved-id registry and server manifest ship frozen and empty.

Availability requires an eligible registered contract, a valid manifest, and
the exact catalog offer active with no gated flag, matching provider and
endpoint, a known capability and positive integer `credits_5s`. There is no
fallback catalog row. Container and video-stream lengths are each 3–5.05 seconds:
the route always prices one 5-second unit (47 credits) and sends duration 5, so a
longer admitted clip could be billed for less than it costs (inspection F1). The
capability's own 10-second maximum still applies through `checkSource`; 5.06 is
refused by the validator. A 10-second output is a separate priced follow-up. Both sides must be
720–2160. The importer, gate and admission all call `checkSource`; the new
validator additionally caps the video-stream duration because the shared helper
only caps container duration. Versions, hashes, keys, MIME, size and frame rate
are validated before signing the manifest key for 900 seconds.

Exactly ONE image reference and `consent === true` are required. Client videos
are refused in inputs, top-level fields, slot references and video upload keys.
O1's capability permits two pictures, but this path intentionally uses one,
independent of whether `MULTI_REFERENCE_ENABLED` is absent or `"true"`. A supplied
duration must be five seconds. Ownership, media inspection, rate limiting,
consent recording, catalog pricing, debit and refund remain on the existing
shared paths. The provider receives `video_url`, `image_urls: [photo]`,
`duration: '5'`, `keep_audio: false` and `aspect_ratio: 'auto'`.

Jobs retain `{template, version, sha256}` in `inputs.template_source`, never the
signed URL, and have no preset ranking attribution. Replay compares effective
inputs and the photo plus the stored source identity. Known changed revisions
conflict. A removed manifest still allows an authenticated accepted job to
replay while the feature switch is on, without signing, charging or dispatching.

`GET /api/catalog?template_swap=<id>` is anonymous and no-store. It returns only
`{id, model, credits, durationSeconds}` or 404; it reads no identity header and
exposes no source key, URL, hash or version.

## Prompt decision and deviation from the earlier brief

The effective prompt is always this constant (amendment 1 below replaced the first probe's wording):

> Replace the main character in the video with the person in the reference image or images. The new person's face must match the reference exactly: same face shape, jawline, forehead, nose, lips, eye shape, skin tone, hairline, hair and facial hair, and the same natural expression character. Do not slim, smooth, retouch, beautify or idealise the face, and do not change the person's age or features. Keep the same body build and clothing as in the reference. Keep the video's motion, camera, scene, lighting and timing unchanged.

It contains no `@Video1` or `@Image1` tags. Extending `templateBinding.js` with
unproven tagged wording would change the proven behavior; that earlier brief
is explicitly superseded. Tagged wording remains an owner probe option.
`templateBinding.js`, `templateSwapGuard.js` and `templateFidelity*.js` are
unchanged, and their dependency graph imports none of the new modules.

## Private review and import

Two steps. (1) Review: write a private decisions file `[]` (an array of `{id,
approved}` entries is also accepted) and run
`scripts/import-template-swap-clips.mjs --decisions <private.json>
--out-dir <private-directory> --upscale --review-all`. This builds clips, contact
sheets and reports for every record-backed candidate and writes
`decisions-template.json` (all `approved:false`, each with the reviewed `sha256`).
(2) Publish: copy that file outside the repo, set `approved: true` on accepted ids
(keep their `sha256`) and run with `--upload --confirm-bucket <name>`. Only literal
`approved: true` is processed for upload; an upload refuses a clip whose fresh
hash differs from the reviewed one (`reviewed_hash_mismatch`), refuses any run in
which an approved clip fails or none is approved (`approved_candidates_failed`),
and `--review-all` is refused with `--upload`. Unknown
or duplicate ids are refused before any media work. Decisions and output paths
must resolve outside this checkout, the main checkout and all linked worktrees,
including symlink-resolved ancestors. Fresh run directories contain all reports
and generated media; originals are never copied out. Showcase symlinks cannot
escape the showcase directory.

The separate normaliser requires `--upscale` for a short side below 720, uses
Lanczos scaling with even dimensions and preserved aspect, refuses any result
above 2160, and encodes the first five seconds as H.264 yuv420p. Audio and metadata
are stripped, frame rate is clamped to 24–60 and MP4 faststart is enabled. The
5.05-second cap applies to the measured normalized output; longer raw inputs are
trimmed as required. Existing swap-scene no-upscaling behavior is unchanged.

The private pack includes normalized MP4s under `clips/`, six-frame contact
sheets, combined index sheets with ordered ids in `report.json`, Markdown and
JSON reports, and `decisions-template.json` with every eligible id set false.
Reports distinguish `result_clip_not_original`, `showcase_hash_mismatch`,
`no_source_record`, `too_short`, `too_large` and `ok_for_review`. Processing
refusals such as `source_resolution_too_small` retain a specific reason. A
successful review candidate still retains `result_clip_not_original` as its
verification finding. Reports include the prompt, measurements and likeness note.

`--upload --confirm-bucket <name>` is owner-run only, using environment R2
credentials, conditional `onlyIfAbsent` writes and full hash-verified read-back.
Only after every approved candidate and upload verifies are candidate registry
and manifest files emitted in `publishable/`; the registry is rendered from the
manifest keys whether the installed list is empty or already populated. No runtime source file is
installed automatically. Tests use synthetic ffmpeg media and mocked R2 only.
The builder does not run the real review pack or any real upload/provider call.

## Rights, remaining work and verification limits

A result clip may contain third-party likenesses. Approval is an explicit owner
rights and moderation decision; a successful hash or O1 probe is not rights
clearance. The owner must review the private pack and approve individual ids,
confirm the five-versus-ten-second price decision, perform the paid staging
probe with billing/refund evidence, introduce the catalog activation migration,
free a binding and flip the feature switch. Client UI is separate work.

The coordinator runs the local-only review over the real 56 clips after this
build; no real-data review is performed by the builder. No catalog activation,
migration, price update, flag flip, web/mobile UI or publication ships here.

Repository indexing now freezes the historical ADR README, baseline and pinned
line hashes. This ADR uses `scripts/adr-index.mjs` discovery instead of editing
those frozen files, a deviation from the work order's historical index edit.
The supplied checkout's Worker-size script uses 60,500 KiB, whereas the work
order mentions 59,000 KiB. No budget is changed; a size check needs compiled
OpenNext output, and absence of that output must be reported rather than
claiming a bundle-size proof.

## Amendment 1: face-fidelity wording (2026-11-17)

The first probe's wording ("Keep the new person's face, hair, clothing and body exactly as in the image") returned a face that was slimmer, smoother and wide-eyed against the owner's photo. Two paid fal tests (5 s each, $0.84 each, on the owner's account, same clip and photo) compared alternatives. A: the wording above with the single full photo kept the squint, brow furrow and face shape much more closely. B: the same wording plus a second reference, a close head-and-shoulders crop, was closest and also kept the smirk and ears. The face is a small part of a full photo, which is why the crop helps.

This is the shipped wording. It is generic (no per-user detail), is 529 characters against a 2000-character prompt limit, and `tests/templateSwapClipPrompt.test.mjs` pins the exact text and length. Evidence is two clips judged by eye on one photo: it improves likeness, it is not a pixel or identity guarantee, and results will vary by photo and clip.

Follow-ups, not built and not decided here:
- Second reference (face crop). Two pictures need `MULTI_REFERENCE_ENABLED` and a change to the one-picture admission rule in `checkTemplateSwapRequest`. A server-side or UI face crop is a separate owner decision (privacy, cost, a face detector on the Worker).
- A UI hint to use a close, front-facing photo, with the face large in frame, until a crop exists.
