# Subscription production approval pack — 16 October 2026

This record separates completed engineering work from the approvals and live
acceptance evidence required before either subscription product can be sold in
production. Staging may run sandbox sales. Production feature flags stay off
until every applicable item below has an owner, date and evidence link.

## Products in scope

| Product | Offer | Production switch |
|---|---|---|
| Credit subscription | Starter $19/month for 270 credits; Plus $59/month for 1,200 credits; Ultra $129/month for 3,000 credits | `SUBSCRIPTIONS_ENABLED` |
| Cinema Pass | $9.99/month, capped at 1,500 viewing minutes per calendar month | `CINEMA_SUBSCRIPTIONS_ENABLED` |

## Stripe approval — owner

Obtain written, account-specific confirmation covering all of the following:

- Veyrnox's AI-generation credit subscriptions, including credit expiry and no
  rollover.
- The Cinema Pass for access to user-uploaded video.
- Managed Payments with Checkout `mode=subscription` and the Customer Portal.
- The exact production Stripe account and all product/price identifiers.
- Any restricted-business review outcome, reserve, payout or dispute condition.

Record the Stripe ticket or email, approver, date, account ID and conditions.
Public documentation or a successful sandbox charge is not written approval.

## Finance and Legal approval

Record written approval for:

- Merchant-of-record and tax treatment in every launch market.
- The recurring price, billing interval, automatic-renewal, credit-expiry,
  minute-cap and cancellation wording shown before checkout.
- The Terms and Refund Policy text versioned on 16 October 2026.
- The 14-day cooling-off implementations: unused Credit Subscription cycles
  refund in full; Cinema Pass refunds are prorated for viewing already used.
- Immediate-supply consent and any loss-of-cancellation-right treatment.
- Durable-medium purchase confirmation: decide whether Stripe's receipt plus
  hosted records is sufficient or require a Veyrnox contract-summary email.
- Cinema creator terms, including that no creator revenue share is currently
  promised.

## Staging acceptance

Attach evidence for the full checklist in
[credit-subscription-acceptance.md](credit-subscription-acceptance.md), plus:

- One authorized Cinema Pass sandbox purchase, signed webhook, return-page
  entitlement, portal access, period-end cancellation and cooling-off refund.
- Confirmation that both self-service cancellation entry points work on mobile
  and desktop, and stay available when new sales are disabled.
- Delivered customer receipt/confirmation and delivered operator alert.
- An account-switch test proving one user's subscription cannot be viewed,
  cancelled or recovered by another user.
- Clean subscription, credit, Cinema and ledger reconciliation after every
  refund/dispute drill.

## Production cutover

1. Record the two approvals above and resolve every condition.
2. Re-read production product/price configuration and secret binding names.
3. Deploy with both production switches still false and run smoke checks.
4. Enable one product at a time, verify a real authorized journey, and record
   the deployment/version ID.
5. Re-read the deployed switch and monitor signed webhooks, alerts and
   reconciliation. If evidence is failed, unavailable or ambiguous, switch new
   sales off; existing subscriptions must continue to settle and cancel.
