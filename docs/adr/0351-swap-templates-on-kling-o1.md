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

## Amendment 4: background clause and the price decision (2026-11-17)

Background leak. The owner's first spot check (three clips, same photo, plain wall behind the person) showed the photo's background, a plain wall, appearing in two outputs instead of the clip's own scene (`community-anime-hero-swap`, `basketball-3`), and a blurry basketball frame. The face and clothing followed the photo. The wording now adds one clause and one reorder, for 642 characters in total (still under the 2,000-character budget; amendment 1's 529 characters and amendment 3's "remains 529" note describe the earlier text):

> Use the reference image only for the person: ignore its background, setting and lighting completely. Keep the video's scene, background, camera, lighting, motion and timing unchanged.

The face wording constant (`lib/templateFaceWording.mjs`) is unchanged and still shared with the Kling I2V path, which does not get this clause (there the photo is the start frame, so its background is wanted). The O1 prompt is a server-held constant, not a client input, so exact-only transport and every contract hash are untouched; `tests/templateSwapClipPrompt.test.mjs` pins the exact text and length. This is a mitigation judged by eye on a few clips, not a guarantee that no background will ever carry over. A second paid spot check with a busy-background photo is the intended evidence (eight clips, $6.72, hard cap $7, run by the owner with their own key); it is not part of this change.

Owner decision, dated 2026-11-17. The O1 swap run is priced at 47 credits for 5 seconds, which is the existing catalog row (migration 0405, the whole-credit floor under ADR-0037 amendment 2 and migration 0366). The provider cost is about $0.84 for 5 seconds ($0.168 per output second). Two readings of that price, both recorded so the decision is not misread: at the floor credit rate the catalog uses (about $0.01796 per credit, the cheapest effective rate, which is how 47 was derived) 47 credits equal the provider cost, so the owner described it as no margin at the floor; at the pack prices in migration 0365 a credit sells for more than that, so customer revenue per run is higher than the provider cost (ADR-0037 states its own contribution-margin assumptions, which this ADR does not recompute). The owner accepted the price as it stands. No catalog or price change is made, and the 5.05-second clip cap (amendment 2) is kept. A 10-second run would be a separate priced unit and is not offered.

## Amendment 5: private content-addressed swap manifest (2026-11-17)

Owner decision: keep clip entries and other creators' clip hashes out of Worker
source. The source registry carries only public template ids and one
`TEMPLATE_SWAP_CLIP_MANIFEST_SHA256` pin. Both ship empty; the switch remains
absent and the O1 catalog offer remains inactive. Publication is a reviewed PR
carrying ids plus the pin after the owner's verified upload. Reverting that PR
rolls publication back. No price or catalog change is made here.

The private R2 object is
`template-swap-clips/manifests/<manifestSha256>.json`, containing
`{ "version": 1, "clips": { "<id>": { ...validated source fields } } }`.
The pin hashes its exact bytes. The existing SigV4 adapter reads it; status 200,
a streaming 1 MiB ceiling, matching Web Crypto SHA-256, valid JSON, version 1
and every entry passing `validTemplateSwapSource` are mandatory. Any invalid
entry refuses the whole publication. A three-second deadline covers signing,
headers and complete body consumption; abort cancels transport and the reader.
An uncooperative transport or cancellation cannot hold the request open.

The module cache is keyed by pin. It installs an in-flight promise before work
starts so concurrent readers share one GET. Verified entries are frozen and
kept for the isolate's lifetime, without a TTL. Failure is cached for ten
seconds from settlement; the next request starts one shared retry. There is no
stale-on-error fallback. Cost is one R2 GET per isolate per successfully loaded
pin, then none; failures may retry after ten seconds. Each failed attempt logs
`[template-swap] manifest unavailable` and a short reason code, never a key,
hash or upstream message.

Availability requires a current verified entry. Missing pin, absent entry,
R2 failure, timeout, corruption or invalid schema returns 404
`template_swap_not_found` before media signing, clip reads, admission, debit
or provider submission. The anonymous catalog projection also returns 404 and
no-store. Authenticated otherwise-identical accepted jobs can still replay:
only a current verified entry participates in the stored source comparison.
Replay never signs, admits, debits or dispatches. Signing for fresh accepted
requests still uses the validated entry key with a 900-second expiry.

The owner-run importer retains review hashes, tiers, origin exclusion, review
packs and the 5.05-second cap. After all approved clips upload and read back,
it serializes the manifest with sorted ids, conditionally uploads the
content-addressed JSON and verifies full read-back. Only then does it emit
`publishable/templateSwapClips.js` (ids plus pin) and `publishable/manifest.json`
for private records. No manifest entries are emitted as JavaScript. Failed
manifest uploads/read-back and dry runs emit nothing publishable.

Amendment 4 (PR #2389) records the wording clause and the owner's price
decision; this amendment does not repeat it. The checked-in size script already
had a higher budget than the frozen plan's 60,500 KiB assertion. ADR-0353 now
sets the webpack budget. This amendment left that script unchanged; no budget
increase was authorized or performed. Source-byte accounting cannot establish
compiled Worker size; `worker-smoke` must measure the compiled result in CI.

## Amendment 6: one reviewed character through an O1 element (2026-11-17)

The frozen PLAN6 work order (SHA-256
`e8cb26bf8bcfcddd4dfe03150a3b32a510a85ba58551f85423e592349bee5dbb`),
Revision 2 and R6-001–003, supersedes the one-image path above and the earlier
multi-person proposal. The implementation instruction authorizes this dark build;
it does not authorize activation or another paid probe. The owner's supplied
A/B observations report background leakage and possible role swapping with two
elements. No claim of improved generated output is established by offline tests.

Each clip replaces one reviewed character. Its manifest entry requires a safe
`role`, normalized to lower case, 3–60 characters, letters/digits/spaces/apostrophes/
hyphens only, with no digit-leading token. The default is the replace/change
subject associated with the lowest-numbered image slot, or `the main character`
when extraction is ambiguous. The importer reports every slot's role and an
advisory `object_role_suspected` flag; it never excludes a clip for having many
slots or for a suspected object role. Owner decisions may override the role.
The frozen v3 set contains 411 approved ids (Brixton unapproved), including all
15 clips with five or more slots. The test fixture contains ids only and grants
no publication authority.

A fresh review writes the effective role and `reviewFingerprint`, SHA-256 of
`<normalized clip sha256>\n<normalized role>`, in decisions-template.json for each
successfully processed clip. Every candidate gets its effective role, including
failed/missing media whose hash cannot be computed. Corrected roles require a
fresh review with those overrides before approval. Upload validates all reviewed
hashes, roles and fingerprints before its first storage write; a mismatch or
missing role returns `reviewed_role_mismatch`. Old v3 decisions cannot publish.
All approved clips must succeed, including those with five-plus slots. Existing
rights decisions, origin exclusion, conditional upload and hash read-back remain.
No real review pack, v4 approval file or upload is generated by this build.

Admission requires exactly two ordered owned, inspected image references:
frontal photo then close crop. `MULTI_REFERENCE_ENABLED` must be exactly `true`
for fresh admission and catalog availability. Both images must have known width
and height of at least 300, and aspect ratio 0.40–2.50 inclusive, before debit;
refusals use `template_swap_image_size` (including an unreadable image from the
existing inspector). Ownership, expiration, MIME and byte limits remain enforced.
There is no server cropping or background-removal dependency. Device cut-outs
and the owner's cut-out A/B decision belong to PLAN B.

The public O1 record and ordinary O1 callers remain unchanged. After verified
manifest admission, a per-request derived record makes image input optional,
retains its verified two-file limit, and declares private structured `elements`.
Host-read evidence dated 2026-11-17 is the
[fal O1 schema](https://fal.ai/models/fal-ai/kling-video/o1/video-to-video/reference/api).
This corrects ADR-0301's historical “no elements” statement only for the private
template swap path. Resolver, source check, provider check, price and payload
all use this record. Ordered internal `image_url` values become one element's
`frontal_image_url` and single `reference_image_urls` entry, then `image_url` is
removed. Neither standalone image key reaches fal. Duration stays `'5'`, audio
false, aspect auto, and the catalog price remains 47 credits.

`templateSwapPrompt(role)` supplies the exact Revision 2 wording and the reviewed
headscarf-girl A/B bytes. Submit sets `faceIdentity: false` for template swaps;
shared I2V wording is unchanged. Legacy image_urls wording constants remain dark
because their existing tests still use them. The adapter already passes the
shaped element unchanged and needs no modification.

Stored inputs contain the ordered reference descriptors and
`template_source: {template, version, sha256, role}`, never elements or transport
URLs. Replay rebuilds the prompt from stored role and compares ordered references
without checking the current multi-reference flag. A verified current revision
with changed role, version or hash conflicts; removed/unreadable manifests still
permit an identical accepted job to replay. The pre-existing template-swap kill
switch behavior remains. Public catalog projection adds only `role` and `images: 2`.
Registry and pin remain empty; no migration, price, gallery, deployment, upload
or switch changes are included. Worker size still requires CI `worker-smoke`
against the active budget in `scripts/check-worker-size.mjs` (now governed by ADR-0353).

Inventory correction to the frozen plan: shared `imageSlots` finds four
`@image2`-only clips among the 411 approved v3 ids, and five among all 519
candidates, rather than eight. The approved set also has one `@image6`-only clip.
Tests pin the observed four/five counts and validate roles across all candidates;
no candidate is excluded or renumbered to match the plan's count.

A job stored before this amendment has no `role`, so a replay of it answers
`idempotency_conflict`. None exists, because the path has been dark throughout.
Element swaps also need `MULTI_REFERENCE_ENABLED` (an existing var), so switching
swaps on later means setting that flag as well as `TEMPLATE_SWAP_CLIP_ENABLED`.

## Amendment 7: dark B1 cut-out and reconciliation contracts (2026-11-18)

Frozen PLAN-B1 (`277e4e600bef5f19ab59f0af492265ab6a1c3eb385bd738f003a7d9dcbd8243a`)
implements only shared pure math and server contracts. No UI, translations,
activation, migration, Worker variable, upload, price or provider call is added.
`templateSwapCutout.mjs` stays outside the server/Worker import graph. Adapters
in B2/B3 will own orientation-aware decode, face detection, grey compositing and
PNG encoding; this module alone does not process or upload a photograph.

The matte applies named 0.4–0.6 smoothstep thresholds before bilinear upsampling
and a 2-output-pixel feather. Quality is checked on a nearest-neighbour 256-long-
side grid: 4–90% coverage, largest 8-connected component, other components each
below 1% of its area and together below 2%. Exposed 4-neighbour edges after
outside-flood hole filling are divided by the convex hull perimeter of boundary
pixel squares; a rectangle is exactly 1. The provisional maximum is 1.55.
Strays return `busy_background`; a single ragged component returns
`ragged_matte`. Synthetic fixtures cover holes and 128/256/384 grid consistency;
private real-photo masks are not committed. B2 must recheck calibration on real
adapter output. Face count is separate: every second face blocks, including
small background/poster faces, and a single face below 5% of the shorter image
side blocks. The accepted face anchors the specified 2.6-width / 0.8-above /
2.2-below-chin crop; body extent guides added aspect-padding placement.

The owner adopted the PNG tripwire. Both inspected element images must be PNG;
other types return `template_swap_image_type`. Frontal/crop longest sides are
capped at 1536/1024; minimum 300 and aspect 0.40–2.50 remain inclusive, with
`template_swap_image_size` on failure, all before debit. The existing resolver
already retains MIME verified against magic bytes, so no shared resolver field
or contract change is needed. Ordinary generation callers retain their behavior.
This cannot prove a grey background: the Worker has no image decoder and is at
its size cap. A decoder/border-pixel check is refused. A PNG original can pass;
this is an accidental-raw-photo tripwire, not a security control.

Synchronous post-debit provider refusals now include `job_id` only for template
swaps, retaining existing error codes/statuses and refund calls. This is a
reconciliation handle, never proof of a refund. Ordinary error bodies retain
their exact bytes. An unsuccessful refund can leave the job DEBITED.

`GET /api/v1/jobs?idempotency_key=<key>` is authenticated, no-store and independent
of swap gates, catalog and manifest. It validates the shared generation key regex
before queries, resolves `users.auth_id` to the distinct internal `users.id`,
excludes tombstoned users, consumes `consume_job_read_request` with that internal
id, then queries the exact key/owner with `jobs.deleted_at IS NULL`. The existing
list does this mapping inside SQL, not a reusable JavaScript helper; B1 uses its
same predicate and quota RPC without changing the list or adding a migration.
Missing/unowned/deleted jobs and unknown/tombstoned users return `{ job: null }`.
Only `{ id, state, refunded, refund_state }` is exposed for a found job. `state`
uses `publicJobState`; only REFUNDED means `refunded: true` / `confirmed`, FAILED
means `pending`, delivered public success means `none`, and every other state
means `unknown`. No inputs, prompts, references, keys or URLs leave this lookup.

B-006 qualification remains mandatory for future UI: the rest of the video is
meant to stay as in the template, but generated details can change. Neither scene
nor other people, motion or timing are guaranteed unchanged. B0 is matte-quality
evidence only, not proof of generated-video fidelity. B1 has no UI; all web/mobile
layout, type, accessibility and screen-state criteria are not applicable here.

## Amendment 8: the guard reads three more swap wordings (2026-11-18)

`lib/templateSwapGuard.js` now also treats these as swap recipes: "replaces"/"replaced by" next to the photo, "... in the video" next to the
photo, and a clause that starts with "Swap". Five listed templates (`community-coastal-driver-swap`, `-dinner-party-recast`,
`-forest-umbrella-shift`, `-stage-dance-sync`, `-urban-stride`) are refused before any charge and leave the gallery. The importer's candidate set
grows from 519 to 524 (the five, which have no clip yet and cannot be approved until one is made), and 14 already-hidden video-edit
templates move from kind `motion` to `video_swap` (127/300/92 becomes 132/314/78). The 519-candidate counts and the 411 approved v3 ids in the
earlier amendments describe the frozen plan and are unchanged. Narrative uses ("the filter is replaced by", "no text may be replaced") stay allowed;
this was checked across all 884 templates that have a contract.

## Amendment 9 (2026-11-19): one swap switch in the runtime flags

The Worker is at its variable cap, so the swap switch is now the `templateSwap` key of the existing `APP_RUNTIME_FLAGS` JSON binding
(precedent: `push`, `checkin`, `templateFaceWording`). `lib/appRuntime.js` exports `templateSwapSwitchOn(env)`, true only for the key `true` or the older
`TEMPLATE_SWAP_CLIP_ENABLED` var being exactly `"true"` (still honoured if present). The clip gate, and through it `/api/catalog?template_swap=`, and the
generations route both call that one helper. An absent, false, malformed or string `"true"` key is off. `MULTI_REFERENCE_ENABLED` is still required. This change
edits neither `wrangler.jsonc` nor `APP_RUNTIME_FLAGS`; turning the swap on is a later owner-approved edit of that one JSON value after the upload, ids-and-pin PR
and activation migration. Removing the key (or setting it false) is the rollback.

## Amendment 10 (2026-11-19): the registry carries 410 of the 411 uploaded ids and the confirmed pin

`app/veyrnox/_lib/templateSwapClips.js` lists 410 ids and the manifest pin `a795629b7397a570a10a838499c6c6e76d4f765408369e1cfe0d48170d2bf28b`. The owner's
R2 upload (run `swap-upload-run-3`, publishable true) verified 411 clips and printed the identical SHA-256, so the pin is confirmed, not provisional. The owner
dropped `community-brand-billboard-swap` from the registry as a near-duplicate of `community-billboard-product-swap` (same base shot plus a third-party brand
and truck). It stays in the manifest only: the gate needs the id in both, so the pin is unchanged and the clip is refused. The manifest is not in source. The
switch is untouched, so nothing is reachable: the gate needs the `templateSwap` key, and the model row stays inactive until the activation migration. Three
tests that replaced the empty literals match the declarations by pattern; the registry test pins 410 sorted unique ids.

## Amendment 11 (2026-11-19): production switch on, after the staging proof

`wrangler.jsonc` sets `"templateSwap":true` in the production `APP_RUNTIME_FLAGS` (`{"checkin":true,"push":true,"templateSwap":true}`). No Worker var is added. This
is the last step of the activation order: the upload (done), the ids-and-pin PR (merged), the activation migration 0569 (PR 2492, applied by the owner-approved
apply run), then this edit, merged only on the owner's word.

Staging proof (2026-11-19, project `yrqzwqywxfesmbvhzjgj`): one real swap, job `8bbd8c9e`, state STORED, one `debit:generation` of -47 (Subscription bucket only), no
refund, completed by the fal webhook. Not live-proven: the short-clip refusal does not apply to swaps (the video is the server-held 5 s clip), the image-type refusal
and the failed-submit refund are covered by `tests/templateSwapClipGeneration.test.mjs` only, and immediate-versus-sweep refund timing is unverified.

Rollback: set `templateSwap` to `false` (or remove the key) in `APP_RUNTIME_FLAGS` and deploy. The gate then refuses every swap request, the catalog answers 404 and
accepted jobs still settle through the existing webhook and refund paths.

## Amendment 12 (2026-11-20): two-person templates behind their own key, dark

**Problem.** Template `basketball-3` needs two photos. The one-photo path sends one element (frontal plus crop of ONE person), the prompt names one role, and O1 dropped the other person in the output. About 121 of the 410 registry ids need two or more photos.

**fal limits (fal model page and OpenAPI, read 2026-11-20, no paid call).** `elements` is a list; each element takes one required `frontal_image_url` plus 1 to 3 `reference_image_urls`; the page says "Maximum 4 total (elements + reference images) when using video"; the prompt addresses them as `@Element1`, `@Element2` (and `@Image1`...). The earlier note "O1 takes at most 2 pictures" confused pictures with elements: up to four elements are allowed, so two people fit and so do three or four. The price is stated flat, $0.168 per second ($0.84 for 5 s); the pages do not say whether more elements change it (not verified; the staging run reads the fal invoice).

**Decision.** A new runtime key `templateSwapPeople` in `APP_RUNTIME_FLAGS` (no binding; absent or not exactly `true` is off; it needs the swap switch as well). With it off, every response, prompt, element and job identity is byte-for-byte the one-person path. With it on, a registered id that is listed in `lib/templateSwapPeople.mjs` becomes a two-person offer:

- `/api/catalog?template_swap=<id>` adds `people: 2`, `roles: [first, second]`, `images: 4` (`role` is the first role). Other ids keep `images: 2`.
- The request carries four `image` references: frontal and crop of person 1, then of person 2. Any other count is `400 template_swap_photo_count` before any debit or job (the web and phone composers already ask for exactly four).
- The server sends `elements: [{person 1}, {person 2}]` and the prompt `Change <role 1> in @Video1 to @Element1 and change <role 2> in @Video1 to @Element2. ...` (`templateSwapPeoplePrompt`). The one-person prompt is unchanged.
- The job stores both roles in `template_source.roles`; replay reads them from the stored identity and never depends on the key.
- The catalog stays normative for price: the same 47 credits per 5 s unit. No price changes here.
- The pinned manifest carries ONE role per clip and does not change (pin a795629b...2bf28b). The second role therefore lives in the reviewed table `TEMPLATE_SWAP_PEOPLE_ROLES`. First wave, where both source slots name a distinct person: `basketball-3`, `community-double-character-swap`, `community-firelit-combat-duel`, `community-cliffside-rescue-hero`, `community-elevator-dance-swap`, `community-streetball-rivalry-swaps`. About 45 more two-slot clips read "the main character" twice and need an owner-written pair; others have an object, animal or room as slot 2 and stay one-person.

**Not done here.** The live registry is not touched; ids removed by the stop-gap come back only through a separate owner-approved registry step after the staging proof below. Three-plus people: fal allows four elements, but no 3+ prompt, UI or table exists; see the PR for the recommendation.

**Staging proof (owner decides; STAGING fal key only, never PROD FAL).** `basketball-3` on staging with the key on, two different supplied faces: expect one 5 s job, 47 credits, about $0.84 at fal. Look at: both people present; person 1 is the green character, person 2 the red one; faces match the two photos; scene unchanged.

## Amendment 13 (2026-11-20): only one-photo scenes stay in the registry (410 to 289 ids)

The composers send one photo and the server sends one `@Element1`; nothing checks how many people the source scene holds, so a second person is dropped (seen on basketball-3, where the opponent vanished). The registry therefore keeps only the 289 scenes the review counted as one-photo and removes the 74 two-photo and 47 three-or-more-photo ids. The gate answers `template_swap_not_found` for the removed ids, so they cannot be charged; their swap links stop working until a two-photo mode exists.

The R2 manifest and its pin (`a795629b…bf28b`) are unchanged and the 411 clips stay in both buckets, so adding ids back is a registry-only change. The curated row holds 13 ids, none removed here.

Rollback: restore the removed ids in `app/veyrnox/_lib/templateSwapClips.js`.
