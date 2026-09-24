# ADR-0041 — Bound Stripe return-session recording

- Status: Proposed; enforcement disabled pending migration 0125 and activation.
- Date: 2026-09-24
- Related: ADR-0033 Stripe recovery, ADR-0038 checkout attempts, ADR-0040 reads

## Decision

Allow 30 valid return-recording attempts per account per fixed 60-second window.
Validate authenticated identity, Top-up ID and Checkout Session shape before
consuming quota, then call the existing ownership-scoped recording RPC unchanged.
Every attempt counts, including replays and attempts on missing/foreign Top-ups.
Changing Top-up or session IDs cannot create a different account bucket.

This quota is separate from checkout and history/status quotas. Neither polling
nor checkout attempts can exhaust it. Webhooks and scheduled recovery never call
the new limiter. Recording still grants no credits; recovery independently
verifies Stripe payment data before crediting through the existing money RPC.

Migration 0125 creates one operational row per user. An atomic upsert serializes
concurrent calls; denied counts saturate at 31 without extending the 60-second
window. Forced RLS, direct table privilege revokes, service-role-only execution
and an empty search_path protect the counter. User deletion cascades. Unknown
users allocate no rows and retain a 404 response. No money tables are altered.
Fixed windows permit boundary bursts; this is not a global traffic cap.

Quota denials return 429 with no-store and a retry hint bounded to 1–60 seconds.
Unavailable/malformed quota responses fail closed with 503 and Retry-After: 30.
The browser makes at most three attempts on 429/503, respecting bounded backoff,
while status polling continues independently. Other failures retain best-effort
behavior and do not retry. The browser removes the session from the URL immediately
and retains it only in memory during retries. Cleanup cancels outstanding work;
a ref preserves the session across React effect restarts without localStorage.
Each retry posts the same owner-scoped Top-up/session pair. Exhausting all retries
or leaving the page can still lose this best-effort hint; verified webhooks remain
the primary payment delivery path. No durable browser queue is introduced.

## Rollout and rollback

Merge with TOP_UP_RETURN_RATE_LIMIT_ENABLED=false. Apply 0125 through the
owner-approved protected main workflow, verify migration ledger/reconciliation,
then enable the flag in a separate PR. This changes an existing browser path;
it does not introduce a new route. Disable the server flag to roll enforcement
back, retaining the applied migration and bounded browser retry behavior.

## Verification

Tests cover early validation and denial, independent quota selection, replayed
arguments, bounded retry hints, unavailable quota, disabled compatibility and
browser retry/cancellation/effect restart behavior. Real Postgres tests exercise
concurrent admissions, separate users, saturation, reset, migration replay and
role/RLS restrictions. Provision-only test users are cleaned without modifying
the append-only ledger. Existing Stripe recovery/idempotency tests remain gates.
