# ADR-0003 — Billing / merchant-of-record

- **Status**: Proposed
- **Date**: 2026-09-10
- **Deciders**: Product owner (approver), Architect, Finance/Legal
- **Blocks**: Phase 2 (billing + free tier)
- **Related**: architecture.md §4.4, §7.1, §11.2, §25.3

## Context

Veyrnox sells credits — a non-rollover pool bought via subscription or top-up (§7.1). The buying flow needs a hosted checkout, subscription lifecycle events (subscribed, updated, cancelled, past-due, refunded), invoices, tax handling, and secure webhooks that the credit service consumes as ledger `+delta` grants (§25.3).

Two structurally different options: **direct Stripe** (you are the merchant, you handle VAT/GST/sales-tax registration in every jurisdiction you sell into) versus **Merchant-of-Record** (LemonSqueezy or Paddle become the seller of record — they collect and remit tax; you get a single 1099-style payout with a cut taken off the top).

This is primarily a **legal and finance decision**, not an engineering one. Engineering can integrate any of these in ~1 week. The choice shapes tax exposure, cash flow, and buyer trust.

## Options considered

### A. Stripe Direct

You are the seller. Stripe processes payments and hosts checkout; Stripe Tax computes VAT/GST but does not remit — you register with each tax authority and file returns.

- Fee: 2.9% + $0.30 domestic, 3.9% cross-border, 1% currency conversion
- Stripe Tax: 0.5% on top for computation
- Your obligation: register + file in every country/state that requires it (EU, UK, Australia, ~40 US states with economic nexus rules for digital goods)
- Payout: cleanly to your bank
- Full control over subscription logic, coupons, dunning

### B. LemonSqueezy (MoR, now owned by Stripe)

LemonSqueezy is the seller. You get a payout. They handle VAT/GST/sales-tax registration and remittance globally.

- Fee: 5% + $0.50 per transaction
- No tax registration burden on you
- Checkout hosted by LemonSqueezy; subscription lifecycle via webhook
- Since Stripe acquired LemonSqueezy (2024), long-term strategic direction is uncertain — likely to converge with Stripe MoR ("Stripe Merchant of Record", currently invite-only for many regions)

### C. Paddle (MoR)

Paddle is the seller. Same shape as LemonSqueezy — global MoR, tax handled, invoices/receipts issued by Paddle.

- Fee: 5% + $0.50 (Paddle Billing) — comparable to LMS
- Longer track record in software MoR than LMS
- Approval process — Paddle vets applicants; not instant

### D. Stripe MoR (Stripe Tax + Stripe Billing with MoR feature)

Stripe's own MoR offering, positioned as a successor to acquisition of LemonSqueezy. Currently rolling out per region.

- Fee: ~5% + Stripe's normal fees baked in
- Not yet universally available
- Betting on this now means being an early customer

## Decision drivers (ranked)

1. **Tax risk elimination** — small team cannot afford to be non-compliant across ~50 tax jurisdictions.
2. **Time-to-Phase-2** — how fast we can accept a card.
3. **Buyer trust** — clean invoices matter for B2B, less so for consumers.
4. **Effective rate at $50k MRR** — the fee delta matters at scale.
5. **Vendor concentration risk** — Stripe is already in the stack indirectly (LemonSqueezy owned by Stripe). MoR options reduce independence.
6. **Refund and dispute UX** — MoR handles disputes on your behalf; direct means you defend chargebacks.
7. **Global reach** — SEPA, Alipay, WeChat Pay, iDEAL, Bancontact, etc.
8. **Escape hatch** — if the vendor goes wrong, how bad is migration?

## Trade-off table

| Driver / Option | A. Stripe Direct | B. LemonSqueezy | C. Paddle | D. Stripe MoR |
|---|---|---|---|---|
| Tax risk | You own it — register + remit everywhere | LMS owns it | Paddle owns it | Stripe owns it |
| Time to Phase 2 | Fastest — SDK is universal | Fast — hosted checkout, 1 day | Fast, minus approval wait | Depends on regional availability |
| Fee | ~3.4–4.4% blended | 5% + $0.50 | 5% + $0.50 | ~5% blended |
| Buyer trust | Your brand on receipts | LMS brand on receipts | Paddle brand on receipts | Stripe brand on receipts |
| Chargebacks | You defend | MoR defends | MoR defends | MoR defends |
| Global payment methods | Best (all of Stripe) | Good | Good | Best (all of Stripe) |
| Subscription lifecycle | Full control | Webhooks + hosted mgmt | Webhooks + hosted mgmt | Full control |
| Vendor concentration | Stripe primary | Stripe indirectly | Independent of Stripe | Stripe primary |
| Refund / dunning UX | You build | Provided | Provided | Provided |
| Escape hatch cost | N/A — you are the merchant | Migrate subscriptions to Stripe direct or Paddle | Migrate to Stripe or LMS | Migrate to Stripe direct or Paddle |

## Recommendation

**Option B — LemonSqueezy**, for launch. Migrate to **Option A — Stripe Direct** when monthly gross revenue exceeds ~$20k/month and the fee delta pays for a fractional accountant to handle tax filings.

Reasoning:

- The tax registration burden of Stripe Direct is real. Registering in the EU alone requires an OSS/IOSS number; the UK is separate post-Brexit; ~40 US states have economic-nexus thresholds for digital goods; Australia GST kicks in at AUD $75k. A solo team should not carry this in the first year.
- The 5% MoR fee is a cost of doing business at small scale. At $5k MRR, that is $250/mo — cheaper than a bookkeeper who does multi-jurisdiction filings.
- LMS specifically because: hosted checkout is polished, subscription webhooks match Stripe's shape (so migration to Stripe later is closest to lift-and-shift), and it is already the leader in digital-goods MoR for indie SaaS.
- Paddle is an equally correct answer; pick LMS if you want faster approval, Paddle if you want the longer track record.
- Reject Stripe MoR (Option D) as too early — the offering is regionally patchwork and the migration story from LMS is trivial when it matures.
- Reject Stripe Direct (Option A) at launch — the fee saving is not worth the compliance burden until revenue justifies a fractional CFO.

**Trigger to migrate from B to A**: gross revenue > $20k/month sustained for 3 months, or LemonSqueezy discontinuation notice, whichever first. Design the billing webhook consumer to accept a normalised event shape so the underlying provider is behind an adapter.

## Consequences

If Option B (LemonSqueezy) accepted:
- Buyer-facing receipts show "LemonSqueezy" as seller. Some B2B buyers dislike this; not a problem for the current B2C credit-pack shape.
- Chargebacks and refunds are handled by LMS support first, escalate to us on merits. Reduces the ops burden.
- Webhook signature verification is HMAC-SHA256 with `X-Signature` header (§25.7 uses "HMAC for Stripe"; the same primitive applies to LMS).
- Ledger grants (§25.3) are `+delta` entries with `source='billing:lemonsqueezy'` and `idempotency_key = <event_id>`.
- The billing adapter interface (§8.5) must be an abstraction, not a Stripe-shaped client. Every field the app reads from a billing event must have a normalised name.

If Option A (Stripe Direct) accepted instead:
- You (the legal entity behind Veyrnox) register for VAT/GST in every applicable jurisdiction before public launch. Timeline: 2–4 weeks per major bloc.
- Cost saving on fees is 1–2 percentage points; at $20k MRR that is $200–$400/mo.
- Full control over dunning cadence and copy — a real product lever.

Both:
- Stripe/LMS webhooks must use idempotency + a `webhook_events` table (§25.7) to prevent replayed events from double-granting credits.
- Refund path is a compensating negative ledger entry, not a row update.

## Open questions

- Which legal entity is the merchant? Sole proprietor vs. LLC vs. Ltd changes what LMS/Paddle will accept.
- Is anonymous top-up on the table? "Buy 200 credits without signing up" is possible on Stripe checkout links but complicates the ledger (no user_id) — solved by creating a shadow user on payment and emailing a login link.
- Where does the product owner live? US, UK, EU — determines tax residency and whether LMS/Paddle even accepts the merchant application.
- Does the pricing page show plans + top-ups or only plans at launch? The billing adapter differs — subscriptions vs. one-shot charges.
