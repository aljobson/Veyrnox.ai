# ADR-0031 — Stripe replaces LemonSqueezy as the payment provider

**Status:** Accepted 2026-09-23
**Related:** [ADR-0003](0003-billing-provider.md) (billing / merchant-of-record —
provider choice superseded), [ADR-0018](0018-credit-pack-top-ups.md) (Credit Pack
Top-ups — §provider superseded, credit/refund rules kept),
[ADR-0019](0019-dispute-webhooks-freeze.md) (dispute webhooks Freeze the account),
[ADR-0013](0013-credit-expiry-policy.md) (Free Credits), CLAUDE.md
("Provider webhooks", "Money & billing")

## Context

On 2026-09-22 LemonSqueezy refused the account: AI media generation is on their
prohibited list. That is not an appeal we can win by rewording the site — it is
a category exclusion — and it blocks #169 and #172, which are otherwise built.
Everything downstream of the provider already exists: the `top_ups` table, the
`credit_top_up` / `apply_top_up_refund` / `apply_dispute_event` RPCs, the
`webhook_events` dedupe, the Freeze rules, the Supply Consent wording (#99).
Only the provider-facing edge needs replacing.

### Options considered

| Option | Takes AI media generation | Merchant of record | Fee | Notes |
|---|---|---|---|---|
| **Stripe, standard account** | Yes, under the AI-services category | **Us** | ~2.9% + 30¢ | Largest surface area, best docs, Workers-friendly REST API. We owe the VAT. |
| Dodo Payments | Yes | Them | ~4% + fees | MoR, so tax is theirs. Young company; a second category refusal would cost us the same work again. |
| Creem | Yes | Them | ~4% + fees | Same shape as Dodo, smaller still. |

Both MoR options trade roughly a point of margin for someone else's tax
registrations, and both carry the risk we just paid for once: a small provider
deciding our category is not for them. Stripe is the one vendor whose
acceptance of AI-services businesses is written into its own published
eligibility list.

## Decisions

1. **Stripe, standard account.** Sandbox test keys (`sk_test_…`) now; a live
   account once the company details clear review. The webhook and the checkout
   both key off the prefix, so no code changes at cutover.
2. **Stripe Checkout with inline `price_data`**, priced from our catalog. No
   Stripe Product or Price objects to keep in step with `credit_packs` — the
   catalog stays normative (CLAUDE.md, Money & billing). The amount comes from
   the pending `top_ups` row, never from the client.
3. **We are the merchant of record, so VAT and sales tax are ours.** Stripe Tax
   is **off** until Veyrnox Ltd holds the registrations that make charging it
   lawful; `STRIPE_AUTOMATIC_TAX === 'true'` is the only switch that turns it
   on. Until then the catalog price is the price paid, and the terms say
   Veyrnox Ltd sells directly and charges any tax itself.
4. **The webhook signature carries a timestamp.** `Stripe-Signature` is
   `t=<unix>,v1=<hmac>` over `<t>.<raw body>`, and a delivery more than ±5
   minutes from now is refused. This is a real improvement on ADR-0018
   §replay, which had to accept an unbounded replay window because
   LemonSqueezy sends no timestamp. Dedupe on `webhook_events` still runs.
5. **`top_ups` columns are reused as-is.** `order_id` holds the PaymentIntent
   id (`pi_…`) — a dispute names the charge, not the session, so the
   PaymentIntent is the one id every event shares. `variant_id` becomes
   unused: with `price_data` there is no variant, and the amount check against
   `price_usd_cents` already does the work the variant check did.
6. **Events subscribed**: `checkout.session.completed` (credit),
   `charge.refunded` (clawback on the cumulative `amount_refunded`),
   `charge.dispute.created` (Freeze, per ADR-0019),
   `charge.dispute.closed` (log only, as ADR-0019's `dispute_resolved`).
7. **Supersedes the provider choice in ADR-0003 and ADR-0018 §provider.**
   Everything else in ADR-0018 and ADR-0019 stands: pack sizes and floors, the
   pro-rata refund clawback, the Supply Consent wording, the Freeze rules, and
   credits granted only by a verified webhook.

## Consequences

- **A migration is still required before a single Stripe payment can be
  credited.** `credit_top_up`, `apply_top_up_refund` and `apply_dispute_event`
  all guard `p_order_id !~ '^[0-9]{1,20}$'`, and `top_ups.order_id` plus
  `top_up_flagged_orders.order_id` carry the same CHECK — all four were written
  for LemonSqueezy's numeric order ids and reject `pi_…`. `credit_top_up` also
  flags `VARIANT_MISMATCH` when `p_variant_id` is null against a non-null
  `top_ups.variant_id`, which is now every row. The app layer in this ADR is
  written against the loosened contract and needs no further change; the
  migration is the remaining work and must be applied by the `apply-migrations`
  workflow (ADR-0023) before the account goes live.
- We now owe VAT/sales tax accounting we did not owe under an MoR. Finance
  input needed before decision 3's switch is flipped.
- `credit_packs.variant_id` stays populated and `NOT NULL`-checked by
  `create_pending_top_up`; it is dead data under Stripe and can be dropped in a
  later migration.
- The return-URL backfill (#94) is LemonSqueezy-shaped: it reads `order_id` and
  `order_identifier` from the query string, which Stripe does not send. The
  backfill path is inert under Stripe until it is rebuilt against the
  Checkout Session id.

## Open questions

- Which VAT registrations Veyrnox Ltd needs, and by what revenue threshold, to
  turn Stripe Tax on.
- Whether the live account clears Stripe's own review for AI-generated media;
  the eligibility list says yes, the underwriter has the last word.
