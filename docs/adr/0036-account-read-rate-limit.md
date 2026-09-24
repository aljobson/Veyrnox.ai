# ADR-0036 — Share a request quota across account and balance reads

- Status: Proposed; staged with enforcement disabled pending migration 0117.
- Date: 2026-09-24
- Related: audit API rate-limit finding, ADR-0008 job reads

## Problem

GET /api/v1/account and GET /api/v1/balance have no request bound. Account reads
include identity, credits and an exact count of the caller's assets. Alternating
between endpoints can repeatedly trigger database work without creating jobs.

## Decision

Share 120 requests per account per fixed 60-second window across these two
routes. This permits an average of two reads per second for header hydration,
refresh after actions and multiple tabs. It is independent of generation,
job polling, asset links, upload URLs and Top-up status polling. Exhausting the
account bucket does not prevent payment recovery or consume credits.

After identity and configuration checks, call consume_account_read_request(TEXT)
before any credits, user lookup or asset count. Return 429 with Retry-After and
no-store on denial. Failure or a malformed verdict returns 503 and performs no
downstream lookup. Unknown users allocate no quota row and receive the existing
zero balance/account shape directly; verified email is preserved when present.
Normal balance data, expiry fields, ownership filters and graceful asset-count
failure behavior remain unchanged. Neither read_user_credits nor money RPCs
are modified, so their other callers do not consume this quota.

Migration 0117 stores one operational counter per provisioned user, with an
atomic upsert across Workers. Denied counts saturate at 121 without moving the
window. The table forces RLS and revokes direct API-role access; the RPC is
service-role-only, VOLATILE, SECURITY DEFINER with empty search_path. Account
deletion cascades the counter. There are no monetary mutations.

This is a fixed-window limit, so bursts can straddle boundaries. It does not
bound unknown accounts beyond their single lookup, aggregate traffic across
accounts, unauthenticated requests or other API endpoints. Edge limits and
asset-count query performance remain separate work.

## Rollout and rollback

Merge with ACCOUNT_READ_RATE_LIMIT_ENABLED=false. Apply 0117 only through the
owner-approved apply-migrations workflow, verify the ledger and reconciliation,
then enable the server flag in a separate deployment. This secures existing
read endpoints rather than creating a new browser path, so the 24-hour browser
path gate does not apply. Roll back enforcement by disabling the flag; retain
applied migrations and their ledger entries.

## Verification

Exercise parallel requests on twelve connections (exactly 120 of 140 allowed),
independent accounts, reset, saturation, migration replay, unknown users and
RLS/privileges. Clean provision-only fixtures. Route tests prove both endpoints
use the same RPC with verified identity, denial stops all further queries,
normal data/ownership and count degradation survive, unknown-user responses
stay compatible, and the disabled handler works before migration application.

## Activation checklist

The activation change sets ACCOUNT_READ_RATE_LIMIT_ENABLED=true. Do not merge
or deploy that change until migration 0117 has been owner-approved and applied
successfully, the prerequisite application deployment has succeeded, and fresh
migration-ledger and reconciliation checks pass. Record those results here
before marking the activation PR ready. No additional migration is required.
