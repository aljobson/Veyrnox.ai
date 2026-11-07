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
