# ADR-0258: One manual credit grant for the Crun Veo Lite live test

Status: Accepted (owner approved in chat, 2026-10-24)
Date: 2026-10-24
Decision-maker: Al Jobson (owner), who requested this grant in chat on 2026-10-24.

## Context

CLAUDE.md allows credits to be granted only through `signup_grant` and
`ledger_grant`, and a manual grant needs a written ADR and a `reason` that
names the human who made the decision.

Crun is now the first route for `veo-3.1-lite-kie` (reorder logged 2026-10-24
16:31 UTC, ADR-0256). Nothing has yet run a real customer-path job through
Crun. The owner's production account holds 8 credits and Veo 3.1 Lite costs 9,
so the live test cannot be run without one more credit.

## Decision

Grant **10 Pack credits** (not Free Credits, not Subscription Credits) to the
owner's own account, once, through `public.ledger_grant` with an idempotency
key, so a replay is a no-op:

```sql
SELECT public.ledger_grant(
  '<owner user_id>'::uuid,
  10,
  'grant:owner-test:crun-veo-lite-live-test:decided-by-al-jobson',
  'crun-veo-lite-live-test-20261024'
);
```

- 10 credits cover one Veo 3.1 Lite job (9 credits) with 1 left over.
- The RPC is the only writer: no direct row insert into the ledger and no
  direct update of balances.
- The grant is the owner's own account, never a customer's.

## Consequences

- One ledger row: delta +10, reason as above. The balance invariant and
  `reconcile_balances()` are unaffected, because the grant goes through the RPC.
- Cost to us: 10 credits (about $0.43 at the top pack rate), plus about $0.067
  of Crun spend when the job runs.
- Any further grant needs its own ADR. This one is not a precedent.

## Verification

- `reconcile_balances()`, `reconcile_free_credits()` and
  `reconcile_subscription_credits()` return zero rows afterwards.
- The attempt row for the test job shows supplier `crun`, then `completed`.
