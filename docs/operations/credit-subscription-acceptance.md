# Credit subscriptions: initial Stripe slice (ADR-0064)

This slice adds monthly checkout, read/plans, checkout return recovery,
explicit period-end or cooling-off cancellation, and the Stripe webhook.
`SUBSCRIPTIONS_ENABLED` is **false** in production and staging. No public
pricing or account UI changes are included. Upgrades, downgrades, resume,
annual billing and the Customer Portal are not offered by these endpoints.

## Prerequisites before enabling staging

- Apply corrected 0186/0187 through the owner-approved migration workflow;
  merge and apply 0189 only after its independent reviews and CI pass.
- Reconcile all five counts and check the migration ledger.
- Set staging `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_HOST`
  and the Resend secret. Never paste values into a PR or chat.
- Configure `SUBSCRIPTION_ALERT_EMAIL` with the Operator recipient.
  `SUBSCRIPTION_ALERT_FROM` may override the existing verified
  `VIOLATION_EMAIL_FROM`. A missing/failed alert keeps refused invoice
  deliveries unprocessed and answers 503 so Stripe retries.
- Confirm refund/default policy and approve tax and consent copy. The
  consent identifier `credit-subscription-2026-10-03` is a version marker,
  not Finance/Legal's approval of customer-facing wording.
- Confirm Stripe's written acceptance before launch. Provide an E2E test
  account before browser acceptance of the later UI slice.

## API

All routes require gateway-verified identity, reject query parameters, have
no-store responses and consume the account-read rate limit. Mutations use
JSON, bounded bodies and an exact field allowlist. Prices and credits come
from the database, and browser responses exclude Stripe identifiers.

| Route | Method | JSON |
|---|---|---|
| `/api/v1/subscriptions` | GET | — |
| `/api/v1/subscriptions/plans` | GET | — |
| `/api/v1/subscriptions/checkout` | POST | `plan_id`, `idempotency_key`, `consent: true`, `consent_version` |
| `/api/v1/subscriptions/return` | POST | `subscription_id`, `session_id` |
| `/api/v1/subscriptions/cancel` | POST | `subscription_id`, `mode: "period_end"` or `"cooling_off"` |

Cancellation addresses an explicit owned row, so retrying an unfinished
cooling-off refund after purchasing a replacement cannot cancel/refund the
replacement. The database atomically checks 14-day eligibility and unspent
credits, removes that cycle, and ends the row **before** Stripe money moves.
Retries inspect existing tagged refunds even after Stripe's idempotency
retention window. Prior manual, ambiguous, failed or disputed payments need
Operator review. A pending refund is reported as pending, never as refunded.

## Webhook behaviour

- Verify the existing raw-body Stripe signature and test/live mode checks.
- Sign a distinct credit-subscription metadata kind into the session and
  subscription. A durable service-only binding supports metadata removal.
  Table access stays revoked, including for service_role.
- Lifecycle and checkout events bind/update status; they grant no credits.
  `invoice.paid` exclusively uses its event ID for the invoice grant. It
  never uses that ID for a status update too.
- Checkout recovery binds with its session ID and grants with the separate
  deterministic `cs_recovery_<invoice_id>` namespace. Invoice-key ledger
  idempotency prevents a later real webhook from granting twice.
- Re-read invoices and their payment/charge. Accept one complete full-price
  USD monthly line for the bound customer and price snapshot, with a valid
  monthly period and no proration/discount. Refunds or disputes visible on
  the charge prevent a grant. Plan-change invoices need Operator review.
- Young unbound/not-ready invoice deliveries retry with 503. Old orphans,
  refused payments and validation failures alert the Operator; the delivery
  is acknowledged only after the alert succeeds.
- Full refunds and disputes reverse only that invoice's cycle and stop
  billing. Disputes also Freeze through the existing RPC. Partial refunds
  remain audit-only and alert the Operator while their policy is pending.
- Disabling checkout does not disable settlement of existing subscriptions.
  Before 0189 is applied, only a missing-function response may fall back to
  the existing Cinema handler while the flag is off. Other database errors
  retry. Apply all migrations before activating checkout.

## Staging acceptance still required

- [ ] All three tiers create checkout with the expected tax and recurring price.
- [ ] First payment grants once; webhook replay and return recovery grant no extra credits.
- [ ] Invoice-before-binding delivery retries, then grants after binding.
- [ ] Renewal expires the old remainder; failed renewal gives no grace credits.
- [ ] Second live checkout is refused; raced paid duplicates stop billing and alert.
- [ ] Period-end cancellation keeps credits through the paid end.
- [ ] Cooling-off refunds only an unspent eligible cycle; spent/late attempts fail.
- [ ] Retry a cooling-off refund, including after a replacement purchase.
- [ ] Full refund ahead of its invoice prevents a late grant; partial refund alerts.
- [ ] Dispute removes only its cycle, Freezes, cancels Stripe and retries failed cancellation.
- [ ] Refused invoice alert is actually delivered; failed alert returns 503.
- [ ] Cinema Pass and Credit Pack purchase/refund/dispute flows still pass.
- [ ] All reconciliation counts are zero after the drill.

Public plan UI, plan-change database support, browser acceptance and production
activation follow in separate reviewed slices. None of those checks is implied
by unit tests or a local database replay.

## Sandbox evidence — 4 October 2026

These are partial staging results, not production launch approval. The test
used Veyrnox sandbox `acct_1UF6M50HgCFIUbCh`, the authenticated staging APIs,
and a temporary acceptance page. Ordinary subscription requests remain
closed; no credentials were copied from the signed-in browser.

- Starter checkout charged $19 plus $3.80 UK tax in sandbox. Subscription
  `b946c83e-d2d7-4e7c-93c2-5b27e0e5818b` became active. Paid invoice
  `in_1UMoJj0HgCFIUbChZMqUZXRL` produced exactly one 270-credit ledger grant.
  The account's prior 38-credit balance became 308.
- `invoice.paid` arrived before binding, returned 503, and succeeded on
  Stripe's automatic retry. Lifecycle and invoice events used separate IDs.
  An explicit invoice replay left one grant and the same balance.
- Cooling-off removed the unspent 270-credit cycle and restored the prior
  38 credits. Stripe subscription `sub_1UMoJn0HgCFIUbChAQsvUzME` is cancelled;
  refund `re_3UMoJl0HgCFIUbCh1LDi8wJV` succeeded for the full $22.80.
- The first cancellation retry exposed Stripe's refusal of a repeated
  DELETE. The adapter now verifies the requested subscription is cancelled
  in the expected mode before treating that refusal as success. Regression
  tests cover mismatched IDs, active subscriptions, mode mismatches and
  recovering the existing tagged refund without another refund POST.
  Repeating the same authenticated cancellation on the corrected staging
  build returned success, left exactly one succeeded $22.80 refund, and
  kept the balance at 38 with zero Subscription Credits.
- All five reconciliation counts were zero after payment and cancellation.

Plus/Ultra payments, renewal, spent/late cooling-off refusal, replacement
purchase retry, return recovery, disputes and the remaining checklist above
still require acceptance evidence.
