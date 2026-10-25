# ADR-0262: Ordered attachments in Publish posts

Status: Implemented behind a disabled flag; rollout verification pending
Date: 2026-10-25

## Decision

Implement the frozen carousel order, including CAROUSEL-001 through 006.
`PUBLISH_CAROUSEL_ENABLED` must be exactly `"true"` to admit two or more
attachments. Production and staging ship `"false"`; only the owner may enable
it. The shared admission rule covers internal posts, customer posts, generated
drafts and approval creation. MCP and the automation API delegate to the internal
posts writer. Single attachments retain the existing provider handlers.

Each selected destination must support every attachment and the full count.
Unsupported counts or combinations return `media_count_not_supported` and the
network. The disabled gate returns `carousel_not_open`. Limits are product caps:

| Destination | Attachments per carousel |
| --- | --- |
| Instagram | 2–10 images/videos, including mixed; video readiness still applies |
| LinkedIn | 2–9 images |
| X / Bluesky | 2–4 images |
| TikTok / Threads / Facebook Page | 2–10 images |
| Google Business Profile / YouTube | Single attachment only |
| Twitch | No publishing |

Pinterest remains hidden and unchanged. Threads keeps its released image-only
capability. Instagram crops to the first item's ratio. TikTok photos continue
to use MEDIA_UPLOAD delivery to the user's inbox.

## Database boundary and rollback

The Worker calls `claim_due_social_post_targets_v2`, including while admission
is off. Only a PGRST202 missing-RPC response falls back to the legacy claim, so
single-file publishing continues if the Worker deploys before migration 0395.
Keep carousel admission disabled until the migration is installed. V2 returns the existing fields plus the full
ordered list with position, type, key, MIME type and byte size. Invalid or missing
items remain in the list and fail the whole carousel before provider submission.
The new list verifies source ownership against the post creator.

The migration redefines `claim_due_social_post_targets` to claim only posts with
exactly one media row. This predicate is outside all pending, submitted and stale
reclaim alternatives. Compatibility is decided at claim time; restoring a post
or approving a request cannot bypass it. Both RPCs are security definers with an
empty search path, denied to PUBLIC/anon/authenticated and granted to service_role.
No new table or RLS policy is needed.

Rollback: turn admission off and deploy the legacy Worker, leaving migration
0395 installed. Single posts continue; queued/restored and in-progress carousels
remain held by the legacy claim boundary until a v2 Worker returns. Do not revert
the database boundary while carousel rows exist. Turning the flag off alone
stops new admissions but allows the v2 Worker to finish existing targets.

## Dispatch, retries and previews

Validate all carousel metadata before any public submission, then presign each
object for 900 seconds. Instagram carousel routing precedes native video routing;
the native single-video handler rejects arrays with more than one item.

Instagram and Threads create all missing children in one tick and poll all
children together, with three attempts and two-second waits. The parent can be
created, polled, published and read in that same tick when ready. The claim-bound
`checkpoint_social_carousel` RPC persists each creation intent and returned ID
without releasing the claim; it also updates the hold-restoration snapshot. They use the existing
durable `mark_social_provider_submission` fence immediately before publishing the
parent. Once marked, an unknown result requires reconciliation; it is never
blindly republished. If a crash loses a container response or its ID checkpoint, the persisted intent
requires reconciliation instead of recreating that child or parent. A provider
response cannot be recovered atomically with the database checkpoint; this
fail-closed behavior can leave an unpublished orphan requiring manual recovery. Other adapters retain their
existing final-submission fences; Bluesky retains its deterministic record key.

Meta and TikTok pull URLs use the existing signed media proxy for a bounded
two-hour workflow plus a one-minute margin (7,260 seconds). This is a deliberate
exception to short preview TTLs: the provider may fetch asynchronously after the
Worker's tick. Dispatch checks holds before signing and again before final
submission. As with existing video transfers, already issued proxy tokens remain
usable until expiry; the proxy does not recheck holds. R2 signatures stay at
900 seconds. The public review reader uses its existing preview TTL, returns all
attachments in order and never signs a held attachment. The legacy first-media
field remains available to older readers.
Known limitation for a follow-up covering all networks: `/media/social/[token]`
verifies only the token, with a carousel token lifetime of 2h+60s and no
per-request hold re-check, matching the existing single-image Threads/TikTok behavior.

Web and mobile use ordered selection, removal, up/down controls, destination
blockers and the same translated `app.publish.*` strings in all 11 locales.
Types come from each attachment, replacing the web global media-type selector.
Retry signatures include all ordered identities and types. Mobile single-file
signature bytes remain compatible with saved keys. Account changes discard native
picker results and cached copies. No drag reordering or scheduling changes.

## Provider verification and rollout gaps

Checked on 2026-10-25:

- [LinkedIn MultiImage](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api?view=li-lms-2026-07)
  documents up to 20 images; retain the frozen conservative product cap of 9.
- [TikTok photo posts](https://developers.tiktok.com/docs/en/content-posting-api-reference-photo-post)
  documents up to 35; retain the frozen product cap of 10.
- [Meta's Threads collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api)
  documents 2–20 carousel children; retain the product cap of 10 images.
- [Bluesky posts](https://docs.bsky.app/docs/tutorials/creating-a-post)
  documents four images; retain the existing adapter's conservative 1 MB per image.
- [X official documentation](https://github.com/xdevplatform/docs/blob/main/x-api/posts/manage-tweets/introduction.mdx)
  documents four photos and no mixed photo/video attachment set.

Instagram and Facebook primary documentation retrieval was blocked by HTTP 429
or inaccessible pages during implementation. Their frozen caps and transports
are implemented, but current provider verification is **not complete**. Proposed
deviation: keep admission disabled until a reviewer can verify those official
contracts and run provider smoke tests. Fake-provider tests are not evidence of
live provider acceptance. No live posting was performed.

Migration 0395 was selected after main ended at 0394. ADR 0262 follows main's
0260 and the open PR reserving 0261. Recheck both numbers before integration.

The standalone flag increases the public-variable guard from 62 to 63. At the
documented 50-secret footprint that is 113 text bindings, 15 below the limit of
128; the separate total-binding guard remains in force. The existing Composer
already exceeds the 500-line source guideline; retain its local selection edits
and put new selection rendering/helpers in separate small files rather than
undertaking an unrelated composer rewrite.

## Verification

Root tests cover all network count/type boundaries, API admission, fake-provider
payloads, Instagram routing combinations, continuation checkpoints, missing later
items, lost publication results, localized web rendering and held review items.
Mobile Jest covers selection, ordered signatures, payloads, picker fences and
cleanup. Regenerate Vey inventory and the mobile web-key catalogs after UI edits.

`node scripts/test-social-carousel.mjs` requires a disposable local replay DB
through 0394 and rolls back the migration and fixtures. It tests migration replay,
source ownership, ordering, idempotency, legacy/v2 compatibility including restored
and in-progress posts, review holds, guarded in-tick checkpoints and function ACLs. It could not run here because
that local database is not configured.

The agreed `npm test` proof must use `~/.local/bin/with-build-slot npm test`.
The sandbox denied the shared lock file, so the final wrapped proof is blocked.
Do not replace the shared lock with a private lock to bypass serialization.
