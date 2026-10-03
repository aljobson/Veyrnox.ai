# ADR-0062 — Veyrnox Publish entitlement: an independent plan, not the credit ledger

- **Status**: **Accepted 2026-09-28.** Product owner approved the entitlement
  mechanism (Option A — independent "Publish Plan," never touching the credit
  ledger), the free-tier direction (one account/one network free, more on paid
  tiers), and the sales channel (web/Stripe only for v1, no App Store), all as
  proposed, no changes. Deferred by
  [ADR-0061](0061-veyrnox-publish-social-scheduling.md)'s open question 1 and the
  spec pack's `docs/social-publisher/01-product-spec.md` §1.8 before this ADR
  resolved it.
- **Date**: 2026-09-28
- **Deciders**: Product owner (sole) — accepted
- **Related**: [ADR-0061 — Veyrnox Publish](0061-veyrnox-publish-social-scheduling.md)
  (the feature this ADR bills for), [ADR-0057 — Social Cinema viewer paywall,
  modelled on ReelShort](0057-cinema-viewer-paywall.md) (the direct precedent this
  ADR follows — a recurring, non-ledger entitlement already Accepted and built),
  [ADR-0018 — Credit Pack Top-ups before Subscriptions](0018-credit-pack-top-ups.md),
  [ADR-0031 — Stripe replaces LemonSqueezy](0031-stripe-replaces-lemonsqueezy.md)
  (Managed Payments, Checkout Sessions), `CONTEXT.md` (Credit Pack / Top-up /
  Subscription glossary).

## Context

ADR-0061 specified *what* Veyrnox Publish does and explicitly refused to decide *how
it's billed*, flagging that mixing it into the generation-credit ledger without an ADR
would violate this repo's money-spine rules. This ADR makes that call.

**The glossary's `Subscription` does not exist yet.** `CONTEXT.md` is explicit:
"A recurring plan that grants a monthly allotment of credits. **Planned, not yet
offered.**" Today the only way to buy anything is a one-off Credit Pack Top-up
(ADR-0018). So "gate Publish behind a Subscription" is not actually an option without
first shipping the general-purpose credit-allotment Subscription system — a much larger,
unrelated piece of work this ADR should not become a dependency of.

**There is already a live precedent for exactly this shape of decision.** ADR-0057
(Social Cinema's viewer paywall) faced the identical structural problem: a recurring
paid entitlement (Cinema Pass, $14.99/$49.99/$199.99) that has nothing to do with
generation cost. Its answer, Accepted and built (migrations 0142–0144, PR #344):

> "A Cinema Pass never touches the ledger. It grants no credits and moves no balance...
> Entitlement is derived on the server from `cinema_passes` state and period end...
> through one RPC."

And explicitly rejecting the alternative:

> "Cinema Pass as a credit Subscription. The glossary's planned Subscription could
> carry a viewing entitlement. **Rejected**: it would tie a $14.99 weekly viewing plan
> to credit allotments and per-period expiry buckets that do not exist yet, and would
> leak generation cost into an unlimited promise."

Cinema Pass runs on Stripe Checkout in **subscription mode with inline recurring
`price_data`** — no pre-created Stripe Price object to drift — reusing the existing
Stripe webhook route with new event types (`customer.subscription.created/updated/
deleted`, `invoice.paid`, `invoice.payment_failed`) deduped through the existing
`webhook_events(source, external_id)` table. This is proven, shipped infrastructure,
not a proposal.

**Publish's cost profile is even more favorable than Cinema Pass's.** Cinema Pass still
carries a real marginal cost (Cloudflare Stream delivery bandwidth), which is why it
needed a 3,000-minute fair-use ceiling ("~$3/month at the ceiling against $49.99").
Publish has **no provider-proportional marginal cost per scheduled post** — platform
APIs (Meta, TikTok, X, LinkedIn, YouTube) don't charge Veyrnox per call the way fal.ai,
kie.ai or BytePlus charge per generation. The cost of a scheduled post is Veyrnox's own
compute (a Cron Worker invocation) and storage (already-generated media, already paid
for at generation time) — both effectively sunk. This makes the case for "flat
entitlement, no ledger" *stronger* than Cinema Pass's already-accepted case, not weaker.

**One thing Cinema Pass is still waiting on:** its feature switch
(`CINEMA_SUBSCRIPTIONS_ENABLED`) ships **off**, blocked on "written Stripe acceptance for
recurring viewer plans over user-uploaded video under Managed Payments" — a category-risk
check that exists because Cinema streams user-generated video content, the same general
shape of risk that got LemonSqueezy to reject this account outright (ADR-0031). Publish
is not video-hosting or content-streaming; it's a scheduling/posting utility. The
category risk is plausibly much lower, but "plausibly lower" is not "confirmed" — this
is called out as an open question below rather than assumed away.

## Options considered

### A — Independent "Publish Plan," modelled on Cinema Pass (recommended)
A dedicated recurring entitlement, sold via Stripe Checkout subscription mode with
inline recurring `price_data`, entitlement derived server-side by RPC, never touching
the credit ledger. Reuses the Stripe webhook plumbing ADR-0057 already built.

### B — Wait for the general-purpose credit-allotment Subscription
Ship Publish's billing as a benefit tier of the glossary's planned `Subscription`
once it exists. Blocks Publish's launch on an unrelated, larger, not-yet-scoped system.

### C — Draw from the existing generation-credit ledger
Debit credits per scheduled or published post, mirroring how a generation debits
credits. Rejected in the spec pack's §1.8 already, for the same reason ADR-0057 rejected
it for Cinema Pass: there's no provider cost to recover, so metering it as credits
conflates two unrelated cost models and invites confusing UX ("why does posting to
Instagram cost the same unit as generating a video?").

### D — Free / ungated for every user
No entitlement check at all. Maximizes adoption of the Generate → Schedule
differentiator (ADR-0061's stated wedge) but leaves no monetization path and no
anti-abuse lever (a free, uncapped scheduler is an open invitation to mass-post spam
through connected platform accounts, burning Veyrnox's own OAuth app standing with
each platform).

### E — One-off "Publish unlock" (non-recurring)
A single permanent purchase unlocking Publish, rather than a recurring plan. Simpler
billing, but mismatched to a feature whose ongoing value (continued scheduling, more
connected accounts, more brands) scales with continued use — a recurring plan captures
that better and matches Metricool's own model (tiered by connected-profile count,
billed monthly/annually), which is the functional reference ADR-0061 is built from.

## Decision drivers (ranked)

1. **Don't leak generation cost into an unrelated feature.** Same reasoning ADR-0057
   already established and this repo has already accepted once — reapplying it here is
   consistency, not a new argument to win.
2. **Reuse proven infrastructure over inventing new infrastructure.** Cinema Pass's
   Stripe subscription-mode Checkout, webhook dedup, and server-side entitlement RPC
   pattern are shipped code paths, not theory.
3. **Don't block Publish's launch on the general Subscription system**, which is
   unscoped, unbuilt, and not this ADR's problem to solve.
4. **Preserve the Generate → Schedule differentiator's adoption value** (ADR-0061 §1.1)
   — the entitlement model should let a user *experience* the wedge before paying for
   more of it, not gate it entirely behind a paywall from the first click.
5. **Anti-abuse, not cost-recovery.** Even at zero marginal provider cost, an uncapped
   free scheduler is a vector for spamming connected platform accounts and burning
   Veyrnox's OAuth app standing with each platform (a real, if non-monetary, cost).

## Trade-off table

| | A. Publish Plan (Cinema Pass pattern) | B. Wait for Subscription | C. Credit ledger debit | D. Free/ungated | E. One-off unlock |
|---|---|---|---|---|---|
| Leaks generation cost into Publish | No | No | Yes — exactly what ADR-0057 rejected | N/A | No |
| Blocks on unbuilt system | No | Yes — full dependency | No | No | No |
| Reuses proven infra | Yes — Cinema Pass's Stripe/webhook code | Partial — Subscription system doesn't exist yet either | Yes (ledger exists) but conceptually wrong fit | N/A | Partial — one-off Checkout exists (Top-ups) |
| Preserves free-taste adoption | Yes — a free tier is a product decision within this model, not precluded by it | Delayed until Subscription ships | Possible but re-introduces the cost-conflation problem | Yes, by definition | No — pay-or-nothing |
| Anti-abuse lever | Yes — plan tiers cap connected accounts/posts | Yes, eventually | Yes (each post costs a debit) but wrong signal | None | Yes, but a one-time payment can't gate ongoing usage growth |
| Matches Metricool's own model | Yes (tiered by connected-profile count) | No | No | No | No |

## Recommendation

**Accepted 2026-09-28: Option A — an independent "Publish Plan," modelled directly on
Cinema Pass's already-Accepted pattern.** The product owner approved this, and the
free-tier direction and sales channel below, with no changes. Concretely:

- New tables mirroring `cinema_pass_plans`/`cinema_passes`: `social_publish_plans`
  (plan definitions: name, price, connected-account cap, brand cap) and
  `social_publish_subscriptions` (a brand's active plan, Stripe subscription id, period
  end), never touching `ledger_entries` or `credit_balances`.
- Stripe Checkout in subscription mode with inline recurring `price_data`, same as
  Cinema Pass — no Stripe Price object to drift, reusing the existing webhook route with
  the same `customer.subscription.*` / `invoice.*` event types already wired for Cinema
  Pass, deduped through the same `webhook_events` table.
- Entitlement derived server-side through one RPC (e.g. `read_publish_entitlement`),
  mirroring the Cinema Pass entitlement RPC — never a client-trusted flag.
- **A free tier within this model, not instead of it**: e.g. one connected account on
  one network, enough to experience the Generate → Schedule flow end to end, with paid
  tiers unlocking more accounts/networks/brands and (once built) Phase 2/3 features
  (approval workflow, competitor tracking, SmartLinks). Exact free-tier and paid-tier
  numbers are a pricing decision **not made here** — this ADR fixes the *mechanism*
  (independent recurring plan, ledger untouched), not the price.
- **Naming discipline, matching ADR-0057's own care**: call it "Publish Plan," not
  "Subscription" — the glossary term is reserved for the credit-allotment plan and using
  it here would create exactly the ambiguity `CONTEXT.md`'s "Pack Credits" entry already
  warns about ("Purchased credits (ambiguous once Subscriptions exist)").

## Consequences

- `CONTEXT.md` gains a **Publish Plan** glossary entry, with an explicit `_Avoid_:
  Subscription (reserved for the credit-allotment plan)` note, matching how ADR-0057
  added Cinema Pass terms.
- A new feature switch, `PUBLISH_PLANS_ENABLED`, mirrors `CINEMA_SUBSCRIPTIONS_ENABLED`
  in shape (master flag, ships off) — not the same flag, since Publish and Cinema are
  unrelated features that happen to share a billing pattern.
- New Stripe webhook event handling is additive to the existing route, not a new
  integration — same signature verification, same `webhook_events` dedup, same
  "payload customer is never trusted for identity, the row is looked up by Stripe
  subscription id" discipline ADR-0057 already established.
- `reconcile_balances()` and `reconcile_free_credits()` are unaffected, exactly as
  ADR-0057 notes for Cinema Pass, since no ledger row is ever written for a Publish
  Plan purchase, refund, or cancellation.
- Publish's v1 scope (ADR-0061) can now proceed with a billing shape decided, but actual
  plan pricing, connected-account caps per tier, and the free-tier limit are separate,
  smaller decisions the product owner can make without another architecture-level ADR —
  a pricing note is enough once those numbers are chosen.
- Cooling-off / consumer-law treatment should follow the same pattern ADR-0057 specifies
  for Cinema Pass (14-day pro-rata refund in the UK/EU on first charge), since a Publish
  Plan is the same class of distance contract for a recurring digital service.

## Open questions

**Resolved at acceptance (2026-09-28):**
- **Sales channel** — confirmed web/Stripe-only for v1, no App Store in-app-purchase
  scope, matching Cinema Pass.
- **Free-tier direction** — confirmed: one connected account, one network, free; more
  accounts/networks/brands on paid tiers. The exact free-tier *limit* is still a
  smaller, separate pricing decision (see below) — the direction, not the number, was
  what needed sign-off here.

**Still open, none blocking implementation start but all needed before GA:**

1. **Confirm Stripe's stance on recurring billing for Publish specifically**, rather
   than assuming Cinema Pass's "written Stripe acceptance" blocker doesn't apply here.
   The category risk is plausibly much lower — Publish is a scheduling utility, not
   video-hosting or streaming of user-generated content — but this should be a quick
   confirmation, not an assumption, especially given ADR-0031's LemonSqueezy-rejection
   history for the broader "AI media generation" category this account already sits in.
   This is external verification, not a product-owner decision, so accepting the
   mechanism above doesn't resolve it.
2. **Exact plan tiers, prices, connected-account/brand caps per tier, and the exact
   free-tier limit** — drafted and now **Accepted** as [ADR-0063](0063-veyrnox-publish-plan-pricing.md):
   Free (1 account) and Publish Plan ($19/mo, 5 accounts), grounded in live-read Metricool
   and Buffer pricing.
3. **Does a Publish Plan cancellation need the same "second subscription while one is
   live gets flagged and auto-cancelled" guard ADR-0057 built for Cinema Pass** (to
   prevent a brand accidentally double-subscribing)? Likely yes, by the same reasoning,
   but should be confirmed during implementation rather than assumed here.
