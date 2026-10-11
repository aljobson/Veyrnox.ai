# ADR-0043 — Bounded public reconciliation reads

Date: 2026-09-24
Status: Proposed; production migration 0128 requires owner approval

## Problem

An anonymous call to reconcile_status recomputed four privileged aggregates
on live money data. Request quotas at the Worker cannot protect direct calls
to Supabase. Removing the public grant alone would blind the hourly watcher.

## Decision

A trusted pg_cron job refreshes a singleton snapshot every fifteen minutes.
Only the service role or database owner can invoke the expensive refresh;
there are no browser table grants. RLS is enabled and forced. Anonymous
reconcile_status retains its four-count contract but reads only the singleton.
It raises on missing, future-dated or more-than-45-minute-old data. The hourly
watcher therefore fails closed when refresh stops. No service credential is
added to Actions. The independent nightly drift-raising cron stays unchanged.

The initial refresh and function replacement commit together during migration.
Repeated reads cannot trigger refreshes. Drift visibility is delayed by at most
the refresh interval plus watcher scheduling. Operators needing immediate
counts can explicitly invoke the trusted refresh or underlying reconciliation
functions. Snapshot data contains counts and timestamp, not customer records.

## Validation and rollout

Fresh replay plus a transaction-scoped fixture tests repeat application,
role grants, forced RLS, propagation of nonzero cached drift, refusal of stale
or missing state, and proves an anonymous read does not execute a live aggregate.
The fixture rolls back. CI runs it against the fresh rebuild database.

After approved application, verify cron scheduling, a successful refresh,
zero drift and a green reconcile-watch. Failure to refresh is an operational
incident; do not bypass the freshness check to silence it.

## Amendment — retain measured launch evidence (2026-10-11)

The singleton cannot prove a full clean observation window. Retained Actions
samples jumped from 10 October 23:30:18 UTC to 11 October 01:16:38 UTC, leaving
no measured counts in hour 00. Successful snapshot cron rows prove execution,
not the counts then present. Latest zero counts cannot fill this gap.

Migration 0290 adds private, append-only reconciliation observations. Each
existing fifteen-minute refresh records all seven actual counts and updates
the public singleton atomically from that same measurement. An aggregate
failure writes neither record. Initial application and replay take new real
measurements; no older snapshot is copied and no historical zero is inferred.
The public freshness guard, anonymous counts-only RPC, existing cron cadence,
ledger and pricing remain unchanged. The history has forced RLS, explicit
browser/sequence revokes and service-only SELECT; the private schema stays
unexposed. A statement trigger rejects UPDATE, DELETE and TRUNCATE.

After owner-approved application, use the retained timestamps and counts to
check the entire required window, including any nonzero samples and gaps.
Repeated samples at one timestamp do not provide additional hourly coverage.
History begins at application and does not retroactively clear the missing
hour above. Keep launch flags closed until the required evidence is complete.

A rollback-only local PostgreSQL acceptance test checks repeat application,
matching history/snapshot counts, real fixture drift surviving a later clean
refresh, failure atomicity, append-only enforcement, forced RLS and actual
browser/service permissions. CI runs it against the fresh migration rebuild.
