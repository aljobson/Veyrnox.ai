# ADR-0331 — Swap scene clip import

Status: implemented for offline review; no approved clips, upload or publication.
Date: 2026-11-07. Supplements ADR-0329's scene mechanics amendment.

## Decision

Use `scripts/import-swap-scenes.mjs` to prepare independently reviewed source
clips for the existing staging-only scene gate. Both shipped registries remain
empty and the dated public audit is `[]` until the owner approves a keep list.
Neither Swap offer, multi-reference setting nor production visibility changes.
Community prompts are not used. Template links, their hook change and eleven
locale CTA translations remain a separate follow-up.

The input is a private JSON array outside the checkout. Each approved record
has `id` (the template id), a generic scene `name`, `category: "YOUR PHOTO"`,
`people`, explicit `swapOffer`, `sourceUrl`, `sourceRecordId`, and
`approved: true`. Unapproved records are ignored, including their private
moderation notes. Approval asserts a completed by-eye and rights review; this
tool cannot perform that review or detect a person's name in an identifier.
Names and IDs must be reviewed before publication, with generic scene labels.
The public audit deliberately omits names, URLs and moderation reasons.

Run the default dry run with Node, ffmpeg and ffprobe available on PATH:

```sh
node scripts/import-swap-scenes.mjs --decisions /private/tmp/approved-scenes.json --out-dir /private/tmp/swap-review
```

Every run gets a fresh directory outside the checkout. It contains normalised
MP4s, `report.json`, and a `preview/` candidate revision with the two registries
and `docs/product/source-audit/swap-scenes-<date>.json`. The date is the import's
approval-recording date in UTC. Original downloads are removed after hashing.
Dry-run revisions are explicitly not publishable and do not mutate the repo.
The public audit retains provenance, hashes, byte counts, both durations,
dimensions, selected offer, people count, moderation and owner approval only.

Only HTTPS MP4 downloads from `d2ol7oe51mr4n9.cloudfront.net` are accepted.
Credentials, alternate ports, redirects and sources exceeding 100 MiB are
refused. The MIME header and MP4 brand are checked, then ffprobe verifies a
single video stream. ffmpeg reads local files only, encodes H.264, takes the
first ten seconds, scales down to at most 1280 on the longest side with even
dimensions, and strips audio and metadata by default. No upscaling, padding
or cropping compensates for failed provider bounds. Aspect is a display label:
the nearest of 9:16, 16:9, 1:1 and 4:5 by logarithmic ratio distance; the clip
retains its scaled dimensions. `--keep-audio` is an explicit soundtrack opt-in.

ffprobe format duration and video-stream duration must independently satisfy
the selected offer: Pro 5–10 seconds, Quick 2–10 seconds. Quick sides must be
200–2048 pixels. A four-second source is never switched from Pro to Quick.
Quick requires one person; Pro permits one or two, with two reported as
`needs_multi_reference` and unusable while the existing flag is off. Scene
model labels and 134/67 credits are copied from the existing catalog constants;
the billing unit remains five seconds. The importer does not price clips.

## Hosting and publication boundary

An owner-operated upload requires `--upload --confirm-bucket <exact-name>` and
caller-provided `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET`, and, if applicable, `R2_JURISDICTION`. The builder must never run it.
There is no environment-file loader, provider call or activation operation.

The existing Web Crypto R2 adapter writes only with `onlyIfAbsent: true` to
`swap-scenes/<id>/<normalised-sha256>.mp4`. The version is the first twelve
hexadecimal hash characters. A conditional-write conflict is a no-op only
when a full read-back has the same size and SHA-256. Different content fails;
changed normalised bytes receive a different key. Failed validation prevents
all uploads; upload/read-back failures leave the revision unpublished. A
partially successful upload may leave unreferenced objects for owner cleanup.

Only after every upload is read back and verified does the run emit its
candidate revision under `publishable/`. Both modes stage files outside the
checkout: the owner reviews and copies that revision's registry/audit files
into a later source change. This explicit integration step avoids installing
an unverified manifest from a dry run. Generated marker blocks replace only
the registry declaration and preserve surrounding code. Empty inputs leave
currently shipped files byte-for-byte unchanged. No source preview is served,
CSP changes or customer-facing video URLs are introduced. Existing admission
signs manifest keys for at most 900 seconds and persists scene/version/hash.
This is a narrowly scoped exception to general per-user random R2 key rules:
these vetted shared sources are immutable, server-held, and outside uploads.

## Rights, soundtrack and retention

Community reuse permission does not satisfy the rights review. Before any
approved import, the owner must retain a private provenance and rights record
covering the original clip, all depicted likenesses, permitted transformations,
provider processing and any retained soundtrack. Customer reference-photo
consent covers neither third-party likenesses nor the soundtrack. Audio is
stripped by default because carrying it forward requires separate permission;
`--keep-audio` is not evidence of that permission. This is an operational
requirement, not a finding that any particular clip is cleared.

Shared clips are retained independently of customer upload cleanup. Before
upload, the owner must set a rights-backed retention/review date in the private
record and arrange removal on expiry or withdrawal; this slice adds no promise
of indefinite retention and no automatic reaper. Local dry-run media should be
deleted after review, and local originals are always removed by the importer.
The builder's synthetic fixtures are removed by test teardown. Provider
retention and processing assurances remain subject to the existing activation
review; no new provider guarantee is made here.

Removal requires deleting the R2 object, removing its server manifest entry
(and public registry entry), and removing the audit row in a reviewed source
change. Remove every obsolete revision of that scene where appropriate. Keep
private rights/incident records only under the applicable retention/hold
policy. Already downloaded provider copies require the processor's removal
process; deleting an object cannot recall them. Historical job identity retains
scene/version/hash under existing job retention and does not expose clip URLs.

## Proof

`tests/swapSceneImport.test.mjs` uses synthetic ffmpeg test sources in OS temp,
mock downloads, in-memory conditional R2 writes/read-back and mocked provider
transports. The real generation route proves the signed video and customer
photo occupy the correct slots and stores immutable template provenance.
The normaliser and measurement are real. No CI download, provider spend,
production request, activation or migration is part of this proof.
