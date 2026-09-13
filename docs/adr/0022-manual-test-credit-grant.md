# ADR-0022 — Manual credit grant for provider live tests

- **Status**: Accepted (2026-09-13)
- **Date**: 2026-09-13
- **Deciders**: Product owner (Al Jobson)
- **Related**: [ADR-0020 — kie.ai and OpenRouter as generation providers](0020-kie-and-openrouter-providers.md), #128

## Context

CLAUDE.md allows credit grants only through `signup_grant` or `ledger_grant`,
and a manual grant needs an ADR and a `reason` naming the human who decided.

On 2026-09-13 the live test of `seedance-2.0-fast` on OpenRouter (28 credits)
could not submit: the test account `veyrnox.triage@gmail.com` had 12 credits.
Its other 28 were held by job `19a74699-7d6b-44e4-b0d2-89cce907dd39`, whose
completion webhook had been rejected before `OPENROUTER_WEBHOOK_SECRET` was
corrected, so no refund had landed yet.

## Decision

Grant the test account 100 credits so provider live tests can run.

- Call: `public.ledger_grant(<user id of veyrnox.triage@gmail.com>, 100, 'grant:manual Al Jobson testing')`
- Ledger entry `bc0526a5-92bd-415c-a5d3-abd72d914f4b`, `delta` +100,
  `free_delta` 0, at 2026-09-13 10:09:41 UTC. Balance 12 -> 112.
- Approved by the product owner in chat, with that reason text.

The credits are paid-equivalent (`free_delta` 0). They buy provider calls we
pay for, so they are spent only on live tests of catalog rows before or after
activation. The first use was job `08dded7d-1ddf-4746-b9b9-066aad704f53`,
which reached STORED and activated `seedance-2.0-fast` (migration 0057).

## Consequences

- `credit_balances.balance = SUM(ledger_entries.delta)` still holds: the grant
  is an ordinary ledger row, not a balance edit.
- Test spend on this account is real provider cost and shows in the ops
  metrics. It is not revenue.
- Further test grants follow the same shape: `ledger_grant`, a reason that
  names the approver, and an entry appended to this ADR.
- If the test account is removed, its remaining credits go with it; no
  clawback entry is needed because no money was received.
