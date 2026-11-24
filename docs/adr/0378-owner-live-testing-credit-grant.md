# ADR-0378: One manual 1,000-credit grant for the owner's live testing

Status: Accepted (owner approved in chat, 2026-11-24)
Date: 2026-11-24
Decision-maker: Al Jobson (owner), who asked for this grant in chat on 2026-11-24.

## Context

CLAUDE.md allows credits to be granted only through `signup_grant` and
`ledger_grant`, and a manual grant needs a written ADR and a `reason` that
names the human who made the decision.

The owner's production account (the admin account) holds 199 Pack credits and
is used to test live features end to end on veyrnox.ai: Crun Suno songs (8 credits
a pair), Kling and Seedance video, image and upscale jobs. Several tests in one
day, from several sessions, took about 70 credits, so the account will run dry
before testing is finished.

## Decision

Grant **1,000 Pack credits** (not Free Credits, not Subscription Credits) to the
owner's own account, once, through `public.ledger_grant` with an idempotency key,
so a replay is a no-op:

```sql
SELECT public.ledger_grant(
  '<owner user_id>'::uuid,
  1000,
  'grant:owner-test:live-testing-20261124:decided-by-al-jobson',
  'owner-live-testing-20261124'
);
```

- The RPC is the only writer: no direct row insert into the ledger and no direct
  update of balances.
- The grant is the owner's own account, never a customer's.
- Pack credits do not expire; they are spent by the same debit path as any other.

## Consequences

- One ledger row: delta +1000, reason as above. The balance invariant and
  `reconcile_balances()` are unaffected, because the grant goes through the RPC.
- Cost to us: 1,000 credits is about $33 of list-price value at the
  $0.033-per-credit figure the margin checks use. Real supplier spend happens
  only when the credits are used on jobs.
- Any further grant needs its own ADR. This one is not a precedent.

## Verification

- `reconcile_balances()`, `reconcile_free_credits()` and
  `reconcile_subscription_credits()` return zero rows afterwards.
- The account's balance reads 1,199 and the ledger shows exactly one new
  `grant:owner-test:live-testing-20261124` row of +1000.
