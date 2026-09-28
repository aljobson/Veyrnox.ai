# ADR-0054 — Creator-requested Stream removal and replacement

Status: Proposed, 25 September 2026. Extends ADR-0052/0053. Default off.

Creators need to abandon a failed/expired video or replace the video on a private draft. Add an explicit two-step removal control beside upload status. The confirmation states that video removal is permanent and preserves the draft/title/description. Pause an active transfer before removing it. The UI sends both content ID and the exact upload ID shown, plus a stable UUID request key. A stale tab can therefore never remove a newer replacement implicitly.

POST `/api/v1/cinema/uploads/remove` uses verified identity, strict JSON/UUID validation, bounded bodies, the existing durable account quota, no-store responses and redacted request IDs. Migration 0139 checks current Auth existence, active creator membership, draft ownership and matching upload/content. Unknown provisioning outcomes remain blocked for operator reconciliation; no absence is inferred from a missing UID. The independent `CINEMA_UPLOAD_REMOVAL_ENABLED` switch allows an enabled removal route and worker to continue when new uploads are paused. The existing creator workspace itself still requires its preview/read gates.

## Provider-first state and concurrency

Removal changes the row to `deleting` and withdraws the stored upload grant immediately. It does not release capacity. The five-minute worker claims at most ten requested removals, makes at most two provider requests concurrently, and calls the completion RPC only after an affirmative successful DELETE response (204, or 200 with success=true and an empty errors array). Requests use the existing fixed Cloudflare origin, scoped server token, ten-second deadline, 64 KiB response bound and redirect denial. No browser-supplied UID/account can reach deletion. No provider account inventory is scanned or deleted.

Transient claims last five minutes and use oldest-claim ordering with SKIP LOCKED. Failed requests keep their records and retry on later passes. A repeated completion is harmless; a late completion with a superseded claim cannot change the row. Completion clears provider UID/grant/media dimensions and marks `deleted`. Only then does the active reservation stop counting and a new upload for that draft become possible. A partial unique index retains one non-deleted upload per draft; immutable creation keys and deletion keys remain on private tombstones so old requests cannot reprovision or delete a replacement. Callbacks/refreshes cannot revive deleting/deleted rows. Lock ordering follows reservation -> membership -> upload; no provider I/O holds a database lock.

Storage caps remain ten active reservations per creator and 100 globally. Add rolling 24-hour creation caps of ten per creator and 100 globally, including removed uploads, so replacement cannot turn deletion into unlimited provider churn. Removal frees storage capacity, not the daily creation allowance. Tombstones retain minimal replay inputs and owner/content linkage; full account-erasure and an approved retention/purge policy remain G10 work, and profile/draft deletion still RESTRICTs on these records.

Generic 404s, auth failures, redirects, timeouts, invalid responses and uncertain provider outcomes never count as confirmed removal. If Stream deletes a video but the success response or database completion is lost, a subsequent 404 remains unresolved: operators must reconcile it rather than automatically free capacity. No manual override endpoint is added. Deletions pending over thirty minutes join the existing aggregate `cinema_cleanup_required` count. Structured worker logs expose counts only.

## Rollout and security evidence

Migration 0139 requires owner approval through the protected production workflow. All Cinema flags, including removal, remain false. No real videos are deleted and no credentials changed by implementation/tests. Before enabling: scoped credentials, isolated live remove-during-transfer and retry tests, migration/24h reconciliation gates, and the existing G05/G06/G08/G09/G10 policy controls. In particular, verify that Stream deletion invalidates an already-copied tus grant; withdrawing it from our API alone does not revoke a bearer capability. Do not enable wider uploads without that evidence.

This increment implements creator-requested cleanup of known private media. It does not automatically erase accounts, automatically delete expired/error media without a creator request, reconcile unknown provisioning UIDs, approve retention, moderate content or provide playback. G06/G10 remain partially open.

Tests: adapter confirmation/SSRF/body bounds; HTTP identity/quota/ownership/input and independent gate; bounded concurrent worker failures; isolated SQL replay/claims/leases, exact-ID idempotency, old keys, stale tabs, callback races, replacement, active/daily caps, grants, Auth/status denial, private draft preservation and unchanged credits. UI reuses the existing Button (including danger variant), tokens and inline confirmation pattern after 21st search. Mocked provider/browser evidence cannot prove live provider deletion.

Reference checked 25 September 2026: [Cloudflare Stream delete video API](https://developers.cloudflare.com/api/resources/stream/methods/delete/). The documented operation deletes the video and its copies; acceptance of real response variants and in-flight tus invalidation remains an explicit integration gate.

Local browser fixtures verified exact upload-ID submission, initial focus on Keep video, focus return on cancel, pending-removal messaging, and replacement controls only after a null upload response. Narrow-screen controls remained accessible. No real provider calls or media deletion occurred; temporary session/interception/viewport fixtures were removed. The deterministic 21st review reported zero findings.

## Safety hold — 28 September 2026

Live staging proved that Stream video DELETE does not revoke an incomplete tus
URL: after confirmed deletion the next valid 5 MiB PATCH succeeded (204) and
advanced the offset. DELETE on the tus URL itself returned 405. The rollout
gate above has failed; metadata deletion must not be treated as revocation.

`DIRECT_UPLOAD_SAFETY_HOLD` is a code-enforced hold, not an environment opt-in:
start/resume API calls return `upload_safety_hold` before reservation/provider
work, all upload projections suppress bearer URLs, and the removal scheduler
returns `upload_revocation_unverified` without deleting or finalizing claims.
Owner-scoped reads, refresh, and removal requests remain available; removals
stay pending and retain their counted reservations and provider identifiers.
UI copy explains the pause and does not promise completion within minutes.
Existing externally copied grants are not revoked by this containment; already
finalized test tombstones are not retroactively reconciled by it.

Remove the hold only after a reviewed design can enforce the required upload
revocation boundary and live tests prove it. A server-mediated transfer design
must keep provider URLs server-side, check current ownership/removal state on
every chunk, bound transfers, and serialize in-flight writes against deletion.
An expiry-based approach needs live proof that expiry stops existing sessions,
retained capacity until that boundary, and post-boundary provider cleanup;
simply waiting for a timestamp is not sufficient evidence.

References: [Direct creator uploads](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/)
and [tus uploads](https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/).

## Server-mediated transfer replacement — 28 September 2026

Migration 0158 and the corresponding Worker path implement the replacement
behind the existing safety hold. New reservations are marked
`server_mediated`; legacy direct reservations remain quarantined and return
`upload_needs_reconciliation`. The browser receives only an application
transfer path. It never receives, stores, or sends requests to the provider
grant. The Worker obtains the grant from an owner-scoped database claim,
restricts its origin, reads the provider offset, and forwards one bounded 5 MiB
tus chunk. Authentication and cookie headers are never forwarded.

Each GET or PATCH takes an exclusive durable transfer claim. A creator removal
may move the row to `deleting` while a PATCH is in flight, but the removal
worker cannot claim or complete that deletion until the confirmed PATCH has
released its transfer claim. Any ambiguous provider PATCH response retains the
claim without a timeout and requires operator reconciliation; automatic retry
could otherwise duplicate a write or race deletion. Validation and HEAD
failures before a write safely release it. The upload-specific durable quota
limits transfer requests to 60 per minute per account. Structured logs contain
request IDs, actor IDs, method, status and stable error code, never grants.

The safety hold remains active while this implementation is deployed for
inactive-path verification. Lifting it requires the staging migration, a live
server-mediated pause/resume test, removal during an incomplete transfer,
confirmed provider deletion, and proof that a browser captured no provider
grant. Existing grants copied before migration 0158 remain outside this new
boundary and must not be treated as revoked.
