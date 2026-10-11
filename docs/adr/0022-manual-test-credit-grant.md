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

## 2026-10-10 — Film Studio empty-room production test and repair

Al Jobson requested the real seven-stage empty-room test and asked Codex to add
Credits. After the first run exposed missing image delivery, he requested the
delivery fix and full rerun. Test grants use the same ledger path and account:
production `xdxdzmsztyzbnzeforxx`, user
`29f57b4b-5e5e-4e4a-ac8e-67e43c9af246`.

- Initial grant: 100 Credits, key `codex-film-room-20261010-01`, reason
  `grant:manual Al Jobson Film Studio empty-room end-to-end test`.
  Ledger entry `3713687e-32e5-4a52-82bc-5b6afe3fead7`; balance 0 -> 100.
- Repair/rerun grant: 60 Credits, key `codex-film-room-20261010-repair-01`,
  reason `grant:manual Al Jobson Film Studio repair and seven-stage rerun`.
  Ledger entry `fe75c008-e89c-4eb4-b275-db57be95e51d`; balance 28 -> 88.
  This covers a reference sheet, six static asset tests and a fresh 10-second
  Kling take after delivery recovery. No Credit purchase is made.
- Both grants returned `ok: true`, `idempotent: false`, with `free_delta` 0.
  Reuse the recorded keys for an unknown outcome; never issue duplicate grants.
- These are test credits funding actual provider calls, not customer revenue.
  The first run's 70-Credit debit and 30-Credit remaining balance reconciled.
  The 2-Credit delivery diagnostic explains the 28-Credit pre-rerun balance.

## 2026-10-10 — Exact 16:9 Film Studio rerun

Al Jobson requested the aspect-ratio fix and a fresh empty-room production
test. His earlier authorization to add Credits funds this same test workflow.
The balance was 12 Credits; one ten-second Kling take costs 56 Credits.

- Grant: 44 paid-equivalent Credits through `public.ledger_grant`, with
  `free_delta = 0`, to the same production account above. Balance 12 -> 56.
- Reason: `grant:manual Al Jobson Film Studio exact 16:9 rerun`.
- Idempotency key: `codex-film-room-20261010-aspect-01`; reuse for an unknown
  outcome, never issue a duplicate grant.
- Ledger entry: `4432311c-3108-41a7-8e56-645ae1c92a2d`. RPC returned
  `ok: true` and `idempotent: false`.
- Purpose: one fresh ten-second take with the existing approved room
  references, then the free Film Studio 1920×1080 master export. These Credits
  fund an actual provider call and are not customer revenue or a purchase.

## 2026-10-11 — Morning light Film Studio live test

Al Jobson requested a new ten-second Morning light film in 16:9, with real
image and video generation and direct Save to Library. After the estimated
80-Credit first-pass budget was shown, he explicitly asked Codex to add the
Credits to the account. This authorizes one 80-Credit test grant to the same
founder-owned production account above; it does not authorize another grant
or change customer billing.

- The visible balance and ledger balance were both zero. The public user and
  Auth identity match the previously approved Film Studio test account, which
  is not frozen.
- Grant: 80 paid-equivalent Credits through `public.ledger_grant`, with
  `free_delta = 0` and no subscription-credit change; expected balance 0 -> 80.
- Reason: `grant:manual Al Jobson Film Studio Morning light live test`.
- Idempotency key: `codex-film-morning-light-20261011-01`. Reuse this exact key
  if the outcome is unknown; never issue a duplicate grant.
- Purpose: real references, a reference sheet and static stress tests, then
  one ten-second Kling take and the free 1920×1080 master/save path. Three
  available Nano Banana free-allowance images are used first. Failed quality
  reviews may require revisions; they do not expand this grant authorization.
- These Credits fund actual provider calls. No purchase, payment, revenue or
  subscription is asserted. No balance or ledger row is edited directly.
- Execution: RPC returned `ok: true`, `idempotent: false`, balance 80 and
  ledger entry `44073782-bf53-4c13-9cdc-5fe36065f589`. Read-only verification
  found exactly one matching +80 entry, `free_delta = 0`, unchanged zero Free
  and Subscription balances, and balance equal to the ledger sum. The native
  signed-in Credits page displayed 80 Credits.

## 2026-10-11 — Additional tester grant

Al Jobson requested a top-up for the tester account identified in chat, then
explicitly selected 200 Credits. The Auth email was matched to exactly one
public user; the account was not frozen and held 10 Free Credits.

- Granted 200 paid-equivalent Credits through `public.ledger_grant` with
  reason `grant:manual Al Jobson tester credit top-up` and idempotency key
  `codex-tester-75f72797-20261011-200-01`. Reuse this key if the outcome is
  unknown; do not issue a duplicate grant.
- RPC result: `ok: true`, `idempotent: false`, ledger entry
  `0c80b4f3-1705-48fa-9042-b0ca40018606`, balance 10 -> 210.
- Read-only verification found exactly one matching grant totaling +200 and
  balance equal to the ledger sum (210). The existing Free balance stayed 10
  and the Subscription balance stayed zero.
- This is a tester grant for real provider calls, not purchase revenue.
  No balance or ledger row was edited directly.
