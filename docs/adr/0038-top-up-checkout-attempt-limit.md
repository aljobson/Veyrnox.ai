# ADR-0038 — Bound Stripe checkout attempts, including replays

- Status: Proposed; enforcement staged off pending migration 0120.
- Date: 2026-09-24
- Related: audit API rate limits, ADR-0031 Stripe, ADR-0033 payment recovery

## Problem

POST /api/v1/top-ups limits new Top-ups to five per ten minutes. The existing
create_pending_top_up RPC returns an idempotent replay before counting new
rows, and the gateway then calls Stripe again. Repeating one valid key can
therefore cause unlimited checkout requests despite creating no further rows.
Stripe idempotency prevents duplicate creation within a time bucket; it does
not bound our database, signing or outbound-request work.

## Decision

Allow 20 checkout attempts per account per fixed 60-second window, including
retries and repeated idempotency keys. This leaves retry headroom above the
five-new-Top-ups-per-ten-minute rule, which remains unchanged. Validate identity,
JSON, pack/key shape and explicit supply consent before quota consumption. Check
the quota before create_pending_top_up and before any Stripe request.

Return 429 with bounded Retry-After and no-store on quota denial. Limiter failure
or malformed data fails closed with 503. An unknown user retains the existing
409 user_not_found response without allocating a counter. Failures after
admission still count; operational quota consumes no money or purchase slots.

Do not alter create_pending_top_up, credit_top_up, Stripe metadata, checkout
parameters, expiry buckets or idempotency keys. Frozen-account, pack and consent
rules still run in the existing creation path. Top-up status/history, the
browser return, verified webhooks and recovery are outside this bucket. A buyer
whose checkout attempt is limited can still complete an already-open checkout
and have their payment credited normally.

Migration 0120 adds one counter per user. An atomic upsert serializes requests
across Workers; denied counts saturate at 21 without extending the window.
Forced RLS, direct table privilege revokes, service-role-only execution and an
empty search_path protect the operational state. Deletion cascades with users.
Fixed windows permit bursts across boundaries; this is not an aggregate edge
limit or a change to other endpoints.

## Rollout

Migrations 0118 and 0119 are reserved by pricing PR #297. Apply them in order
before 0120 if they remain in that PR; their pricing changes require their own
owner approval. Do not approve a combined pending batch implicitly.

Merge with TOP_UP_CHECKOUT_RATE_LIMIT_ENABLED=false. Apply 0120 through the
owner-approved main workflow, verify ledger and reconciliation, then enable the
server flag in a separate deployment. The existing purchase endpoint gains a
security control, not a new browser path; the 24-hour new-path gate does not
apply. Disable the flag to roll enforcement back, retaining applied migrations.

## Validation

Concurrent requests admit exactly 20 of 40, with independent users, bounded
retry, reset, saturation, migration replay and role/RLS checks. Provision-only
fixtures are cleaned up. Route tests prove replays consume attempts and denials
stop before both the Top-up writer and Stripe. Verify original creation limits,
freeze/pack errors, consent checks, checkout amount, metadata, return template,
expiry/idempotency coupling, failures and disabled compatibility remain intact.
