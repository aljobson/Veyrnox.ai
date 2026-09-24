# ADR-0035 — Bound upload URL requests before R2 work

- Status: Proposed; staged with enforcement disabled pending migration 0116.
- Date: 2026-09-24
- Related: audit API rate-limit finding, ADR-0034 generation attempts

## Problem

POST /api/v1/uploads reads a balance, lists R2 objects, and signs a PUT URL.
A caller with credits can repeatedly request new URLs without uploading any
objects. The existing stored-object count never increases in that case and
cannot bound request volume. It is also a snapshot, not an atomic reservation:
concurrent issuance and delayed PUTs can exceed the nominal ten-object cap.

## Decision

Allow 60 valid upload-URL requests per account per fixed 60-second window.
This leaves room for multiple source files around the existing ten-generation
allowance and for retries. Count requests before balance reads, R2 listing,
and signing, including requests later rejected for balance or storage state.
Malformed identity, JSON, media type or declared size is rejected first.
Denied requests return 429, a bounded Retry-After and Cache-Control: no-store.
An unavailable or malformed quota response fails closed with 503.

Migration 0116 adds consume_upload_request(TEXT) and one counter row per user.
An atomic upsert serializes concurrent requests across Workers; counters stop
at 61, denials do not move the window, and deletion cascades with the user.
Unknown accounts allocate no counter and retain the upload route's 409.
The RPC is service-role-only, VOLATILE, SECURITY DEFINER with empty search_path;
the table forces RLS and revokes direct privileges from all API roles.
No credit, job or asset mutation occurs. Existing balance and MIME checks stay.

Fix the stored-object threshold to refuse at ten (previously only above ten).
This does not make it a strict reservation or byte budget. Presigned PUTs remain
reusable until expiry, and declared sizes are not an enforced R2 Content-Length
bound. Fixed windows allow adjacent bursts. This change does not address many
accounts, unauthenticated traffic, hard storage budgets or other API routes.

## Rollout

Merge with UPLOAD_REQUEST_RATE_LIMIT_ENABLED=false. Apply 0116 only through the
owner-approved apply-migrations workflow on main, verify the migration ledger
and reconciliation, then enable the server flag in a separate deployment.
Before activation the handler is compatible with the pre-migration database.
The existing authenticated endpoint gains a security control, not a new browser
path; the 24-hour new-browser-path gate does not apply. Disabling the flag is a
rollback for enforcement; leave applied SQL and the migration ledger untouched.

## Verification

Twelve database connections issuing 80 concurrent requests admit exactly 60.
Test independent users, saturation, reset, replay, unknown accounts, forced RLS,
function privileges and cleanup of provision-only fixtures. Route tests prove
quota denials stop before balance/R2, retained balance and storage gates, signed
URL scoping and TTL, the nine/ten-object boundary, and disabled compatibility.
