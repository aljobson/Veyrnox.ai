# ADR-0051 — Gated resumable Cinema uploads

Status: Proposed, 25 September 2026. Extends ADR-0050; mandatory security overlay applies.

## Behavior and boundaries

Approved active Cinema creators can attach an MP4, WebM or MOV video to their own private FILM/SHORT/TRAILER/EPISODE draft. SERIES/SEASON containers cannot upload. The browser sends only metadata to Veyrnox and transfers video chunks directly to Stream. Content remains PRIVATE/DRAFT even after encoding; this is not a publication, rights clearance, moderation or playback increment.

Use Stream's REST tus creation API because the current Workers Stream binding provides basic POST direct upload, not tus creation. The scoped server token never reaches the browser. A one-hour grant fixes Upload-Length (up to 2 GiB), maximum duration (600 seconds), requiresignedurls and an opaque reservation name. REST requests use fixed Cloudflare origins, reject redirects and have deadlines; JSON reads have a 64 KiB ceiling. No remote URL import, caller-selected account, duration, Stream UID or publication field is accepted.

The browser uses 5 MiB chunks, HEAD offset recovery and PATCH acknowledgment validation. It sends no app authorization or cookies to Stream, suppresses referrers and aborts on pause/unmount/account switch. Resume requires reselecting the original file. A hash of filename/size/last-modified plus first/last 64 KiB prevents accidental mismatches; it is not full-file integrity, rights evidence or a security assertion. Only the hash and length reach our database, not the original filename. Transfer errors require explicit resume; no unbounded retry loop.

## Storage, concurrency and provider ambiguity

Migration 0135 creates forced-RLS, RPC-only `cinema_uploads`. Current Auth existence, creator role, active membership and content ownership are checked before reservation and before returning the grant. A fixed short database advisory lock serializes capacity checks and concurrent creation. Only the request that durably claims a new reservation may call Stream. Other requests reuse the existing reservation for the same content/hash/length; changed idempotency payload conflicts. A lost provider response remains in provisioning, counted against capacity, rather than making another billable video.

Preview caps are deliberately conservative: ten total reservations per creator and 100 globally, including failed, expired, ready and ambiguous reservations. This bounds storage reservation exposure to 1,000 minutes. These are preview capacity limits, not a subscription entitlement or a price. No automatic capacity release, replacement, delete/reset API or background orphan cleanup is implemented in this increment. Pausing does not delete or release a reservation. Failed/expired/ambiguous sessions require operational reconciliation before replacement; do not enable broad uploads with those workflows unfinished.

Upload records RESTRICT draft/profile deletion so a database cascade cannot orphan billable media. G10 activation requires a reviewed provider-first deletion/cleanup workflow and retention policy. Support must confirm provider deletion before removing upload records, then erase the profile/drafts through the approved operational process. Auth deletion immediately denies upload access but does not itself erase provider media. Do not claim account erasure is complete on Auth deletion alone.

## Completion and security

GET `/api/v1/cinema/uploads?content_id=…` reads own status. POST on that route reserves/provisions with UUID Idempotency-Key and exact content_id/file_size/fingerprint. POST `/api/v1/cinema/uploads/refresh` rechecks provider state; GET has no database mutation. Owner routes require master, profile, content and upload switches and the existing durable 120/min account quota. JSON/body/query/header validation, no-store responses and redacted correlated events follow the existing gateway.

`/api/webhook/cinema-stream` uses HMAC-SHA256 over exact raw bytes, a five-minute timestamp window and Web Crypto verification. It verifies the callback before any provider/database work, reads authoritative video details using the signed UID, and persists only bounded state/duration/dimensions. Unknown UIDs are ignored by the database. Completion callbacks continue while UI flags are off. A repeated or older observation cannot regress a terminal state; no callback can publish content. Ready requires full encoding, readyToStream, signed URLs, duration in range and valid dimensions. Error details/provider payloads are never returned or logged. This is media-format verification, not safety classification.

CSP adds exactly `https://upload.videodelivery.net` and `https://upload.cloudflarestream.com` to connect-src. No wildcard, new script, frame, image or playback host is allowed. URL validation repeats that allowlist in server and browser. New upload host support requires another documented change. Existing R2, Auth and credit generation routes are unchanged.

## Configuration and activation gates

Set `CINEMA_STREAM_ACCOUNT_ID` plus server secrets `CINEMA_STREAM_API_TOKEN` (Stream Edit/Read for the intended account) and `CINEMA_STREAM_WEBHOOK_SECRET`. No matching Cinema Stream secrets were present in the deployed Worker name inventory on 25 September. No credential or webhook configuration was changed by this PR. Stream allows one webhook per account: inspect existing consumers and choose isolated preview resources before configuring this endpoint; never overwrite an unrelated subscription.

`CREATOR_UPLOADS_ENABLED` remains false, and content/profiles/master remain false. Activation requires migration approval, the 24-hour clean reconciliation gate, isolated signed-in upload/pause/resume/webhook tests, token/account scope verification, rights and content policy, G05 CI scans and G10 cleanup/deletion/retention controls. No live Stream integration evidence exists yet. Poll reconciliation is creator-triggered in this increment; scheduled reconciliation, provider cleanup, replacement/cancellation and controlled playback are subsequent work.

## Validation and security record

New boundaries: creator to provider upload capability, provider webhook to private media state. New data: opaque file fingerprint, length, short-lived grant and provider UID. Money: bounded provider storage reservations; no credit/subscription/cash-ledger mutations. No new runtime dependency. Unit tests cover exact provider requests, SSRF/redirect limits, private encoding validation, signature freshness/raw bytes, tus offsets, quota/flag/identity denial and single provisioning. Isolated Postgres tests replay migration and cover concurrent claims, ownership, role/status/Auth revocation, capacity, terminal state/replay, grants/RLS, no public publication and unchanged credits. Live credentials and provider behavior remain unverified release gates.

Sources checked 25 September 2026: [direct creator uploads](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/), [tus requirements](https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/), [webhook verification](https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/).
