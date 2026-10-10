# ADR-0082 — Public Credit Subscription offer and account management

Status: implementation under the owner’s 10 October 2026 request. ADR-0064 already authorizes monthly Starter $19/270 Credits, Plus $59/1,200 Credits and Ultra $129/3,000 Credits. This record adds their UI, without approving the outstanding Finance/Legal wording or authorizing real charges.

## Decision

Public Pricing discovers the gated server plan catalog. Credits & billing lets a signed-in customer select a plan, explicitly agree to its recurring price/credits, and proceed to the existing checkout API. Prices and quantities come from the server catalog and the checkout uses the database’s price snapshot. Plans are monthly; annual billing, upgrades, downgrades, resume and a Customer Portal remain unimplemented.

The renewal checkbox starts unchecked and resets on plan changes. Checkout retries retain the same request key for the same plan/consent version. Redirects allow only HTTPS Stripe origins without embedded credentials, matching the server adapter. Return parameters must contain one valid subscription UUID and one valid checkout session ID. Session information is captured in memory and stripped from the address bar. This checkout handoff survives sign-in; private billing state remounts when the account changes. The server rechecks ownership and provider evidence before crediting a payment. A return URL is not proof of payment.

Account management shows the current subscription’s server-projected status, cycle and renewal choice. Cancellation requires an explicit confirmation and addresses that exact owned subscription UUID. Period-end cancellation preserves the paid cycle. Cooling-off eligibility and reversals remain database-enforced; a pending refund is explicitly pending. Failed/refused refunds remain retryable or require operator review as the backend indicates. An ended cooling-off record can be checked again without targeting a replacement subscription.

Closing `SUBSCRIPTIONS_ENABLED` stops catalog offers and new checkout, while authenticated owned reads, cancellation and paid-checkout recovery remain available. This avoids a sales shutdown blocking existing customers’ billing rights. Webhook settlement remains independent of the sales flag. The new public plan route is read-only and ignores inbound identity headers; it never returns provider IDs or private billing records. Authenticated requests retain identity, account-quota, body and ownership checks.

## Release requirements

`SUBSCRIPTIONS_ENABLED=false` remains explicit in both environments. Before enabling, approve the displayed tax, renewal, expiry and cooling-off wording and matching Terms; confirm Stripe’s written product acceptance and the configured operating entity/tax treatment; name the billing escalation recipient; and complete the real account/Stripe acceptance checklist in `docs/operations/credit-subscription-acceptance.md`. A version marker is not Finance/Legal approval. Do not infer approval from a synthetic browser test.

Draft customer consent for review:

> I agree to [plan] at [monthly USD price] plus applicable tax every month until I cancel. I receive [Credits] after each confirmed monthly payment; unused cycle Credits expire without rollover.

The screen also discloses renewal cancellation, the conditional fourteen-day unused initial-cycle refund, and the final checkout tax/total. No new merchant-of-record representation is introduced. Existing one-off Credit Pack purchases remain available and are described as non-renewing.

## Evidence

API/adapter tests cover ownership, signed return recovery, invoice grants and reversals, fixed snapshot prices, refund retries, private-field projection and continued management when sales close. The UI helper tests reject lookalike/unsafe redirect origins and ambiguous return parameters. Reticle produced net-grade `verified: yes` for explicit checkout consent with an honest unconfirmed response, period-end cancellation surviving reload, a pending refund remaining pending, and public prices matching the returned catalog. Browser billing endpoints and identities were synthetic; no real payment or refund was made. Real Stripe and customer acceptance remain open.
