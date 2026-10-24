# ADR-0259: One manual credit grant for the Veo Fast and Seedance Fast live tests

Status: Accepted (owner approved in chat, 2026-10-24)
Date: 2026-10-24
Decision-maker: Al Jobson (owner), who asked in chat on 2026-10-24 to go with the recommendation of running both
models on the live site.

## Context

CLAUDE.md allows credits to be granted only through `signup_grant` and `ledger_grant`, and a manual grant needs a
written ADR and a `reason` that names the human who made the decision. ADR-0258 covered one earlier grant (Veo Lite)
and says any further grant needs its own ADR.

Crun is now the first route for `veo-3.1-fast-kie` (9 credits, migration 0386) and `seedance-2.0-fast` (19 credits,
migration 0387). Neither has yet run a real customer-path job: only Veo Lite has, end to end. The test account
`veyrnox.triage@gmail.com` (the owner's own mailbox, user id 63113ab0-30af-4109-9231-7390c4974512) holds 8 credits, and
the two jobs cost 28 together.

## Decision

Grant **25 Pack credits** (not Free Credits, not Subscription Credits) to that account, once, through
`public.ledger_grant` with an idempotency key, so a replay is a no-op:

```sql
SELECT public.ledger_grant(
  '63113ab0-30af-4109-9231-7390c4974512'::uuid,
  25,
  'grant:owner-test:crun-fast-live-test:decided-by-al-jobson',
  'crun-fast-live-test-20261024'
);
```

- 8 held + 25 granted = 33, enough for one Veo Fast job (9) and one Seedance Fast job (19) with 5 left over.
- The RPC is the only writer: no direct row insert into the ledger and no direct update of balances.
- The grant is the owner's own account, never a customer's.

## Consequences

- One ledger row: delta +25, reason as above. The balance invariant and `reconcile_balances()` are unaffected.
- Cost to us: 25 credits (about $1.08 at the top pack rate), plus about $0.47 of Crun spend when the two jobs run.
- Any further grant needs its own ADR. This one is not a precedent.

## Verification

- `reconcile_balances()`, `reconcile_free_credits()` and `reconcile_subscription_credits()` return zero rows afterwards.
- The attempt row of each test job shows supplier `crun`, then `completed`, and each clip is stored.
