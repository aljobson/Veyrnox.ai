# ADR-0013 — Credit expiry policy

Status: **accepted** — 2026-09-11 (Al: "go with recommendation")

## Context

The landing FAQ and Terms needed a definitive answer on whether credits
expire. Two credit sources exist: the 50-credit sign-up grant
(`reason = 'grant:signup'`) and, from Phase 2, purchased credits.

## Options

1. Nothing expires. Simplest; unbounded free-tier liability.
2. Purchased never expire; free credits expire 90 days after grant.
3. Everything expires after N months. Hostile to paying users.

## Decision

**Option 2.** Purchased credits never expire. Free sign-up credits expire
90 days after they are granted if unused. Free credits are consumed
before purchased credits.

## Enforcement

Deferred to Phase 2 (billing launch). Today every balance is 100% free
credits, so there is nothing to distinguish; policy is stated in Terms
and the FAQ from now so no user is surprised later. Implementation plan
when billing lands: ledger entry `reason = 'expire:free'` with negative
delta for the unused free remainder, via a pg_cron sweep alongside
`expire_assets` (ADR-0008). Purchased-first-vs-free-first ordering is
enforced in `ledger_debit`.

## Consequences

- FAQ line un-hedged: "Purchased credits never expire. Free sign-up
  credits expire 90 days after they're granted."
- Terms §3 and Refund Policy updated to match.

## Enforcement addendum — 2026-09-13 (#102)

Enforced by migrations `0037_free_credit_expiry` and `0038_free_credit_sweep_fixes`, ahead of Subscriptions
(ADR-0018). Vocabulary follows `CONTEXT.md`: Free Credits, Pack Credits.

- Only `grant:signup` credits are Free Credits. `ledger_entries.free_delta`
  records the part of each row that moved Free Credits and
  `credit_balances.free_balance` materialises its sum, constrained to
  `0 <= free_balance <= balance`.
- `ledger_debit` spends Free Credits first. `ledger_refund` returns a
  Credit Refund to the source the debit took it from.
- A Top-up Refund clawback (#96) must cap at `balance - free_balance`; the
  constraint rejects any write that would reduce Free Credits instead.
- `expire_free_credits()` runs hourly on pg_cron and writes one
  `expire:free` row per user for the unspent remainder 90 days after the
  grant. A partial unique index allows only one. It waits while a
  generation that took Free Credits is still unsettled, so a later Credit
  Refund cannot restore Free Credits after their grant has expired.
- Rows written before the migration have `free_delta` NULL and count as
  Free Credits in full, matching the pre-billing state recorded above.
- `reconcile_free_credits()` joins the nightly reconcile and must return
  zero rows.
- `GET /api/v1/balance` returns `free_credits` and `free_expires_at`; the
  credits page shows them while any remain.
