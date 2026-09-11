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
