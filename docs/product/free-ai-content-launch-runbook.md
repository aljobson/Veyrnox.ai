# Free AI content launch runbook

Date: 13 October 2026

## Objective

Launch a small Social Cinema collection that costs £0 in acquisition fees and is free for viewers to stream.

The existing application already supports the required delivery path:

`private draft → Stream upload → rights declaration → administrator review → publication → signed playback`

`SHORT` and `TRAILER` titles currently resolve to zero viewer credits. Cloudflare Stream uploads must be no longer than 600 seconds. The first collection should therefore use `SHORT` and contain videos at or below ten minutes.

## Phase 1: approve the rights package

Before downloading a media file, create one manifest row containing:

- title and source page;
- exact source revision or dataset commit;
- direct media URL only after approval;
- rights holder and contact route;
- licence name, version, and URL;
- dated copy of the licence evidence;
- required attribution;
- music, voice, likeness, trademark, and stock-component status;
- permission for commercial streaming, transcoding, captions, thumbnails, trailers, and promotion;
- geographic scope and expiry, if any;
- review decision and reviewer;
- SHA-256 hash after download.

Only `approved` manifest rows may be downloaded or uploaded.

### First audit batch

The 13 October 2026 audit produced four approved pilot assets:

1. Late Afternoon Swans (CogVideoX) — CC0 1.0, silent, 6.125 seconds.
2. Painting With The Breeze (CogVideoX) — CC0 1.0, silent, 6.125 seconds.
3. Grey Haired Man in a Cosy Cafe (Veo 3) — CC0 1.0, 7.999 seconds; generated audio removed.
4. Visual Kei Man Enjoys Lemonade (Veo 3) — CC0 1.0, 7.999 seconds; generated audio removed.

Cyberpunk Rainy Street and AI generated video clip – New creative video were blocked after their watermarks exposed unresolved generation-tool restrictions. The two Micronautas clips were blocked pending generation-tool and soundtrack provenance. Continue the GenState-AI, DeepAction, and TA2.0 asset-level reviews until the five-title release gate is met. The collection is currently at four approved and published titles.

The decision record and hashes are in `free-ai-content-audit-2026-10-13.md` and `free-ai-rights-manifest.csv`.

Do not start with files carrying only `PD-algorithm`. UK computer-generated-work protection makes an affirmative creator licence the safer basis for the service.

## Phase 2: create a Social Cinema curator identity

Use the organisation-controlled curator account **Social Cinema Open Curator** (`@open_cinema_curator`) rather than pretending that Social Cinema created the underlying works.

The account must:

- have a public Cinema profile;
- be approved as a creator through the existing administrator workflow;
- remain controlled by the organisation;
- identify the original creator and licence prominently in every synopsis;
- never claim ownership of the underlying work.

This account is the operational uploader. The original creator remains the credited creator and licensor in the rights manifest.

## Phase 3: prepare streamable masters

For every approved asset:

1. Download from the approved source URL.
2. Compute and store SHA-256.
3. Confirm duration is between 0.1 and 600 seconds.
4. Confirm the file is MP4, WebM, or QuickTime and no larger than 2 GiB.
5. Scan the complete video and audio for undeclared music, real people, cloned voices, brands, copyrighted characters, unsafe material, and corrupted frames.
6. Create captions where speech is present.
7. Create a poster and thumbnail only when the licence permits adaptations.
8. Produce a credit block that includes creator, source, licence, licence link, and a statement of changes.

For CC BY-SA material, release Social Cinema’s adapted media contribution under the same or a compatible licence. Preserve the original master and transformation log.

## Phase 4: ingest through the existing product

For each asset:

1. Create a private `SHORT` draft in `/social-cinema/creator`.
2. Use the factual original title or an approved editorial title.
3. Put the source, creator, licence, attribution, and modifications in the synopsis until dedicated licence fields are implemented.
4. Select one or two appropriate categories.
5. Select every applicable AI disclosure.
6. Upload the approved master with the existing server-mediated Stream uploader.
7. Wait for Stream state `ready`; encoding success alone does not approve publication.
8. Submit the title with the current versioned rights declaration.
9. Have a different administrator compare the submission with the manifest and approve or reject it.
10. Confirm the public title reports `Free`, playback starts, credits are not deducted, and attribution is visible.

Do not classify a feature-length work as `SHORT` merely to bypass pricing. The first collection is intentionally short-form. A later change should add an explicit administrator-controlled `FREE` monetisation field before free films or complete free series are accepted.

## Phase 5: direct creator acquisition

Send a zero-fee invitation to creators of suitable narrative shorts. Request:

- a clean master no longer than ten minutes;
- captions and poster artwork;
- full credits and music cue sheet;
- AI tools and synthetic-media disclosures;
- confirmation of music, voice, performance, likeness, trademark, and stock rights;
- a non-exclusive, worldwide, 12-month grant for hosting, on-demand and scheduled streaming, public performance, promotion, transcoding, captions, thumbnails, and short trailers;
- permission for ad-supported viewing;
- no acquisition fee or minimum guarantee;
- an optional share of revenue actually earned;
- an agreed takedown notice period.

Do not ingest a screener or platform copy. Obtain the master from the creator after the agreement is complete.

## Release gate

The first collection is ready only when:

- at least five titles have `approved` rights manifests;
- each title is no longer than 600 seconds;
- every title has attribution, disclosures, and component clearance;
- a separate administrator approved each title;
- all titles display `Free` and start playback without charging credits;
- withdrawal and suspension have been exercised on a test title;
- the public catalog, title page, and player pass Reticle verification in the running application.

## Next engineering increment

Add durable provenance fields to Cinema rather than keeping licence evidence in a synopsis:

- `source_kind` (`open_licence`, `direct_grant`);
- `source_url`;
- `source_revision`;
- `licence_code` and `licence_url`;
- `rights_holder`;
- `attribution_text`;
- `evidence_captured_at` and evidence-object key;
- `territories` and `rights_expires_at`;
- component-clearance status;
- media SHA-256;
- an administrator-controlled `monetisation_type` defaulting to the current pricing behavior.

Publication should fail closed when required provenance fields are absent. The public title page should expose creator attribution, source, licence, and modifications without exposing private contracts or contact details.

## Production verification record

On 13 October 2026, the two Veo titles completed the full product workflow: private draft, Stream upload, rights declaration, administrator review, publication, public title page, and signed playback. Both display `Free`, and each production player completed its seven-second stream. The public title IDs are:

- `6138d6ab-35ba-48f5-934f-f8da387d2d45` — Grey Haired Man in a Cosy Cafe (Veo 3)
- `c928cfef-ed3a-4560-afbf-ff72927eaa32` — Visual Kei Man Enjoys Lemonade (Veo 3)

Reticle was not used for this operational ingest because no application code or running-app behavior changed. Production browser playback supplied the relevant verification.
