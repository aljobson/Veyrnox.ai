# ADR-0034 — Bound generation attempts before media inspection

- Status: Proposed; implementation prepared, production activation requires owner approval of migration 0112.
- Date: 2026-09-24
- Related: audit finding 06, PR #265, ADR-0008 signed-link limits

## Problem

The gateway checks `check_generation_rate_limit` before upload resolution and
Clip Editor media inspection. Until 0112, that check only counts created jobs.
A caller can repeatedly submit requests that pass cheap input checks, spend
source-lookup/signing/R2-header work, and fail before ledger_debit creates a job.
The job count stays zero, so that work has no per-account request bound.

## Decision

Add an atomic, per-account attempt counter inside the existing rate-check RPC:
20 requests per fixed 60-second window, shared across all Workers. This permits
retries around the existing ten-jobs-per-minute allowance. It is a fixed window,
not a rolling one; two bursts can straddle a boundary. Count every entry-check
call, including failed submissions and retries with the same idempotency key.
Attempts consume operational quota only, never credits. Money idempotency and
the authoritative job limit inside ledger_debit are unchanged.

One table row per user bounds storage. An atomic upsert serializes concurrent
attempts; denied counters saturate at 21 and do not extend the window. Account
deletion removes the row. RLS is enabled and forced, direct table privileges
are revoked, and the RPC remains service-role-only with an empty search path.
Its volatility becomes VOLATILE because it now writes a counter.

Preserve the RPC's three-argument signature and existing RATE_LIMITED response
shape. The current gateway already returns 429 plus Retry-After and stops before
source I/O on this verdict. Keep the created-job sliding-window check after the
attempt check. Reject invalid limits/windows before allocating a counter. No
extra round trip or application rollout flag is needed.

## Rollout and limits

Merge the migration and obtain owner approval through apply-migrations on main.
Applying 0112 activates this control for the already-deployed gateway; it is not
a dormant migration. Until application, the former behavior remains compatible.
This protects an existing authenticated request path, not a new browser flow.
Rollback requires a new approved forward migration restoring the previous RPC
definition; do not reapply old migrations or modify the migration ledger.

This bounds per-account attempts at pre-debit media work. It does not claim to
cap all traffic across many accounts, change per-file byte/read limits, or
replace edge rate limiting. Invalid requests rejected by cheap shape validation
before the RPC consume no quota and perform no source I/O.

## Verification

Exercise concurrent attempts that create no jobs, independent users, denial
saturation, reset, idempotent migration replay, privileges/RLS, and unchanged
created-job enforcement. Assert the gateway stops both upload and Clip Editor
requests on the new denial before any asset, R2, catalog, ledger or provider
call. Clean provision-only fixtures and roll back any money fixtures.
