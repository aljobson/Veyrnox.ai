# ADR-0064 — Veyrnox.ai core Subscriptions: build now, mirroring Higgsfield's tiers

- **Status**: **Accepted 2026-09-28.** Product owner approved building now (not
  continuing to defer), the recommended tiers (Starter $19/270cr, Plus $59/1200cr,
  Ultra $129/3000cr, mirroring Higgsfield), and the ledger spend order
  (Subscription Credits spent before Free Credits, soonest-expiring-first), all
  as proposed, no changes. Picks up ADR-0018's explicitly deferred slice
  ("Subscriptions are the next slice... Deferred, not rejected"). Implementation
  may now proceed under this ADR's design; Finance/Legal still owes tax/consent
  wording per ADR-0018's own precedent before launch.
- **Date**: 2026-09-28
- **Deciders**: Product owner (sole) — accepted; Finance/Legal for tax/consent
  wording, per ADR-0018's own precedent
- **Related**: [ADR-0018 — Credit Pack Top-ups before Subscriptions](0018-credit-pack-top-ups.md)
  (established the floors and Higgsfield reference this ADR builds on), [ADR-0013 —
  Credit expiry policy](0013-credit-expiry-policy.md) (Free Credits; the bucket-tracking
  precedent a Subscription bucket extends), [ADR-0014 — Floor pricing](0014-floor-pricing.md)
  ($0.033/credit net margin floor), [ADR-0031 — Stripe replaces LemonSqueezy](0031-stripe-replaces-lemonsqueezy.md)
  (Managed Payments, subscription mode), [ADR-0057 — Cinema Pass](0057-cinema-viewer-paywall.md)
  (first proof that Stripe subscription mode with inline recurring `price_data` works on this
  stack), [ADR-0063 — Publish Plan pricing](0063-veyrnox-publish-plan-pricing.md) (a second,
  unrelated recurring-billing precedent, confirming the pattern generalizes), `CONTEXT.md`
  ("Subscription" glossary entry, currently "planned, not yet offered").

## Context

This is Veyrnox's **core** generation-credit Subscription — a monthly credit allotment for the
main product (images/video/voice), distinct from Publish Plan (ADR-0063, a separate recurring
entitlement for an unrelated feature that explicitly does not touch the credit ledger). Not to
be confused with each other.

**What ADR-0018 already decided, two weeks ago, and why this ADR doesn't re-litigate it:**

- Credit Packs ship first, which they now have (100cr/$10, 300cr/$25, 1000cr/$75, live).
  > Note, 2026-10-03: the packs on sale today are 100/$10, 270/$19, 1,200/$59
  > and 3,000/$129. The 300 and 1,000 packs were retired.
- Subscriptions are "the target end state... the next slice... deferred, not rejected."
- Two pricing floors already fixed: every Sales Channel must net ≥ $0.033/credit after fees
  (ADR-0014's margin), and **a Credit Pack must cost more per credit than every Subscription,
  ≥ $0.075/credit** — meaning Subscriptions are *supposed* to undercut Packs per credit, by
  design, in exchange for the recurring commitment. This is not a new risk this ADR introduces;
  it's the mechanism ADR-0018 already chose.
- **Higgsfield is already the reference comparable**, not a fresh choice made here: ADR-0018's
  own Consequences section computed "annual Ultra cannot go below about $105/month without
  breaking the net floor (Higgsfield discounts to $99)" directly against Higgsfield's published
  rates. This ADR's tier recommendation mirrors Higgsfield's numbers on purpose, because ADR-0018
  already built its constraint math around them — not because copying a competitor's price is a
  substitute for a pricing decision.
- **The stated technical blocker is resolved.** ADR-0018: "ADR-0013 enforcement... stays out of
  this slice but must ship before Subscriptions, which need the same bucket tracking." Checked
  live in this pass: `free_delta`/`free_balance` bucket tracking and `expire_free_credits` are
  implemented (migrations 0037, 0038, and referenced through 0054–0059) — the prerequisite
  infrastructure for a second, similarly-bucketed credit type already exists and works.
- **Stripe subscription mode is now proven on this stack**, twice over: Cinema Pass (ADR-0057,
  built, migrations 0142–0144) uses Stripe Checkout in subscription mode with inline recurring
  `price_data`, and this session's own Publish Plan (ADR-0062/0063) adopts the identical pattern.
  When ADR-0018 was written, this was untested; it no longer is.

**What's changed since ADR-0018 that makes "build now" newly reasonable, not just theoretically
next in line:** the blocker is gone, the billing pattern is proven twice, and — from this
session's own research — **both direct competitors researched for Veyrnox Publish already sell
subscriptions in this exact category** (AI generation credits), not just scheduling tools:

- **Higgsfield** (already ADR-0018's reference): Starter $19/270 credits, Plus $59/1200, Ultra
  $129/3000, monthly, non-rollover, add-on packs expire after 90 days.
- **syntx.ai** (independently verified live, this session, 2026-09-28, authenticated pricing
  modal — see `docs/social-publisher/03-design-style-guide.md` §3.8 and
  `docs/pricing/syntx-competitor-analysis-2026-09-26.md`): Basic $9.41/260, Pro $17.96/680, VIP
  $43.61/1700, Elite $65.46/2600, Ultra Elite $125.40/3000 — a finer-grained 5-tier ladder over
  the same rough token-count bands as Higgsfield's 3.

Veyrnox is the only one of the three still Packs-only.

## Options considered

### A — Build now, mirror Higgsfield's exact tiers (recommended)
$19/270, $59/1200, $129/3000 monthly, deliberately matching the numbers ADR-0018 already built
its floor math around, cross-checked against syntx.ai's independently-confirmed 5-tier data as a
second real data point in the same category.

### B — Build now, a finer 5-tier ladder mirroring syntx.ai instead
More tiers, smaller price steps. Rejected for v1: more billing-engineering surface (five Stripe
prices instead of three) for marginal differentiation value at launch, and syntx.ai's own 5-tier
structure wasn't the number ADR-0018's constraint math was built against — adopting it now would
mean re-deriving the floors, not reusing work already done.

### C — Continue deferring
Stay Packs-only. The case for this weakens with every week the blocker stays resolved and unused
— two competitors already monetize this exact category with subscriptions, and the "why not yet"
reasons from ADR-0018 (missing bucket tracking, unproven Stripe subscription mode) no longer
apply. Not unreasonable if there's a roadmap reason this session doesn't have visibility into —
flagged as the genuine "not now" option, not dismissed.

### D — Skip Subscriptions permanently, only ever sell Packs
Rejected: ADR-0018 already decided against this ("the target end state is Subscriptions plus
Credit Packs"); revisiting that call isn't this ADR's scope, and no new information in this
research pass argues for reversing it.

## Decision drivers (ranked)

1. **Whether the stated blocker is actually resolved** — it is (checked live above), which is
   the single biggest fact that's changed since ADR-0018.
2. **Reuse ADR-0018's already-computed pricing floors** rather than re-deriving them — Option A
   does this exactly; Option B would require new floor math.
3. **Competitive parity** — both researched competitors in adjacent-but-comparable categories
   (Higgsfield: direct AI-generation competitor; syntx.ai: direct AI-generation competitor,
   independently re-confirmed this session) already sell subscriptions; Veyrnox doesn't.
4. **Proven billing pattern, twice over** — Cinema Pass and Publish Plan both already exercise
   Stripe subscription mode with inline recurring `price_data` on this exact codebase.
5. **Cannibalization is a known, accepted trade-off, not a new risk** — ADR-0018 deliberately
   priced Subscriptions to undercut Packs per credit; the product owner already accepted that
   shape when approving ADR-0018's floors, not something this ADR is introducing.
6. **Recurring-billing operational load is real and new**: dunning (failed renewal payments),
   cancellation/proration, and per-cycle credit expiry are engineering and support surface area
   Packs alone don't have. Cinema Pass's build (ADR-0057 Phase 2) is the closest existing
   precedent for what this costs to build correctly.

## Trade-off table

| | A. Build now, mirror Higgsfield | B. Build now, mirror syntx.ai's 5 tiers | C. Continue deferring | D. Packs only, forever |
|---|---|---|---|---|
| Reuses ADR-0018's floor math | Yes, directly | No — needs new derivation | N/A | N/A |
| Competitive parity | Yes | Yes, more granular | No | No |
| Billing engineering surface | 3 Stripe prices | 5 Stripe prices | None (no new work) | None |
| Blocker status | Resolved, ready | Resolved, ready | N/A — deferred regardless | N/A |
| Matches ADR-0018's stated end state | Yes | Yes | Consistent (still "next," not "now") | Contradicts ADR-0018 |
| New operational load (dunning, proration) | Yes | Yes, more variants | None | None |

## Recommendation

**Accepted 2026-09-28: Option A — build now, deliberately mirroring Higgsfield's published
tiers.** The product owner approved this, and the spend-order question below, with no changes.

| Plan | Monthly | Credits | Per-credit | vs. ADR-0018's $0.075 Pack floor |
|---|---:|---:|---:|---|
| Starter | $19 | 270 | $0.070 | Below — as designed |
| Plus | $59 | 1,200 | $0.049 | Below — as designed |
| Ultra | $129 | 3,000 | $0.043 | Below — as designed; matches ADR-0018's own $0.043 Ultra reference |

- **Non-rollover, per cycle** — credits granted each billing period expire at cycle end, matching
  Higgsfield's own model and avoiding indefinite-accrual bucket complexity.
- **Annual billing**: apply Higgsfield's own discount shape (their Ultra goes to $99/mo annual)
  — Veyrnox's own equivalent floor was already computed in ADR-0018 ("annual Ultra cannot go
  below about $105/month without breaking the net floor"), so **annual Ultra should launch at
  $109–115/month**, not $99, to stay clear of that floor with margin for Stripe's own fee on the
  larger transaction. Starter/Plus annual rates should be derived the same way (apply the net
  floor check per tier, don't just apply a flat "Higgsfield's discount %" without re-checking).
- **Stripe Checkout, subscription mode, inline recurring `price_data`** — identical mechanism to
  Cinema Pass and Publish Plan; no new payment pattern to build, only new price points and a new
  credit-bucket type.
- **Web only for v1**, consistent with ADR-0018 decision 2's Sales Channel design (packs are
  priced per channel specifically so iOS/Play can be added later without reshaping the ledger —
  Subscriptions should follow the same discipline).

## Consequences

- A third credit bucket type (`subscription_delta`/`subscription_balance`, alongside the existing
  `free_delta`/`free_balance` and Pack Credits) needs a **spend-order decision** — flagged as an
  open question below rather than assumed, since it changes ledger behavior `CONTEXT.md` already
  documents.
- New Stripe webhook events on the existing route: `customer.subscription.created/updated/deleted`,
  `invoice.paid`, `invoice.payment_failed` — the exact event set Cinema Pass (ADR-0057) already
  wired up, reusable rather than novel.
- Dunning: a failed renewal charge needs a defined grace period and a clear "what happens to
  unused Subscription credits" answer before this ships — not specified here, needs its own
  short design note during implementation, following Cinema Pass's cancellation/proration
  precedent where one exists.
- `CONTEXT.md`'s "Subscription" glossary entry moves from "Planned, not yet offered" to
  documenting the actual mechanics once built.
- Existing Pack buyers may migrate toward Subscriptions post-launch (the intended effect of
  pricing Subscriptions cheaper per credit) — worth watching blended per-credit revenue after
  launch, not a reason to block launch.

## Open questions

**Resolved at acceptance (2026-09-28):**
- **Build-now vs. continue-deferring** — the product owner chose to build now.
- **Ledger spend order for three bucket types** — Subscription Credits spend before Free Credits
  (soonest-expiring-first: Subscription → Free → Pack). `CONTEXT.md`'s Free Credits and
  Subscription entries are updated to state this explicitly.

**Ledger design, built 2026-10-03 (migrations 0183, 0184; IMPLEMENTATION-PLAN C2/C3):**

- **Bucket.** `ledger_entries.subscription_delta`, `credit_balances.subscription_balance`
  and `credit_balances.subscription_expires_at`, beside the Free Credit columns.
  `free_balance + subscription_balance <= balance`, enforced by a CHECK. A `subscription_cycle`
  counter on both tables says which cycle a row's Subscription part belongs to.
- **Spend order** as accepted above: Subscription, then Free, then Pack, in `ledger_debit` and
  in the Cinema `ledger_unlock`.
- **Grant.** `subscription_grant(user, credits, period_end, key)`. The key is the provider's id
  for the paid invoice; a replay is a no-op, however late, and the same key can never credit a
  second account. An invoice whose period does not end after the current one is refused
  (`PERIOD_NOT_NEWER`), so an older invoice delivered out of order cannot replace a newer cycle.
  **This also refuses three invoices a customer has paid: a mid-cycle upgrade, a switch from
  annual to monthly before the annual end, and a resubscription to a shorter plan before the old
  end date. Each returns `PERIOD_NOT_NEWER` and grants nothing. C4 must decide what those mean
  before the webhook calls this function; the rule may need to allow them.** Decided 2026-10-03,
  below ("Plan changes"): the rule stays as built, and C4 arranges billing so none of the three
  produces such an invoice.
- **No rollover.** A grant first expires whatever the previous cycle left.
- **Cycle end.** Past `subscription_expires_at` the credits cannot be spent, and an hourly sweep
  (`expire_subscription_credits`) removes them. Balance readers leave them out in the meantime.
- **Refunds.** Each part returns to the bucket it came from. The Subscription part that came
  from a cycle which has since ended or been replaced is returned and expired again in the same
  call: the ledger shows the refund and an `expire:subscription` row, and the bucket is
  unchanged. Returning it as Pack Credits would turn expiring credits into permanent ones;
  leaving it in the bucket after a renewal would be a rollover. Both were rejected. The same
  rule applies to a reversed Cinema unlock.
- **Clawback.** A Pack refund or dispute takes Pack Credits only.
- **Audit.** `reconcile_subscription_credits()` joins the nightly reconcile, and the hourly
  `reconcile_status` snapshot carries its count (0185).
- **Not live.** Nothing calls `subscription_grant`, so every balance has zero Subscription
  Credits and the changed functions behave as before.

**Cancellation and failed renewals, confirmed by the product owner 2026-10-03** (the defaults
the ledger design implies, now decisions for C4):

- **A cancelled subscription keeps its credits until the period it paid for ends.** Nothing is
  taken back at cancellation; the cycle expires at `subscription_expires_at` as any other does.
- **A failed renewal gets no grace period.** No paid invoice means no grant, so the old cycle
  expires at its end and the account has no Subscription Credits until a renewal is paid.

**Plan changes, confirmed by the product owner 2026-10-03.** Upgrades happen now with a new
period; everything else waits for the paid period to end.

- **Upgrade mid-cycle** (to a higher tier): takes effect immediately and
  starts a fresh billing period. Stripe credits the unused time on the old plan against the new
  charge. The new plan's full credits are granted and the old cycle's remainder expires, as at
  any renewal (no rollover). The owner accepted that an upgrading customer loses what was left.
- **Downgrade, or annual to monthly:** takes effect when the current paid period ends. Nothing
  is invoiced or granted before then.
- **Resubscribing while a cancelled plan is still running:** the customer can resume the same
  plan; a different plan starts when the current period ends.
- Not decided: monthly to annual on the same tier. Until it is, C4 treats it like the other
  non-upgrade changes and starts it at the period end.

Every invoice this produces ends after the current cycle, so `subscription_grant` and its
`PERIOD_NOT_NEWER` rule need no change. C4 must configure Stripe to match: reset the billing
cycle on an upgrade, schedule every other change for the period end, and refuse a second
checkout while a subscription is active or running out. If Stripe sends an invoice the rule
refuses anyway, the webhook must log it for an Operator and not acknowledge it as granted.

**Still open, none blocking implementation start:**

1. ~~Dunning grace period, mid-cycle-cancellation credit handling and the three
   `PERIOD_NOT_NEWER` cases~~ — decided 2026-10-03, above.
2. **Annual price points below the Ultra tier** (Starter/Plus annual) — the recommendation above
   computes Ultra's floor explicitly; Starter and Plus annual rates need the same per-tier net-floor
   check before publishing, not a flat percentage-off assumption.
3. **Does Stripe's written acceptance for Cinema Pass's recurring-plan review (ADR-0057's own open
   "written Stripe acceptance" precondition) cover core Subscriptions too, or is this a separate
   category requiring its own confirmation?** Core generation-credit subscriptions are a more
   central part of the "AI media generation" category ADR-0031 already confirmed Stripe accepts
   in general — plausibly lower risk than Cinema Pass's user-uploaded-video angle — but this
   should be confirmed, not assumed, consistent with this pack's standing discipline.
