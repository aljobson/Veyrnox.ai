# ADR-0019 — Stripe Managed Payments as the web Merchant of Record

- **Status**: Accepted (2026-09-13)
- **Deciders**: Product owner
- **Amends**: [ADR-0018 — Credit Pack Top-ups](0018-credit-pack-top-ups.md) decision 2 (web Merchant of Record); supersedes [ADR-0003](0003-billing-provider.md)
- **Related**: [ADR-0005](0005-phase-0-business-preconditions.md) (UK Ltd), [ADR-0013](0013-credit-expiry-policy.md), [ADR-0014](0014-floor-pricing.md), `CONTEXT.md`

## Context

ADR-0018 chose LemonSqueezy as the web Merchant of Record, with a precondition: LemonSqueezy support had to confirm that prepaid AI-generation credits are not a prohibited "service", and if refused, ADR-0003 would reopen with Paddle or Stripe Managed Payments named as the alternatives.

Stripe Managed Payments removes that uncertainty and several of the workarounds ADR-0018 had to accept:

- **Eligibility is documented, not pending.** GB is a supported business location. The product has an eligible tax code that describes it exactly: `txcd_10105001`, *Artificial Intelligence as a Service (AIaaS) — Cloud Based — Personal Use*. Access still goes through Stripe's eligibility review.
- **Tax stays with the Merchant of Record.** Stripe calculates, collects, files and remits sales tax, VAT and GST in 80+ countries — ADR-0003's reason for choosing an MoR holds.
- **Webhooks meet `CLAUDE.md` without an exception.** `Stripe-Signature` is HMAC-SHA256 over a timestamp and the body, so the ≤5-minute replay window is enforced; events carry an `evt_` id for `webhook_events` dedupe; failed deliveries are retried for up to three days, not three times over 2.5 minutes. ADR-0018's replay-window deviation does not apply.
- **Disputes are reported.** Stripe handles disputes and emits `charge.dispute.*` events.

## Decision

Web Top-ups are sold through **Stripe Checkout with `managed_payments[enabled]=true` in `mode=payment`**, API version pinned to `2025-03-31.basil`. Every other ADR-0018 decision stands.

- Credit Packs are ADR-0018's: `pack_100` (100 cr), `pack_300` (300 cr), `pack_1000` (1,000 cr), each a Stripe Product with tax code `txcd_10105001` and a one-time USD Price of $10 / $25 / $75, tax-exclusive.
- Credits per pack live in `credit_packs`; the money price lives only on the Stripe Price. A pack is `active` only once its `stripe_price_id` is set (CHECK constraint).
- The pending Top-up is a `purchases` row written before the redirect; its id travels as `client_reference_id`. The webhook grants via `ledger_grant` to that row's user, never to anyone named in the payload.

## What this slice implements

| ADR-0018 decision | This slice |
|---|---|
| 1. Packs before Subscriptions | Done |
| 2. Web MoR | Stripe Managed Payments (this ADR) |
| 3. Packs 100/$10 · 300/$25 · 1,000/$75, never expire | Pack credits seeded; prices set on Stripe Prices |
| 4. Pricing floors enforced when a price is set | **Not yet.** Recheck the net floor against Stripe Managed Payments fees before setting live prices |
| 5. Pending Top-up + signed webhook + dedupe + grant to row's user | Done. Order re-fetch replaced by Stripe's timestamped signature; no backfill job yet |
| 2. Sales Channel recorded on every grant; packs priced per channel | Done (0039): `credit_packs.sales_channel` (`web`, `app_store`, `google_play`) makes each channel's packs their own rows at their own prices; `purchases.sales_channel` is tied to its pack by a composite foreign key; the grant is `grant:topup:<channel>`; `POST /api/v1/checkout` is the `web` channel and `purchase_create` only sells that channel's packs. Store channels still need their own product-id columns |
| 6. Supply Consent stored on the pending Top-up | Done (0036): the buy dialog requires the checkbox; `purchase_create` records `supply_consent_version` and a server `supply_consent_at`; the checkout route only accepts the current version from `lib/supplyConsent.js`. Wording is `supply-consent-2026-09-13-draft` until Finance/Legal approve it |
| 7. Top-up Refunds claw back a proportional share | Done (0037): every `charge.refunded`, full or partial, moves the purchase's `refunded_credits` to floor(credits × `amount_refunded` / `amount`) and takes only the increase, never below a zero balance. Dedupe is by the cumulative refunded amount |
| 8. Chargebacks Freeze the account | Done (0038): a refund or lost dispute that increases a purchase's `refunded_share`, when a job that did not fail or get refunded exists after `paid_at`, inserts an `account_freezes` row. `ledger_debit` and `purchase_create` refuse Frozen accounts (`403 account_frozen`); `operator_unfreeze` (admin users only, not self, reason required) records who and why. No Operator UI or route yet |

## Flow

1. `POST /api/v1/checkout {pack_id, idempotency_key, supply_consent_version}` → `purchase_create` inserts a `PENDING` purchase with the consent version and time (idempotent on `(user_id, idempotency_key)`, at most 5 per user per 10 minutes) → Checkout Session with `Idempotency-Key: checkout-<purchase.id>` → client redirects.
2. `POST /api/webhook/stripe` verifies `Stripe-Signature`, dedupes on `webhook_events('stripe', event.id)`, then:
   - `checkout.session.completed` / `checkout.session.async_payment_succeeded` with `payment_status = 'paid'` → `purchase_fulfil` grants via `ledger_grant`.
   - `charge.refunded` (full or partial) → `purchase_reverse('reversal:refund', amount_refunded, amount)`.
   - `charge.dispute.closed` with `status = 'lost'` → `purchase_reverse('reversal:dispute')` as a whole-charge reversal.
   - Reversals go through the ledger primitive `ledger_debit_capped`, which never takes the balance below zero and reports any shortfall.
3. A `PENDING` purchase older than 23 hours can no longer start checkout, so Stripe's 24-hour idempotency-key retention can never mint a second session for one purchase.

## Consequences

- **Receipts and statements name Link** (`LINK.COM* <descriptor>`, "Sold through Link"). Customers raise payment support with Link; Stripe may refund within 60 days on its own if an escalation goes unanswered for 48 hours. Keep the dashboard support email current. The privacy policy must name Stripe as the Merchant of Record.
- **Stripe can refund without us**, which is why every `charge.refunded` claws back regardless of who issued it (ADR-0018 decision 7).
- **Clawback follows Stripe's cumulative refunded amount.** A purchase keeps `refunded_credits` (share owed back, rounded down) and `reversed_credits` (actually taken). A replay or a late, older event has a target at or below the recorded one and does nothing. When the credits were already spent the shortfall is logged and not chased on later refunds, because later balance belongs to other Top-ups.
- **The Freeze trigger is inferred from our own ledger, not from Stripe's dispute state**, as ADR-0018 decided: an Operator refund issued under the 14-days-nothing-generated rule never Freezes. Stripe's `charge.dispute.created` is not used; an open dispute changes nothing until it is lost.
- **A replay or late, older refund event can never re-freeze** an account an Operator unfroze, because progress is measured by the purchase's cumulative `refunded_share`. A new, larger refund can.
- **A Checkout Session opened before a Freeze can still be paid.** The payment has been taken, so `purchase_fulfil` grants the credits and the webhook logs `top-up paid into frozen account`; the Freeze stops them being spent. `purchase_create` refuses new and replayed purchases while Frozen so no further session is opened.
- **A refund that later fails is not re-granted.** If Stripe reports a refund failing after `charge.refunded`, the credits already taken stay taken; restoring them is a manual grant under the `CLAUDE.md` rule (written ADR, `reason` naming the Operator).
- A reversal whose purchase is not found is retried while it may be racing fulfilment, then acknowledged after an hour and logged as `unmatched_reversal`.
- `webhook_events.payload` for Stripe stores `{type, object_id}` only; Checkout events carry name, email and address we have no reason to keep.
- No Stripe.js and no `stripe` npm package: the redirect is top-level navigation (no CSP change) and the Worker calls `api.stripe.com` with `fetch`.
- New secrets: `STRIPE_SECRET_KEY` (restricted: Checkout Sessions write), `STRIPE_WEBHOOK_SECRET`.
- Buy buttons stay behind `localStorage.veyrnox_billing = '1'` until the "not yet" rows above that block live mode are done.

## Before live mode

- Finance/Legal approve the Supply Consent wording; publish it under a version without `-draft`.
- An Operator route for `operator_unfreeze` that takes the Operator's identity from the verified `x-veyrnox-auth-id` header, never from the request body.
- Pricing floors rechecked with Stripe Managed Payments fees.
- Stripe account business description matches the product: AI image/video/voice generation sold as prepaid credits.
- Managed Payments enabled after Stripe's eligibility review and terms acceptance.
- In test mode, confirm `checkout.session.completed` carries `payment_intent` for Managed Payments sessions; reversal matching depends on it.
- Webhook endpoint on API version `2025-03-31.basil`, subscribed to exactly the four events above.
