# ADR-0018 — Credit Pack Top-ups before Subscriptions

- **Status**: Accepted (2026-09-13), subject to the preconditions below. Decision 8 amended by [ADR-0019](0019-dispute-webhooks-freeze.md).
- **Date**: 2026-09-13
- **Deciders**: Product owner (approver); Finance/Legal to confirm tax display and consent wording
- **Related**: [ADR-0003 — Billing / merchant-of-record](0003-billing-provider.md), [ADR-0013 — Credit expiry policy](0013-credit-expiry-policy.md), [ADR-0014 — Floor pricing](0014-floor-pricing.md), `CONTEXT.md` (Credits and buying, Reversals)

## Context

Nothing takes money today. The credits page shows disabled "indicative" packs
(300 cr/$9, 750 cr/$19, 2000 cr/$49), and PR #79 removed the subscription tiers
because nothing implemented them.

The platform model ("AI - Audio - Video - Platform model", 2026-09-12) assumes
Higgsfield-style subscriptions plus top-up packs, and says its margin depends on
subscriptions: roughly 55% credit utilisation and non-rollover monthly credits.
Higgsfield's live pricing (2026-09-12) is Starter $19/270, Plus $59/1200, Ultra
$129/3000 per month; subscription credits expire each cycle and add-on packs
expire after 90 days. MuAPI sells a never-expiring USD balance.

ADR-0014 prices every model at $0.033/credit for a 50% margin. The indicative
packs all fall below that once LemonSqueezy's fee is taken: 5% + $0.50 on the
tax-inclusive total, plus 1.5% outside the US.

LemonSqueezy (ADR-0003) constrains the design. It sends no dispute or chargeback
webhooks; it may refund an order itself within 60 days and "in most cases"
refunds disputed payments on our behalf ($15 fee). Its webhooks carry an
HMAC-SHA256 `X-Signature` over the body but no timestamp and no event ID, and
are retried only three times over about 2.5 minutes. Its prohibited-products
list includes "services of any kind" and says nothing about AI generation.

## Decision

1. **Credit Packs ship first; Subscriptions are the next slice.** The target end
   state is Subscriptions plus Credit Packs. Packs are the smallest slice that
   takes real money and need no credit-bucket tracking.
2. **Web only, LemonSqueezy as Merchant of Record.** Every grant records its
   Sales Channel and packs are priced per channel, so iOS/Play can be added
   without reshaping the ledger.
3. **Packs: 100 cr/$10, 300 cr/$25, 1,000 cr/$75.** USD only, prices shown
   tax-exclusive with the total at checkout. Pack Credits never expire
   (ADR-0013 unchanged).
4. **Two pricing floors, both enforced when a price is set:**
   - net of the Merchant of Record's fee and before tax, every Sales Channel
     must yield ≥ $0.033/credit (keeps ADR-0014's margin true on cash received);
   - a Credit Pack must cost more per credit than every Subscription,
     ≥ $0.075/credit (the Starter reference rate), so no plan is made pointless.
5. **Crediting.** A pending Top-up row is written for the signed-in user before
   the hosted-checkout redirect, and its id travels in checkout custom data. The
   webhook verifies the signature, re-fetches the order from the LemonSqueezy
   API, dedupes in `webhook_events`, and grants via `ledger_grant` to the pending
   row's user, never to a user named in the payload. A scheduled backfill credits
   paid orders whose Top-up is still pending after 10 minutes. Each Top-up is
   credited exactly once, keyed on the Top-up row: the first paid order wins,
   and any further paid order for it (a replayed buy request can open a second
   checkout) or a paid order that doesn't match the pack's variant, pre-tax
   price and USD is recorded for an Operator refund and never granted (#93).
   An order that was paid and has since been refunded, in full or in part, still
   counts as paid for both the webhook and the backfill: it is credited and its
   refunded share clawed back as in decision 7. The backfill does both in one
   transaction, so a clawback that fails leaves the Top-up pending to retry
   rather than credited without it (#142).
6. **Consent.** The buy dialog requires a ticked acknowledgement that credits are
   supplied immediately and the right to cancel ends once the user generates. It
   is stored on the pending Top-up with a timestamp and wording version.
7. **Top-up Refunds.** Operators issue them in the LemonSqueezy dashboard, within
   14 days and only if nothing was generated since that Top-up. Every
   `order_refunded` event, whoever issued it, claws back a proportional share of
   that Top-up's Pack Credits, rounded down and never taking the balance below
   zero. Refund events dedupe on order id plus refunded amount. The share is
   the refunded amount over the order total, tax included, since that is what
   LemonSqueezy's `refunded_amount` is measured against. A clawback takes Pack
   Credits only, never Free Credits (ADR-0013), and a shortfall is not collected
   later from the user's other Top-ups (#96).
8. **Chargebacks are inferred.** A refund arriving after credits were spent since
   that Top-up was bought (its checkout started, not when it was credited, so a
   backfilled order is judged the same as a webhook-credited one) Freezes the account: generating and buying are blocked; sign-in,
   library, downloads and deletion still work. Only an Operator unfreezes, through
   an audited function recording who and why.

## Considered options

- **Subscriptions at launch.** Matches the model and Higgsfield, but needs
  recurring billing, dunning, per-period expiry and credit buckets on day one.
  Deferred, not rejected.
- **Packs between Ultra ($0.043) and Starter ($0.070) per credit.** Cheaper packs
  that never expire would make Starter pointless.
- **Pro-rata refunds of the unspent part.** Needs per-pack spend tracking that the
  ledger does not have; "nothing generated since" is checkable from the ledger and
  keeps the balance non-negative by construction.
- **Stripe Direct.** Both competitors use it, but ADR-0003's tax-remittance reason
  still holds pre-revenue.

## Consequences

- **Deviation from `CLAUDE.md`:** HMAC webhooks there require a ≤5-minute replay
  window. LemonSqueezy sends no timestamp, so none is enforced. Replays are made
  harmless instead: signed body, re-fetched order as source of truth, and
  `webhook_events` dedupe.
- **Backfill needs the buyer to come back (#94).** LemonSqueezy's order API
  has no custom data and no filter for it, so an order can't be found from a
  Top-up id. The checkout return URL (confirmation button and receipt link)
  carries LemonSqueezy's `[order_id]` and `[order_identifier]`; the return page
  records them on the buyer's own pending Top-up, and the backfill credits the
  re-fetched order only if its identifier matches. A buyer who never follows
  either link and whose webhook is lost stays pending for an Operator.
- **Preconditions before building:** LemonSqueezy support confirms that prepaid
  AI-generation credits are not a prohibited "service"; if refused, reopen
  ADR-0003 (Paddle or Stripe Managed Payments). Finance/Legal confirm
  tax-exclusive display and the consent wording.
- **Copy changes:** replace the indicative pack buttons; refund page becomes "14
  days, if nothing generated since"; privacy policy names LemonSqueezy.
- **ADR-0013 enforcement** (Free Credits expire after 90 days and are spent first)
  stays out of this slice but must ship before Subscriptions, which need the same
  bucket tracking.
- **Future Subscription prices are constrained now:** annual Ultra cannot go below
  about $105/month without breaking the net floor (Higgsfield discounts to $99).
- **Packs will look expensive against Higgsfield** (their Kling 3.0 720p 5s is ~7
  credits ≈ $0.30–0.49; ours is 31 credits ≈ $2.30 at pack rates). The lever is
  ADR-0014's per-model credits and the catalog gap (no image-edit models,
  Seedance 2.5 or Seedream 5), handled in a separate pricing review.
- Operator tooling is audited service-role functions only; an admin UI for
  Top-ups and unfreezing is a follow-up.
