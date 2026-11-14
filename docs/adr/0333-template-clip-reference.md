# ADR-0333 — Template preview clip and one photo as Seedance references

Status: implemented behind an absent flag; owner activation checks remain blocking.
Date: 2026-11-07.
Related: ADR-0309, ADR-0329, ADR-0331, ADR-0256.

## Decision

`TEMPLATE_CLIP_ENABLED` is server-only and enables admission only for the exact
string `"true"`. It ships ABSENT from both Worker configurations, therefore off.
Do not raise the 67-variable binding guard. Before adding it, the owner can
remove the currently false `CONTENT_SCAN_ENABLED` var (its reader defaults to
off), after verifying current configuration and tests, or consolidate an
existing flag into its supported runtime group. No binding is changed here.

The public registry contains only `medieval-runway-look`, a recast template.
Its canonical preview is `https://veyrnox.ai/showcase/viral-medieval-runway-look.mp4`.
The shipped server manifest is empty. Nothing is available until a separately
reviewed import is published. No Syntx-hosted media URL is an import source.

`GET /api/catalog?template_clip=<id>` is an anonymous, no-store projection:
`{ id, model: 'seedance-2.0-reference', credits, durationSeconds: 5 }`.
It reads no identity header and returns no source URL, key, hash or version.
The gate requires a registered template, a manifest, and a live catalog row
with `active === true`, no gate, the exact Seedance reference endpoint, and its
server-only video capability. It never admits from fallback catalog rows.

The optional `template_clip` generation field uses the existing gateway, rate
limit, source ownership/consent checks, `priceFor`, debit, provider submit and
refund paths. Flag off or unpublished means `404 template_clip_not_found`;
the field cannot be silently ignored. After the attempt quota, authenticated
read-only replay precedes publication checks. Replay compares the photo and
client-controlled inputs (excluding the server-owned prompt) and `{ template, version, sha256 }` stored in
`jobs.inputs.template_source`. A known changed revision conflicts; a removed
manifest still permits an otherwise identical accepted request to replay.
No signed URL or storage key is persisted as the template identity.

Admission requires model `seedance-2.0-reference`, exactly one image reference,
`consent === true`, and five output seconds. On the template-clip path, client video references and
`video`, `video_url`, or `video_urls` fields are refused with
`template_clip_video_not_allowed`. Ordinary Seedance requests retain their
existing validation: raw media URLs are dropped, undeclared input keys keep
the existing input error, and video-slot references give `source_slot_invalid`.
`declaredInputs` drops server-only media unless trusted admission explicitly
opts in after signing the template source. The server-only slot is omitted
from every public capability projection, so Create, mobile, MCP and developer
catalogs acquire no video picker or public input contract.

Trusted manifest metadata is checked before debit: video coverage at least
2 seconds, conservative total duration at most 10 seconds, sides 300–2160.
`presignGetUrl` signs only `template-clips/<id>/<sha256>.mp4` for 900 seconds.
The existing payload builder sends `image_urls: [photo]`, `video_urls: [clip]`,
duration `"5"`, resolution `720p`, and `generate_audio: true`.
These conservative input limits and `@Video1` syntax need owner verification.

The effective prompt is the short constant in `lib/templateClipPrompt.mjs`:
retain the scene, camera and motion from `@Video1`, replace its lead with
`@Image1`, and retain the person's identity throughout. `@Image1` follows
ADR-0309's convention; the community prompt can name a different character
and is never sent for clip mode. Client prompt edits are ignored by this path.
The exact community prompt stays visible and unchanged in the source catalog.
In clip mode both web and mobile display it read-only, retain the exact-prompt
help, and add the own-clip explanation beside it. Replays ignore both the client
prompt and the persisted effective prompt, so updating the server constant
does not conflict with an older paid job.

Available web/mobile templates show one photo slot, the catalog price, the
real-person warning and Generate. Existing unsupported-video blocks remain
for unavailable/unregistered templates. Clip-mode Create and film handoffs are
hidden because their drafts do not carry `template_clip`. Shared copy is
translated in all eleven locales. A failed likeness check retains the existing
`reference_rejected_likeness` copy and refund handling. No frame-only model is
silently substituted. One photo plus one server clip works without changing
`MULTI_REFERENCE_ENABLED`.
Only registered templates fetch availability. There is no existing cheap public
signal for this server-only flag; the registered-only fetch therefore remains.
An unavailable/flag-off 404 is silent and leaves the existing UI unchanged.

## Import and ownership boundary

The owner runs `node scripts/import-template-clips.mjs --decisions
/private/path/approved.json --out-dir /private/path/review` (on one shell line).
Decisions are private JSON outside the checkout: `[{ "id":
"medieval-runway-look", "approved": true }]`. The tool derives the canonical
preview from the registered template and showcase record. Any supplied
`previewUrl` must match after strict normalization. Unknown IDs, duplicates
and mismatches are rejected before any download. Unapproved records never
produce a clip.

Only HTTPS MP4 under `veyrnox.ai/showcase/` is allowed: no credentials,
query/hash, redirect, foreign host or file above 100 MiB. MIME, MP4 brand and
ffprobe checks precede normalization. Shared ADR-0331 helpers produce H.264,
even dimensions, at most 1280 on the long side, strip audio and metadata, and
never upscale to make an undersized source pass. Template imports take the
first five seconds (`-t 5`), record measured container/video durations, and
reject output above 5.05 seconds (encoding tolerance). The common normalizer
still defaults to ten seconds for swap imports. Admission keeps its conservative
10.0-second slot bound; the template output duration and price remain one
five-second unit end to end.

Dry run is default; candidate manifests and temporary media stay outside the
checkout. `--upload --confirm-bucket <exact-bucket>` is an explicit owner action
using the existing R2 adapter with `onlyIfAbsent`. An existing object is accepted
only after full size/hash readback. All clips must validate before uploads;
only fully verified uploads yield a `publishable` candidate. Failed or partial
uploads never install a manifest and may leave unreferenced objects for owner
cleanup. No builder upload or real download was performed; tests use synthetic
ffmpeg media, mocked HTTP and in-memory R2.

## Price and product blockers — owner checklist

None of these activation steps is performed by this implementation.

0. **Blocking product question:** ADR-0309 amendment 1 records that this endpoint
   refuses real-person pictures. Prove in a paid staging probe that a normal
   selfie plus this clip is accepted before activation. If refused, this flow
   does not meet its goal on this model; a frame-only model cannot supply
   `@Video1`. Free a Worker binding as described above before adding the flag.
1. Record written rights for each preview, including third-party likeness and
   soundtrack review, even for our generated previews.
2. Verify the billed price WITH video input. The documented $0.3024/second was
   WITHOUT video input; today's 85 credits per five seconds may be wrong.
   Price remains the catalog's, never app-calculated. Any adjustment requires
   a separate migration and owner approval.
3. Verify fal's duration, dimensions, size and `@Video1` syntax against the
   conservative slot and the staging result.
4. Run the importer dry run, review it, upload to R2, then review and copy the
   candidate manifest into a source change. Confirm the first five-second window
   shows the scene's key motion; a ten-second variant is a separate follow-up.
   Keep the registry in agreement.
5. Apply any required price migration only through `apply-migrations`. No DB
   change is needed or included here. Migration 0417 activates the reference
   row in source; its live application has not been checked by the builder.
6. Leave `MULTI_REFERENCE_ENABLED` unchanged (already true in Worker source).
   Set `TEMPLATE_CLIP_ENABLED="true"` only after all preceding checks pass.

## Verification and review limits

The frozen work order hash is
`6ecc01634b7a9c00198d6bc18b936ab134f61b8940463a4822872b46537404e8`.
The route validator and submit completion were extracted without changing the
money path; the generations route and capability runtime files are below 500
lines. Existing large translation data files retain their structure.

One old test asserted that the INTERNAL Seedance media object had only an
image slot. It now checks the required server video slot and proves the PUBLIC
projection still has only the image slot. Source-location tests follow the extracted validator and submit helper; their
order assertions now check the route and helper separately, rather than
concatenating files. Behavioral tests cover unknown submit outcomes without
refund, rejection with one refund, successful submission recording before the
attempt, and lost submission acknowledgements.

### Host review dispositions T1 and F1–F6

- T1/F1: the private slot has no visible label. Default declared-input filtering,
  public projection, source admission, help, Create attachments, MCP and mobile
  source tests prove it stays private; ordinary route behavior is preserved.
- F2: a synthetic 10.04-second source proves the importer writes measured
  five-second metadata and output within 5.05 seconds; the slot still accepts
  10.0 seconds. The owner must review the selected window before publication.
- F3: prompt displays are read-only only in clip mode; help and copy remain.
  Registered-only availability and silent 404 behavior are tested.
- F4: the knowledge generator's breadth-first scan is capped at 96 modules.
  The new hook import initially moved TemplateGenerate to position 97, dropping
  its existing insufficient-credit sentence. Keeping the existing component
  import before the new hook restores position 96. Regeneration through
  `npm run sync:vey-knowledge` produces only the two intended added strings
  plus hashes against local `origin/main`; no artifact was hand-edited and
  neither node_modules nor sandbox behavior caused the loss.
- F5: the size-motivated extraction remains; per-file ordering and behavioral
  submit tests cover its boundary.
- F6: prompt revisions are excluded from replay identity. A stored earlier
  prompt and the current different constant replay without a second debit.

Local `origin/main` ends at ADR-0332 and remote branch names were inspected.
GitHub/open-PR verification could not complete because API access was
unavailable: independently check ADR-0333 availability before integration.
No commit, push, publication, migration, production access, paid probe, browser,
simulator, Metro or native build is part of this work.

### Known edge (second inspection, low)

Turning `TEMPLATE_CLIP_ENABLED` off also stops replay: a client retrying a lost response with the same key
after the flag is removed gets `template_clip_not_found` instead of the existing job id. The job itself is
unaffected and visible in the Library. Moving the read-only replay ahead of the flag check is a follow-up.

## Amendment 1 — separate inactive kie offer (2026-11-07)

Frozen work order: PLAN-KIE, SHA256
`e09afe06365d262fd97df95b78ce63b3bc76fc4face66eb7d97674b3121201f5`,
including amendments A-001 through A-006 and host dispositions KIE-R1–R4.
This amendment supersedes the
fal-only model binding above; fal's capability and importer acceptance stay
unchanged. No new environment variable or public route is added.

### Contract and admission

The contract supplied in the frozen order was read on 2026-11-07 from
[official kie documentation](https://docs.kie.ai/market/bytedance/seedance-2)
(the capability record's `verification`). Create task is
`POST https://api.kie.ai/api/v1/jobs/createTask` with model
`bytedance/seedance-2`, the existing signed-callback route in `callBackUrl`,
and `input`. Our shared payload shaper sends the server prompt,
`reference_image_urls`, an optional server-only `reference_video_urls`,
integer `duration` (5 or 10), `aspect_ratio`, `resolution: '720p'`, and
`generate_audio: true`. There are no first/last-frame fields. Template clips
always buy five output seconds. Ordinary image-only requests omit the video
list. Callback verification, polling and refusal mapping are unchanged.

The provider documents 3–20,000 prompt characters, up to nine images,
three videos (combined at most 15 seconds), reference audio, 4–15 output
seconds or -1, and 480p/720p/1080p/4k output. These are not all offered here.
A-006 limits this offer to ONE image, without verified-list expansion; widening
needs a billed probe and a review of the gateway's three-per-kind ceiling.
The public capability is maxFiles 1, with no video slot in catalog, developer,
MCP, web or mobile projections. Two images fail before debit.

`seedance-2.0-reference-kie` is a distinct catalog offer, provider `kie`,
endpoint `market:bytedance/seedance-2`. The immutable model-to-endpoint map
is shared with admission and replay. Availability prefers the active,
ungated fal row; otherwise the active, ungated kie row; otherwise 404. Each
row must match its endpoint and capability provider. Before projecting kie,
selection runs the same pure manifest metadata validator used by admission.
A fal-era entry lacking measured frameRate/sizeBytes, or any entry outside the
kie bounds, makes that candidate unavailable (404 when no candidate remains).
Clients then retain their existing non-clip mode; a complete valid entry
projects kie. Fal's existing projection behavior is unchanged. NEW admissions require
`body.model_id === templateClip.modelRow.id`; even the other allowed model
returns `template_clip_model_mismatch` before debit. Both clients validate the
allow-list and submit the projection's id. Replay resolves the stored model,
so preference flips, row deactivation and manifest removal do not strand an
accepted key. The existing flag-off replay limitation remains unchanged.

ADR-0256 `canHop=false` still holds: media is resolved at admission. This is
not an automatic fal failover route. No supplier route cost row is required
for an inactive offer: `resolveRouteSet` already dispatches the catalog offer
when no own route exists, and 0367 is a one-time backfill, not an insert
trigger. Under host disposition KIE-R3, migration 0454 adds the inactive row
with `INSERT ... ON CONFLICT (id) DO NOTHING`. On replay it preserves an
existing row entirely, including a real price/cost or an activated state set
by later migrations. Later migrations own pricing and activation. The repo's
catalog UPDATE guard allows this insert-only form: there is no UPDATE to
require a ROW_COUNT DO block. This supersedes the frozen order's 0405 upsert
pattern; no migration check forces an overwrite. Main and all six
open PR file lists were checked through the GitHub connector on 2026-11-07;
main ended at 0453 and no open PR used 0454. No migration was applied.

### Media validation and importer choice

Only the kie record opts into the new checks. Images must have 300–6000 px
sides, aspect 0.4–2.5, and size strictly below 30 MB. The private video must
have 300–1280 px sides, aspect 0.4–2.5, 409,600–927,408 total pixels,
24–60 fps, size strictly below 50 MB, at least two seconds of visual coverage
and at most 5.05 seconds. Missing measured dimensions, byte length or frame
rate fail closed before signing/debit. MB is conservatively decimal bytes.

**Our interpretation, retained fail-closed under KIE-R4:** the contract's
“480p/720p class” is enforced as a short side of exactly 480 or 720 pixels.
The source contract does not further define that class. Non-16:9/9:16 sources
whose normalized short side falls outside that set (for example 4:3 at
1280×960) are rejected by design until the probe confirms whether only the
pixel window applies. This is not a blanket aspect-ratio ban: 720×720 still
passes the unchanged rule and pixel window. No additional aspect allow-list
is introduced. Confirm this interpretation at the owner probe before any
relaxation. No crop, upscale or padding is introduced to make unsupported media fit. Thus 1280×720 passes,
1280×320 fails its aspect even though its pixels pass, and 640×360 fails the
pixel minimum. An existing narrow portrait manifest may therefore work for
fal and fail for kie; it must be re-imported/reviewed before choosing kie.

The importer previously had no route selector. It now accepts
`--model-id seedance-2.0-reference-kie`; omission retains the fal default.
For kie, the existing scale-to-1280 normalizer additionally pins 30 fps and
`-t 5`. Measured container and video duration must be 5 seconds ± one frame;
a shorter source is refused as `kie_reference_requires_five_seconds`, rather
than inventing missing footage. Admission retains the explicit 5.05-second
encoding tolerance. The manifest candidate records measured width, height,
pixels, frameRate and sizeBytes. All clips validate before any upload.
Synthetic 29.97-fps 1280×720 and 1920×1080 sources cover normalization and
admission; the latter scales to 1280×720. No real download/upload was run.

### Billing and owner checklist

kie bills reference-video seconds PLUS output seconds at a lower rate than
image-only input. [Pricing](https://kie.ai/pricing) advertises only “from
$0.057/s”; this is NOT verification of this offer's price. The supplied
third-party estimate of ~$0.125/s at 720p with video is **UNVERIFIED**.
One kie credit is approximately $0.005. Migration 0454 records **provisional**
`provider_cost_per_unit = 1.25`, `credits_5s = 70`, from
`ceil(1.25 / 0.01796)`, assuming roughly ten billed seconds (reference
<=5.05 plus five output seconds). This is a placeholder, not a proven margin
or an exact bound including encoding tolerance. Catalog price remains
normative; no application-layer price computation is added. The row stays
inactive. Migration 0417 already activated fal in source; the absent
`TEMPLATE_CLIP_ENABLED` flag, not “both rows inactive,” keeps the feature off.

Before any activation, the owner must:

1. Read the real model-page reference-video rate, then run ONE billed staging
   probe with a template clip and a normal selfie. Read the invoice, account
   for reference plus output duration (including tolerance), and set the
   actual catalog price/cost in a NEW migration before activating the row.
2. Establish whether kie accepts real-person photos; fal's refusal in
   ADR-0309 amendment 1 does not prove kie's behavior. The prompt tokens
   `@Video1`/`@Image1` are **UNVERIFIED for kie**. Verify them in the probe;
   if kie requires different tokens, add a per-model prompt in the kie shaping
   path, never by editing the fal prompt. Verify output and refund behavior.
   Also verify our interpretation of “480p/720p class”: short side exactly
   480 or 720. Non-16:9/9:16 sources outside that short-side rule are rejected
   by design until the probe confirms whether only the pixel window applies;
   the rule does not reject every non-widescreen source (720×720 passes).
   Keep the current rule fail-closed until that evidence exists.
3. Record preview rights as for #2000, import with the intended model id,
   review measured metadata and the first five-second window, and publish the
   manifest only through a separately reviewed source change.
4. Complete the same flag/binding step as #2000, freeing a Worker binding
   before enabling `TEMPLATE_CLIP_ENABLED`. Keep this row inactive and the
   flag absent until all checks pass.

Crun remains out of scope: the work order found no official Seedance
reference contract (`https://crun.ai/docs` returned 404; a press release alone
is insufficient). No Crun route is added here.

### Kie review notes (inspection round 2)

- Migration number 0454 was free on `origin/main` and in all open PRs when this branch was prepared (checked 2026-11-07); re-check at merge time.
- Known fail-closed edge: if object storage answers a photo GET with 200 and no `Content-Length`, the kie image-size bound sees an unknown size and refuses the request before any debit (`source_size_unknown`). Confirm at the staging probe that R2 always returns a size, or have the source resolver report the bytes read.

## Amendment 2 — all video previews and editable reference chips (2026-11-08)

Frozen PLAN-CHIPS SHA256:
`02981ed0fb9ba034ae689f5b95e662ac9dbc1e8bee210ac33ab6ef03190cfd1d`.
C-03′ supersedes C-03 and the original F6 decision above. No migration,
provider route, price, environment variable or production setting changes.
The manifest remains empty and `TEMPLATE_CLIP_ENABLED` remains absent.

### Registry and import

Eligibility is a published `ALL_TEMPLATES` entry whose resolved `MODELS` kind
is `video` and whose showcase video is a direct `/showcase/<filename>.mp4`.
Image models and absent/non-MP4 previews are excluded; recast wording, needs,
aspect and duration do not restrict eligibility. The generator currently
finds 771 entries, including photo-only recipes. Every local file exists.
Unavailable entries retain their existing default path.
`scripts/gen-template-clip-registry.mjs` generates only ids and preview file
names. The runtime module imports no catalog. The existing public projection
shape is retained; its compatibility `kind: 'recast'` describes this operation,
not an eligibility gate. Display names in that projection are derived from
ids; actual page titles still come from their existing catalogs.

The owner can dry-run `node scripts/import-template-clips.mjs --all`.
`--chunk-size 50` controls checkpoint frequency, `--offset N` skips a leading
part, and `--resume /private/path/template-clips-...` reuses completed files
only after hash, measured metadata and selected-model bounds verification.
Resume must keep the same model and upload mode. Failed entries are retried.
Files are read locally from registry-derived names; symlinks outside showcase
are refused. Only absent files fall back to the existing strict HTTPS source.
Per-template failures are reported and omitted, without aborting other clips.
`report.json`, `report.txt`, checkpoint, normalized media, candidate JSON and
candidate JS stay outside the checkout. Normalization and fal/kie bounds are
unchanged. Upload still requires approved private decisions, `--upload` and
`--confirm-bucket`; `--all` alone never authorizes upload. Missing decisions
are reported as skipped. A partially successful normalization batch can yield
an intentionally partial manifest; all included uploads must verify before
it is publishable. Failed uploads produce no publishable candidate.

Candidate JS encodes entries as tuples and reconstructs keys/version and
constant metadata once. A 900-entry synthetic candidate must remain below
150,000 bytes; the importer refuses a larger module before upload. The JSON
review artifact is deliberately expanded. No populated manifest is installed.

### Prompt, replay and money

Default text now uses lowercase UI tags. Both clients send the actual edited
text. The shared contract requires 3–2000 trimmed characters and exactly one
whole `@video1` and `@image1`, case insensitive (Unicode word boundaries).
Whitespace is collapsed and tokens lowercased for client continuation identity;
admission uses the same normalization, then the per-model mapping emits
`@Video1`/`@Image1` for fal and kie. Missing/empty prompt uses the current
default. Invalid prompts return `400 template_clip_prompt_tags` before debit.
Client video remains forbidden in every previous form.

The effective provider prompt is stored verbatim as `inputs.prompt` and is
part of identity along with template id/version/hash, photo and model. There
is no provenance/default-mode field. Replay uses the same function as admission.
The existing `generation_request_identity` (0399) already includes prompt,
so atomic paid/free admissions and read-only replay agree without DB changes.
An omitted-prompt retry crossing a deploy that changes the default now fails
closed with `idempotency_conflict`: it never charges again under that key.
The person starts a new request. Our clients always send their displayed text.
Unchanged prompt retries retain their key; edits invalidate quotes,
confirmation and continuation. Existing catalog pricing and refunds remain.

### Clients and owner checks

Web uses separate native editable text segments around atomic thumbnail chips.
Video chips are outside editing hosts; removing the photo removes its chip,
attaching restores it, and reset restores default wording. Paste inserts plain
text only and IME composition is committed after composition ends. Photo
conversion, limits and upload stay on the existing path, with an explicit
rights checkbox and real-person warning. The clip branch bypasses legacy
`needs` wording gates but still requires a usable projected model and a ready
photo. Native uses the existing photo picker thumbnail/removal row beside the
video poster and an ordinary multiline TextInput with literal tokens, as
permitted by E; no existing highlighted TextInput pattern is reused. The exact
community prompt remains separately visible and read-only in clip mode.
Flag-off render snapshots compare against the frozen checkout. Shared new
copy is translated in all eleven locales and mirrored through mobile webKeys.

Owner activation checklist (all previous blockers still apply):
1. Record the rights decision for the showcase set privately, including each
   clip's likeness and soundtrack rights.
2. Run the bulk dry run, review passed/failed/skipped ids and the selected
   five-second windows, then upload with owner credentials and copy only the
   reviewed manifest in a separate source change. Failures stay unavailable.
3. Perform billed staging probes with a video and a real selfie for both
   providers; confirm price, real-person acceptance, kie bounds interpretation
   and `@Video1`/`@Image1` syntax before activation.
4. Free a Worker binding and add the flag only after those checks pass.

Verification limitations and per-line design criteria are recorded in
`docs/template-clip-chips-review.md`. No browser/device proof is claimed.
