# ADR-0261 appendix: slice 5 device files

Status: Implemented in checkout; database and browser acceptance outstanding.
Date: 2026-10-26
Frozen order SHA256: `e7d209524f4c1df6cf630091403fbe5be7c8581b7013581ed23739a55355a399`.

## Flow and limits

The existing owner preview, browser switch and production flags are unchanged.
Check price builds a private export copy, dropping **all unused media bin entries**.
Only used device files need uploading. The timeline and saved project remain
unchanged. Local-file validation precedes quoting; the quote still uses local ids
and the same durations. Unsupported files receive per-file translated reasons.
Every new label is supplied in the same eleven locales as slice 4.

MP4 (`video/mp4`) is limited to 100 MiB; MP3 (`audio/mpeg`) and WAV (`audio/wav`)
to 20 MiB. Images, MOV, WebM, M4A and missing originals are refused. A batch may
contain at most ten local files; existing 40-clip and duration caps are unchanged.
No upload or debit happens until the user confirms the file count, aggregate MB,
retention statement and quoted price. Uploads are sequential, with progress and
cancellation for the active file. Cancel stops the batch; completed objects remain.

POST `/api/v1/uploads` accepts optional `batch_count` and `batch_bytes`. Before
issuing a grant it checks the real account reservations plus unreserved stored
objects through service-only `check_upload_batch_budget`. Its accounting matches
0129: ten objects/reservations and 200 MiB total, including unused or replaced
grants. This is an advisory snapshot; the existing locked `reserve_upload` remains
authoritative under concurrency. A refusal preserves completed files, uses a
specific translated message and charges nothing. The batch path fails closed
when strict upload reservations are disabled; ordinary upload callers are unchanged.

The gateway preserves upload budget/admission errors. The client passes every
returned grant header and the unchanged Blob to the PUT. **Browser constraint:**
JavaScript cannot set the forbidden `Content-Length` header; the browser derives
it from the Blob. This follows existing editor-delivery and chat upload behavior.
There is no CSP change: the existing R2 endpoints already allow direct uploads.
A real browser/R2 test must still verify bucket CORS and signed-header behavior.

Each file has at most three attempts per confirmation. A network error retries
with the same grant until its 15-minute expiry; refresh creates a new reservation
and retains the old budget. A PUT 412 is treated as possibly stored, leaving the
same key for create's storage checks. Completed files are reused while their
reservation anchor is younger than 23 hours. The anchor is captured immediately
before asking for the grant, never when a delayed PUT response is processed.
Expired completed files require renewed consent and a new upload. The deadline
is checked again immediately before the first create send. After that send the
body, quoted credits and idempotency key are immutable, including after source expiry.
The batch cache is account-bound and survives closing Export within the workspace;
account changes abort active requests, clear it and prevent create.

## Retention and admission safety

The original order's "deleted within 24 hours" is not achievable with the existing
sweeper. `sweepUploadReservations` selects reservations **older than 24 hours**
from `created_at`, deletes at most 50 per invocation and releases budget only after
confirmed deletion. `sweepUploads` also scans object modification age, every five
minutes, with a 50-delete limit. Backlog, failures and scheduling can delay deletion.
The consent therefore says: **"They are scheduled for deletion after 24 hours;
cleanup may take longer."** This is an explicit wording/retention deviation,
not a promise of a hard maximum. No new retention service or early deletion is added.

Concat jobs record a document, not `inputs.source_keys` or upload `references`;
these files are not treated as consumed by `sweepConsumedUploads`. They remain
for the age/reservation sweeps even after cancellation, failure or success. The
client never deletes them. New `u-` source resolution now requires reservations
younger than **23 hours**, leaving a one-hour margin before sweep eligibility for
the existing 45-minute render timeout. The runner downloads sources before rendering.
Recovery must remain enabled while jobs are outstanding, as required in slice 4.
The shared sweep's retention policy itself is unchanged.

Create checks the upload-admission gate for any `u-` source before source URLs or
debit. All sources are checked before any URL is signed. Uploads must have an
owned, fresh reservation, exact stored size/type and a valid bounded byte prefix
(MP4 ftyp, MP3 ID3/MPEG sync, WAV RIFF/WAVE); the body is cancelled after 16 bytes.
No file names, object keys, URLs or file bytes are added to logs.

## Replay and rollout

Migration 0401 adds owner-bound, read-only `replay_server_render`, checked before
source resolution. It shares the exact input-field removal comparison with admit
through `private.server_render_identity`. A match returns original credits/state
without reading deleted sources, signing URLs or another debit. A different document,
label, resolution, duration or owner cannot replay. All new functions explicitly
revoke PUBLIC/anon/authenticated and grant only service_role with full signatures.
Apply 0401 before the Worker; flags remain unchanged and off in this checkout.
0401 follows 0400 in the checkout and local `origin/main` reference. The current
remote main/open-PR migration-number check remains unverified in this sandbox.

## Proof and remaining acceptance

Tests cover consent/cancel/account-change, limits/remapping, aggregate budget
refusals, retry/412/expiry, delayed completion, immutable sent attempts, quote
parity, admission closure, bounded byte inspection and source-expiry replay.
The PostgreSQL suite uses the real 0129 reservation schema/functions and runs create
against real source/replay/admit RPCs, with simulated R2 bytes/deletion. It also
checks ACLs, migration idempotence and one debit after swept-source replay.

Host acceptance is still required: PostgreSQL suite on a fresh disposable local
database, full migration replay, actual browser/R2 strict PUT and a real render.
Here the PostgreSQL suite skips because `EDITOR_RENDER_TEST_DATABASE_URL` is unset;
`node scripts/replay-migrations.mjs` stops with `ERR_MODULE_NOT_FOUND` for `pg`.
Neither result proves database acceptance. No shared database, flag, commit, push,
deployment or publication was changed.

The generated `lib/generatedProductInventory.js` must be refreshed when UI source
changes, as enforced by `npm test`. Its prescribed generated format already exceeds
500 lines; retaining that format is the sole file-size deviation. The main ADR
links this appendix to stay under 500 lines.
