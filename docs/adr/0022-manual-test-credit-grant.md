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

## Amendment — Frozen In Motion template test (2026-10-10)

Al Jobson requested a live test of the published Frozen In Motion template
inside Veyrnox and explicitly approved adding the missing credits in chat
("add it", in response to the request for 33 credits). This amendment permits
one 33-credit test grant to his signed-in production account. It does not
authorize further grants or change customer billing.

- Production project: `xdxdzmsztyzbnzeforxx`.
- Account: `al.jobson1@gmail.com`; public user
  `29f57b4b-5e5e-4e4a-ac8e-67e43c9af246`. Its `auth_id` matches the verified
  signed-in identity. The displayed balance and database balance both read 1.
- Approver: Al Jobson (product owner), 2026-10-10.
- Grant: 33 paid-equivalent credits through `public.ledger_grant`, with
  `free_delta = 0`; expected balance 1 -> 34.
- Reason: `grant:manual Al Jobson Frozen In Motion template test`.
- Idempotency key: `codex-frozen-motion-20261010-01`. Reuse this exact key if
  the call's outcome is unknown; do not issue a second grant.
- Purpose: one five-second `kling-3.0-i2v` generation at the live 34-credit
  catalog price, using the published prompt unchanged and an original
  synthetic starting image. Review the video before any website replacement.
- Execution result: ledger entry `9ee3a3cc-daec-4097-bfa0-ef7a8259bd4d`,
  `delta` +33 and `free_delta` 0. RPC returned `idempotent: false` and balance
  34. The existing one Free Credit is unchanged.
- Test submitted through the signed-in Veyrnox studio at 07:07:01 UTC:
  job `5c5755b0-83d8-4459-96c2-2732277f2bf6`, provider `fal`, model
  `kling-3.0-i2v`, cost 34 credits. Balance after submission is 0, with
  `free_balance` 0; both equal their respective ledger sums.
- Output: stored successfully and visible as DONE in the owner's Library.
  The player reports 1080 x 1916, 5.041667 seconds, readyState 4 and no
  playback error. Visual review at 0, 2.50 and 4.99 seconds shows the woman
  suspended in the same bent-knee pose while pedestrians move and the camera
  moves around her. There is slight hair/clothing drift; this is one
  successful reproduction of the core effect, not evidence of perfect pose
  rigidity or repeatable results for arbitrary starting images. At the test
  review, no landing page or template preview had been replaced. The owner
  subsequently approved using this output as the Frozen In Motion template
  preview; see [template recipes](../product/template-recipes.md).
