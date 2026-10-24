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

### Recorded approval — 16 October 2026

Stripe support agent Che reviewed production account
`acct_1UF6Lv1lXjzff0PS` against the two offers and integration details above in
support ticket `sco_VS2D3N0VNhPwkd`. The request named the inline recurring
prices for Starter ($19/270 credits), Plus ($59/1,200), Ultra ($129/3,000) and
Cinema Pass ($9.99/1,500 minutes), credit expiry/no rollover/no transfer/no
cash-out, creator-submitted video with no creator payments or Connect flows,
Managed Payments, Checkout `mode=subscription`, Customer Portal and the public
policy URLs.

Che confirmed in the authenticated support chat that:

- the account is active, compliant and verified, with no pending requirements;
- MCC 5734 (Computer Software Stores) is allowed for the intended business
  structure;
- Veyrnox is not on Stripe's restricted list and may start creating
  subscriptions; and
- the account currently has no reserve, payout or dispute-monitoring issues.

Stripe stated that routine reviews still apply and that it will contact Veyrnox
if the account's status changes. Stripe also committed to email the chat
transcript to the account email. This record clears the Stripe-approval item;
it does not clear Finance and Legal approval or the remaining staging
acceptance evidence below.

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

### Recorded owner approval — 24 October 2026

Owner Al Jobson approved the Finance/Legal terms listed in issue #1575 and
authorised a **monthly-only Credit Subscription launch**. For that launch:

- Stripe remains the Merchant of Record and handles location-specific tax;
- the three approved offers are Starter $19/month for 270 Credits, Plus
  $59/month for 1,200 Credits and Ultra $129/month for 3,000 Credits;
- automatic monthly renewal, cycle-end expiry without rollover, self-service
  cancellation, the 14-day unused-cycle cooling-off refund and immediate-
  supply consent use the customer wording versioned 16 October 2026;
- Stripe's receipt plus its hosted payment record is accepted as the durable-
  medium purchase confirmation for this launch; and
- no weekly Credit Subscription or additional launch-market restriction was
  approved.

This owner approval clears the Finance/Legal decision. It does not waive the
remaining Stripe staging acceptance or production cutover evidence below.

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
