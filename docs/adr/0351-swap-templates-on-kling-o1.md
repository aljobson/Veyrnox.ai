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

## Amendment 2: every template that needs a source clip (2026-11-17)

The owner asked for the same fix on all video templates that need a clip, including the hidden ones. The server path needed no change: the gate admits any id in the registry, and the route skips the template contract only when `template_swap` is present, so a video-blocked template runs through the same path once a clip is registered, and is still refused (`template_blocked`) without one or with the switch off. What widened is the importer's candidate set (`swapCandidates`), which is now every template with a preview clip that needs a source video, in three kinds:

| Kind | Meaning | Count | Tier |
|---|---|---|---|
| `swap` | swap wording, refused by the swap guard | 127 | A (clip hash vouched for by an audit record) or B (no audit record) |
| `video_swap` | swap wording, also refused by the video guard (`blocked-needs-video`) | 300 | C |
| `motion` | video-dependent, no swap wording (motion transfer, "imitate the movement") | 92 | D |

Total 519. The counts are pinned in `tests/templateSwapClipImport.test.mjs`. Of the 1,926 addressable video templates only 150 are listed in the gallery; the rest are hidden from it but still addressable by id. All 300 `video_swap` and all 92 `motion` templates are in the hidden set, as are 43 of the 56 tier-A and 12 of the 71 tier-B templates, and 238 templates carry the Seedance label (35 `video_swap`, 20 `motion`, 3 `swap`); the importer treats them like the rest. Tier D has the weakest fit for O1: the shipped wording asks for a character replacement, and a motion-transfer recipe may need its own wording and a paid probe before any D clip is approved.

Verification no longer depends on an id match. The importer hashes the showcase file and looks the hash up in every audit file that records `localPreviewSha256` (`higgsfield`, `seedance`, `syntx`, ...); a record found by id must match the bytes exactly. A clip with no audit record is tier B/C/D `no_audit_record`: it gets the structural checks (MP4, size, 3 to 5.05 s, 720 minimum side after the explicit upscale) and a first-frame similarity score against its own published poster, and the review pack shows it for owner eyes. The score is an aid only and never approves anything.

Rights, stated plainly: every clip is another creator's finished video (a result), not the original input, and often shows a real person, a recognisable brand or a licensed character. Nothing is approved by the tooling. The owner decides per clip (`approved: true` with the reviewed hash), and the report labels every clip "RESULT CLIP, NOT THE ORIGINAL INPUT". Clips whose audit origin is the Syntx trend feed are excluded by default (`origin_excluded`; `--include-syntx` opts in), because ADR-0333 keeps Syntx media out of import sources.

Duplicates: a normalised-prompt comparison across the 1,926 addressable video templates finds 6 pairs sharing a prompt and no two templates sharing a clip key or showcase bytes. Removing them is a catalog change (which id stays, redirects for the removed id) and is not part of this PR.

## Amendment 3: token grammar, dark photo wording and hidden inventory (2026-11-17)

The frozen PLAN2 work order (SHA-256
`1421ad6b998799aca833e20e4a3afc3c6002a89ed17f353d8c760f2a59626072`)
is implemented with the inventory corrections below. No gallery, capability,
price, manifest, migration or activation changes are made.

### Image and video references

`@image` is case-insensitive and accepts digits or a single `x`/`X`, with
optional whitespace and `_`/`-` separators and a trailing word boundary.
`@images`, `@imagery` and `@image-xyz` are not slots. Existing triple-angle,
image filename and capital `Image N:` labels retain their grammar. Explicit
numbers across all forms reserve their numbers first. Each x occurrence is a
new slot using the next unused positive number, even when the same x token
occurs twice. Bare `@image` means slot 1 only without any numbered or x token;
otherwise it remains unmapped and binding refuses the prompt. Binding still
maps distinct resolved numbers by first appearance to `@Image{slot}`, retaining
the original token bytes and offsets in the map. The shared mobile/client
reader uses this same binder.

The existing catalog uses none of the changed forms. A test regenerates the
compressed fidelity JSON through the audit's serializer and compares the exact
bytes, not just decoded rows. All bytes and classifications remain unchanged.
Video forms `@video`, `@video1`, `@video_1`, `@video-1`, `@Video 1` and
`<<<video_1>>>` remain source-clip evidence: photo admission refuses them.
Only a registered clip, enabled swap switch and active O1 offer can admit the
separate `template_swap` request. No video token is sent in the O1 prompt.

### Submit-only face wording, dark by default

`lib/templateFaceWording.mjs` owns the full amendment-1 face sentences and a
one-sentence compact variant. The O1 constant composes the full sentences and
remains exactly 529 characters; its existing byte pin remains unchanged.
The photo path uses `APP_RUNTIME_FLAGS.templateFaceWording`, parsed by the
existing `lib/appRuntime.js`. Missing, malformed or false means off. No new
Worker binding or wrangler setting is added.

After validation, source resolution, debit/storage and the replay return, the
route passes a non-persisted `faceIdentity` submit option for audited bound or
like-for-like-safe Kling 3.0 I2V requests carrying a photo. The adapter copies
the shaped payload and changes only its prompt. `modelInputs`, job inputs,
contract hashes, fingerprint and replay identity stay unchanged. Non-template
requests are unchanged. O1 carries the full sentences regardless of this photo
gate; the adapter does not append them twice. Its own swap switch still ships
off. Reference video jobs do not enter the text-to-image durable outbox and
cannot hop suppliers. The repository's `kling-3.0-i2v` offer is fal-backed;
Kie's `kling-3.0-i2v-kie` is a different offer and is out of scope.

The capability records expose 30,000 characters, while the Kling v3 I2V example
in `docs/model-capability-registry/SPEC.md` and O1's ADR-0301 document 2,000.
Use 2,000 as the conservative wording budget: full wording plus a space if it
fits, otherwise compact wording plus a space, otherwise the original prompt
unchanged and a `face_wording_omitted_length` log with job id (no prompt/photo).
Never truncate or reject an original prompt because of this augmentation.
The owner inventory lists all 53 bound prompts already over 2,000, including
`jellyfish-airlines` at 5,814. Correcting the capability discrepancy or rejecting
long prompts before debit is a separate behavior decision. This wording can
lengthen prompts and is only a mitigation: two paid runs judged by eye on one
photo, not a likeness guarantee. No paid tests are run for this amendment.

### Offline inventory and provenance corrections

`scripts/report-hidden-templates.mjs <outside-directory>` writes exclusive
`hidden-templates.json` and `.md` files outside all checkouts. It lists every
hidden addressable id, its class, swap wording, provenance, local preview,
contract model/allowed models/references and route fit. Route fit follows the
contract, not the legacy display label. It also lists all 200 origin records,
the 238 Seedance-labelled video ids with their actual contract routes, long
bound prompts, and the exact 447 hidden ids eligible after clip approval and
activation. Swap A/B tiers use actual local hashes against audit records; C/D
retain the importer's classification. This neither approves nor publishes clips.

Measured totals from the current modules (pinned by tests):

| Hidden class | Count |
|---|---:|
| blocked-needs-video | 392 (300 swap, 92 motion) |
| unsupported | 98 (20 swap) |
| like-for-like-safe | 232 (34 swap) |
| bound | 12 (1 swap) |
| no contract | 1,042 |

There are 1,926 addressable templates, 150 listed and 1,776 hidden. Hidden route
fits are O1 clip 447, Kling I2V photo 97, text-only other model 112, unsupported
78 and no contract 1,042. Text-only recipes remain on their actual models;
adding a photo or substituting Kling is not authorized by their contracts.

**Work-order discrepancy and proposed correction:** this checkout's
`SEEDANCE_200_TEMPLATE_METADATA` contains **121 Syntx and 79 Higgsfield**
records, not 200 Syntx records. They resolve to **24 listed, 170 hidden and 6
withdrawn/absent**, not 14/61/125. The hidden origin set comprises **52 O1 clip
candidates, 34 unsupported and 84 text-only recipes**, not 40/17/4. Use these
measured records and their actual contracts; do not manufacture ids or change
catalog data to fit the work-order counts. The owner report records this
deviation explicitly. No origin template is moved to another model.

The importer now derives origin from metadata, audit `sourcePlatform` and the
audit filename, including every matching hash record. Any Syntx evidence wins,
so a duplicate clean record cannot mask an excluded hash. Syntx is excluded by
default; `--include-syntx` is the explicit opt-in. The corrected metadata does
not justify excluding all Higgsfield-origin records as Syntx.

`sourceTemplates.js` reads `runnableModel` while constructing model, price and
duration; this is not a display-only shared helper. Current template route
helpers already resolve bound models through the contract. The 238 legacy
Seedance labels need owner review against actual contracts: many label real
text-only recipes, so replacing them all with Kling would be false. No labels,
reference-model activation or UI are changed here.

Runtime growth is limited to the pure binder, shared wording and submit-option
plumbing. The offline inventory and provenance metadata are scripts-only; no
new full-contract import enters `/api/catalog`. No Worker budget is changed.
CI must measure compiled size against 60,500 KiB; source-byte accounting is not
a bundle-size proof.
