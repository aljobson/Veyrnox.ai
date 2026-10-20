# Bounty Objective: Launch Credit Packs
Target: aljobson/Veyrnox.ai Issue #101
URL: https://github.com/aljobson/Veyrnox.ai/issues/101

## Issue Description
## Scope

Verify the public Stripe Credit Pack launch. This supersedes the original LemonSqueezy launch steps: LemonSqueezy refused the business; ADR-0031 and its Managed Payments amendment govern the replacement. Historical comments remain evidence of the previous plan.

Implementation/evidence record: merged PR #321 (`docs/operations/credit-pack-launch-acceptance.md`). Original specification #90 was superseded by merged PR #321; provider setup #91 is closed as not planned.

## Implemented

- [x] Stripe checkout/webhook and provider ADR: #248, #249.
- [x] Stripe-compatible money-path identifiers: #251.
- [x] Managed Payments automatic tax and seller copy: #252.
- [x] Public purchase controls; old `veyrnox_topups` opt-in removed: #169.
- [x] Returned-Session recovery: #280–#282 (owner-approved early activation; not proof of 24h cleanliness).
- [x] Paginated billing history and authoritative statements: #313.

## Required closure evidence

- [ ] Operator verifies live account/eligibility, Managed Payments, webhook event subscriptions, secret bindings and live catalog prices. Do not expose secrets in evidence.
- [ ] One controlled real low-value purchase: correct buyer, exactly one grant, expected balance, history, receipt and tax.
- [ ] Real refund: expected clawback, free credits preserved, non-negative balance and accurate history.
- [ ] Controlled test-mode duplicate/concurrent delivery, successive partial refunds, refund-before-credit, dispute/freeze/unfreeze and permitted frozen-account reads.
- [ ] Lost/delayed webhook drill proves recorded-return recovery credits once, closes its queue entry and exposes failures.
- [ ] Owner resolves or explicitly accepts the paid-without-return and lost refund/dispute recovery gaps, with support procedure and tracked follow-up. Current recovery depends on the browser returning.
- [ ] Applicable 24-hour reconciliation window and nightly completion verified; fresh reconciliation and migration-ledger checks pass. Failures or unreadable checks require investigation.
- [ ] Public desktop/mobile journey passes without browser opt-in: signed-out entry, consent, checkout, abandonment, processing, balance refresh and account-isolated history.

## Read-only baseline, 25 September 2026

Direct checks on main 90a96b0: all four reconciliation drift counts 0; 104 applied migration names accounted for; signup autoconfirm off, 0071 applied and CAPTCHA enforced. This is point-in-time evidence, not a live purchase or a full observation window.

Latest inspected migration run: https://github.com/aljobson/Veyrnox.ai/actions/runs/36055715035 (successful; completed no later than its 24 September 20:34:46 UTC update). Using that timestamp conservatively, the latest migration set's observation window cannot complete before 25 September 20:34:46 UTC. Re-evaluate after any later relevant migration.

Recovery-health monitoring is enabled and healthy: merged/deployed PR #324, all five successful heartbeats, trusted snapshot refreshed after 07:15 UTC on 25 September, then watcher enabled and verified in https://github.com/aljobson/Veyrnox.ai/actions/runs/36106931071. Failure-notification delivery remains to be tested safely. No purchase/refund was performed by this review. Keep this issue open until the evidence above is recorded.





## Instructions for Kuro (Autonomous Solver):
1. Use skills: `systematic-debugging` and `code-review-and-quality`.
2. Inspect the repository structure, locate relevant files, and understand the bug/feature.
3. Apply the minimal, robust fix or implementation.
4. Run any existing test suites or linters in the workspace.
5. Ensure the fix adheres to the project's existing code style.
6. When done, output a summary of files modified and verification results.
