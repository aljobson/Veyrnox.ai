# ADR-0042 — Account and HTTP boundaries

Date: 2026-09-24
Status: Proposed

## Problem

The September 24 audit found unscoped browser history surviving invalidation,
unbounded request bodies, response deadlines ending at headers, misleading
refund/draft UI, unused attribution collection, an uncached catalog alias and
reap bookkeeping that reported success after a rejected database mutation.

## Decision

- Key job display caches by the signed-in account and erase all cache versions
  on invalidation/account changes. Remount account UI and pollers on identity
  changes, including cross-tab events. Discard late gateway responses for an
  old account; a stale refresh failure must not invalidate a new account.
- Before OpenNext parses a body, enforce 64 KiB for normal writes and 1 MiB
  for webhook writes, plus a ten-second read deadline. Count actual streamed
  bytes, retain exact signature bytes and reject with 413/408. Admin screening
  remains ahead of body reading. Upload files still travel directly to R2.
- Small outbound API responses have a 2 MiB ceiling and a deadline through
  complete body consumption; media range reads use their requested byte count
  as the ceiling. Caller cancellation propagates. The Supabase client uses
  this same path. Large media transfer remains in the streaming R2 adapter.
- Forward authoritative refund state into Credits; failed alone never means
  refunded. Label prompt editing as an unsaved draft. Remove unused campaign
  capture and remove existing attribution records when a page mounts.
- Authenticated credit-pack reads use the same public catalog cache. It contains
  only public prices, never account data.
- Check every reap-queue mutation response. A bookkeeping failure reports
  failure, leaves the row retryable, and never counts an unrecorded deletion.

No ledger mutation, migration or production configuration change is included.
Upload reservations/immutability and privileged reconciliation are separate
follow-up changes, as are account self-service and operational verification.

## Validation

Regression coverage includes invalidation/account switches, stale refresh
rejection, raw webhook bytes, oversized/stalled bodies, cancellation and
failed reap bookkeeping. Existing application tests remain the release gate.
