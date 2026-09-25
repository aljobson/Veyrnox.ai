# Credit Pack launch acceptance — 25 September 2026

Owner: repository owner or a named operator. Tracking: [#101](https://github.com/aljobson/Veyrnox.ai/issues/101)
and [#204](https://github.com/aljobson/Veyrnox.ai/issues/204).

This is the current implementation/evidence map replacing the historical
LemonSqueezy specification in #90. A merged implementation is not proof of a
successful production payment. Open checks below remain launch obligations.

## Current contract

Stripe Checkout is the purchase path. Under the amendment to
[ADR-0031](../adr/0031-stripe-replaces-lemonsqueezy.md), Stripe Managed Payments
is the Merchant of Record and automatic tax is on unless explicitly disabled.
The original standard-account/tax-off decision is historical, not current.
The server prices a checkout from the pending Top-up's catalog snapshot;
client-supplied prices and credits are never authoritative. Migration 0121
specifies $10/100, $19/270, $59/1,200 and $129/3,000 packs. Verify the live
catalog before treating these as current production offers.

Purchased credits do not expire. Migration 0127 changes future signup grants
to 10 Free Credits; confirmation gating, replay protection and 90-day expiry
remain. Historical grants are preserved. These migrations require their own
production application evidence; UI copy is not that evidence.

A verified paid Checkout Session credits its PaymentIntent exactly once via
credit_top_up. Re-fetched Session metadata must bind it to the pending Top-up;
USD and pre-tax amount are checked, and test/live modes must agree. Tax is not
converted to credits. Refunds and disputes use the provider-neutral ledger
and account-action rules, including preserving free credits during clawback.

Public purchase controls shipped in #169. Returned-session recovery shipped
in #280–#282, with the owner's recorded early activation exception; it does
not establish a clean 24-hour observation window. See
[ADR-0033](../adr/0033-stripe-top-up-recovery.md), including its amendments.

## Traceability from #90

The numbers below are the original user-story numbers, not new requirements.

| Stories | Implementation / superseding decision | Closure evidence still required |
| --- | --- | --- |
| 1–15 buying, consent, return, balance, history | #111, #120, #127, #169, #249, #252, #269, #297, #313; catalog pricing supersedes the original three-pack figures | Real purchase, receipt/tax, consent, abandonment, signed-out redirect, responsive UI and owner-scoped history |
| 16 lost webhook | #280–#282 / ADR-0033: verified recovery for a recorded returned Session | Controlled recovery drill; paid-without-return gap below remains open |
| 17–22 integrity and sales channel | #120, #249, #251; Stripe metadata/Session replaces LemonSqueezy variants and order verification | Duplicate/concurrent delivery, amount/currency/mode/ownership refusal evidence |
| 23–30 refunds and frozen accounts | #126, #131, #136, #141, #152, #154, #249, #251, #256, #257; ADR-0019/0031 | Real refund; controlled incremental refund, dispute, freeze and permitted-read journeys |
| 31–35 operator reads/actions | #150 and audited service-role functions; account actions remain append-only | Operator verifies pending/flagged orders, refund eligibility and audited unfreeze |
| 36 reconciliation | #150, #259, #280, #311; four current drift counts | Complete clean observation window and nightly cron evidence |
| 37 signature rejection | #248/#249 timestamped Stripe HMAC replaces timestamp-free LemonSqueezy | Invalid/stale signatures refused; normal delivery smoke test |
| 38 validated/rate-limited purchase | #299/#300; related read/return limits #303–#307 | Deployed refusal/retry behavior; no duplicate grant or extra payable checkout on replay |
| 39 database pricing | #249/#269/#297 | Live catalog and checkout subtotal agree |
| 40 staged rollout | #169/#282 and recorded owner rollout decisions | Outstanding clean-window and real-journey evidence remains required |
| 41 secrets | Worker secret bindings, no client credential exposure | Operator verifies live bindings and rotation ownership without disclosing values |

The original #90 implementation details about LemonSqueezy variants, webhook
shapes, fees and live-store activation are superseded, not unfinished Stripe
features. The preserved credit/refund/dispute rules remain in ADR-0018/0019.

## Read-only evidence collected on 25 September

Against main 90a96b06e8ea293f732591c6ba7b0c0b508a27f3:

- Direct `node scripts/check-reconcile.mjs`: balance_drift,
  free_credit_drift, top_up_drift and failed_refund_drift all **0**.
- Direct `node scripts/check-migration-ledger.mjs`: **104 applied migrations
  accounted for**. This checks recorded applied names; it does not prove every
  repository migration has been applied.
- Direct `node scripts/check-signup-gate.mjs`: mailer_autoconfirm off,
  signup open, 0071 applied, CAPTCHA enforced. HIBP is not covered by this check.
- Latest inspected production deployment [36056548489](https://github.com/aljobson/Veyrnox.ai/actions/runs/36056548489)
  succeeded. These are point-in-time observations, not continuous availability.
- Migration run [36055715035](https://github.com/aljobson/Veyrnox.ai/actions/runs/36055715035)
  succeeded and was updated at 2026-09-24 20:34:46 UTC. Using that completion
  timestamp conservatively, the latest migration set cannot have a full
  24-hour window before **2026-09-25 20:34:46 UTC**. A later relevant migration
  restarts the applicable observation window.
- Nine listed reconcile-watch runs after that migration were successful,
  from 2026-09-24 21:28:16 through 2026-09-25 05:31:09 UTC. Workflow logs
  were not returned by `gh run view --log`; workflow conclusions plus the
  direct current check do not prove every historical count or nightly run.
- RECOVERY_HEALTH_ENABLED is false; recent recovery-health workflows are
  skipped. A skipped monitor is not a healthy-monitor result.

## Evidence required before closing #101

- [ ] Operator verifies live account, payment eligibility/account status,
  Managed Payments, active catalog, webhook events and secret bindings.
- [ ] Controlled real low-value purchase: redacted transaction reference,
  timestamp, correct buyer, one grant, expected balance, history and receipt.
- [ ] Real refund: expected clawback, free credits preserved, non-negative
  balance and correct history. Use an isolated buyer and the approved refund
  procedure; record evidence without payment or personal data.
- [ ] Test-mode scenarios: duplicate events, concurrent credit attempts,
  incremental partial refunds, refund-before-credit, disputes, audited
  unfreeze and frozen-account generation/buy denial with permitted reads.
- [ ] Recorded-return recovery drill: verified payment is recovered once,
  URL token scrubbed, queue closed, and failed attempts remain visible.
- [ ] Inspect all scheduled checks across the applicable 24-hour window,
  investigate failures/missing or unreadable checks, verify nightly cron
  completion, and run fresh reconciliation/migration-ledger checks.
- [ ] Desktop/mobile public purchase UI, signed-out entry, abandonment,
  processing state, balance refresh and cross-account history checks pass.
- [ ] Resolve or explicitly accept the recovery limitations below with an
  owner decision and named follow-up; do not claim unconditional recovery.

## Remaining recovery and legacy work

**Payment with no browser return:** if the webhook is lost and the buyer closes
the tab before returning, the current queue has no Session to recover. Lost
refund/dispute events are also outside returned-checkout recovery. An owner
must choose additional provider reconciliation or explicitly record the
limitation, support procedure and follow-up. This document does not waive #90's
original reliability requirement or silently treat it as delivered.

**Recovery monitor:** migration 0131 is recorded applied in the audit evidence.
Enable RECOVERY_HEALTH_ENABLED in a separate PR, verify task heartbeats and the
trusted snapshot refresh, then enable RECOVERY_HEALTH_WATCH_ENABLED and prove
watcher/alert behavior. Follow [recovery-health.md](recovery-health.md).

**Historical LemonSqueezy orders:** the audit found two credited numeric order
IDs. Establish provider provenance and remaining refund/dispute obligations
before removing callbacks, adapters or secrets. Closing #91 does not retire
these paths. Preserve historical ledger and audit records.

## #204 operational requirements

- [ ] Recheck signup gate and HIBP in Auth settings after configuration changes.
- [ ] Verify increased email quota or record an owner-approved bounded launch
  plan that revises the original requirement; a submitted request is not approval.
- [ ] Verify the enrolled admin journey, AAL2 refusal for weaker sessions,
  Access assertion enforcement and alternate/preview-host bypass protection.
- [ ] Complete #101 and the applicable clean reconciliation window.
- [ ] Keep upload-specific hash-matching/provider choice tracked separately;
  it remains a prerequisite for the affected upload release, even if excluded
  from a text-to-media launch. Do not silently waive it.
- [ ] Record the deferred provider paperwork decision and review actual
  customer-facing claims with the accountable owner.

Merge the documentation independently of these unchecked operational items.
Neither #101 nor #204 should auto-close from this documentation PR.
