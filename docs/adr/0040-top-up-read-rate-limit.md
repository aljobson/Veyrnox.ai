# ADR-0040 — Bound Top-up history and status reads

- Status: Proposed; enforcement disabled pending migration 0123 and activation.
- Date: 2026-09-24
- Related: audit API request limits, ADR-0033 recovery, ADR-0038 checkout attempts

## Decision

Share 120 reads per account per fixed 60-second window across GET /api/v1/top-ups
and GET /api/v1/top-ups/:id. Validate the middleware identity and status ID before
consuming quota, then retain the existing ownership checks and response fields.
Changing Top-up IDs or alternating history/status cannot select another bucket.
The quota allows normal checkout polling with headroom for multiple tabs; callers
sharing an account also share the quota. Fixed windows allow boundary bursts.

Check quota before history's user lookup or the status RPC. Return typed 429,
Retry-After bounded to 1–60 seconds and no-store when exhausted. Missing, failed
or malformed quota responses fail closed with 503 and a 30-second retry hint.
Unknown users receive the existing empty history or status 404 without more
queries. Admissions count even when a subsequent lookup fails or returns 404.

Migration 0123 adds one operational counter row per user, with an atomic upsert
serializing concurrent requests across Workers. Denied counts saturate at 121;
retries do not extend the window. The table forces RLS, revokes direct access
from application roles, and cascades on user deletion. Only service_role may
execute the SECURITY DEFINER function, which has an empty search_path. These
counters never debit credits or create purchase records.

Checkout attempts have their own quota. Stripe return recording, verified
webhooks and scheduled recovery do not consume this read quota. A client can
still record its returned Checkout Session and have its payment credited while
read-limited. Rate limiting return recording remains a separate follow-up.

## Rollout and rollback

Merge with TOP_UP_READ_RATE_LIMIT_ENABLED=false. Apply 0123 through the protected
main apply-migrations workflow with owner approval, verify migration ledger and
reconciliation, then enable the flag in a separate PR/deployment. No new browser
path is introduced. Disable the flag to roll enforcement back; retain the applied
migration. Do not rewrite applied migration files.

## Verification

Route tests cover shared scope, early denials, bounded retry, malformed results,
unknown identities, allowed ownership-scoped reads, disabled compatibility and
Stripe return independence. Real Postgres tests cover 140 concurrent requests
admitting exactly 120, independent users, saturation/reset, replay without quota
reset, unknown users and role/RLS restrictions. Provision-only fixtures are
cleaned without touching the append-only ledger. A fresh database successfully
replays all 116 migrations.
