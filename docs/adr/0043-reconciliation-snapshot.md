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
