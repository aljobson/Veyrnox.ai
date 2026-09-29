# ADR-0063 — Veyrnox Publish Plan: tiers, prices, and connected-account caps

- **Status**: **Accepted 2026-09-28.** Product owner approved the recommended numbers
  (Free: 1 account, unlimited posts fair-use bounded; Publish Plan: $19/mo, 5 accounts,
  $4/account add-on) and confirmed monthly-only billing for v1, annual as a fast-follow,
  both as proposed, no changes. Fills in the pricing ADR-0062 deliberately left open
  ("Exact plan tiers, prices, connected-account/brand caps per tier — a pricing decision
  for the product owner").
- **Date**: 2026-09-28
- **Deciders**: Product owner (sole) — accepted
- **Related**: [ADR-0062 — Veyrnox Publish entitlement model](0062-veyrnox-publish-entitlement-model.md)
  (fixed the *mechanism* — independent recurring Publish Plan, never the ledger — this ADR
  fixes the *numbers*), [ADR-0061 — Veyrnox Publish](0061-veyrnox-publish-social-scheduling.md)
  (v1 platform scope: Instagram, X, TikTok, LinkedIn, YouTube), [ADR-0057 — Cinema Pass](0057-cinema-viewer-paywall.md)
  (pricing/refund mechanics this Plan reuses), `docs/pricing/metricool-buffer-pricing-2026-09-28.md`
  (the source data this ADR is built on).

## Context

ADR-0062 decided Publish is billed as an independent recurring "Publish Plan," never touching
the credit ledger, and approved a free-tier *direction* (one account, one network) without
fixing the free-tier limit, paid-tier prices, or connected-account caps — those were explicitly
deferred here.

Unlike ADR-0061's refusal to reproduce Metricool's specific pricing "without a confirmed
source," this ADR **does** have confirmed sources: Metricool's and Buffer's own public
`/pricing` pages were read directly (live, 2026-09-28, USD, monthly and annual toggles both
captured) — see `docs/pricing/metricool-buffer-pricing-2026-09-28.md` for the full capture.
Both companies use materially different pricing *axes*, which matters for the decision below:

**Metricool — tiered by number of brands (profiles), USD monthly:**

| Plan | Monthly | Annual (per mo) | Brands | Notable gates |
|---|---:|---:|---:|---|
| Free | $0 | $0 | 1 | 20 posts/mo cap, no LinkedIn/X, 5 competitors, 30-day analytics |
| Starter | $25 (5 brands) / $45 (10) | $20 / $36 | 5 or 10 | Unlimited posts*, 100 competitors, X + Advanced Analytics add-ons, LinkedIn, Flows, multi link-in-bio |
| Advanced | $67 / $107 / $210 (15/25/50) | $53 / $85 / $159 | 15, 25 or 50 | Team/roles, approval system, full X analytics, Looker Studio, API |
| Custom | Contact us | — | Custom | White label, dedicated account manager |

**Buffer — priced per connected channel, not per brand, USD monthly:**

| Plan | Price | What it covers |
|---|---:|---|
| Free | $0 | 3 channels, 10 scheduled posts/channel |
| Essentials | $5/channel/mo | Unlimited posts/channel (5,000-post fair-use ceiling), advanced analytics, API |
| Team | $10/channel/mo | + unlimited team members, approval workflows |

Buffer's own FAQ is explicit about why: *"you pay per channel rather than per brand or per
client — so a portfolio of 30 accounts costs the same whether it's one brand or 15."* Buffer
also uses volume discounts above 10 channels rather than discrete tier jumps.

Both companies land in the same rough band for a "manage ~5 accounts" workload: Metricool
Starter at $25/mo (5 brands, all networks), Buffer Essentials at $25/mo (5 channels × $5).
That convergence, from two different pricing axes, is a useful anchor.

**What Veyrnox is pricing is narrower than either competitor's full v1 feature set.** ADR-0061
scopes v1 to composer, calendar, scheduling engine, best-time-to-post, and basic analytics —
no approval workflow, no competitor tracking, no SmartLinks, no unified inbox (all Phase 2/3).
Pricing a full Metricool-style 4-tier ladder now would price features Veyrnox doesn't have yet.

## Options considered

### A — Two tiers for v1: Free + one paid "Publish Plan" (recommended)
One free tier (adoption-focused, per ADR-0062's approved direction) and one paid tier priced
for the "manage your v1 platforms" workload, with a simple per-account add-on for going beyond
it. Grows into more tiers only when Phase 2/3 features exist to justify them.

### B — Copy Metricool's 4-tier ladder now
Free / Starter / Advanced / Custom, priced against features (approval system, competitor
tracking, Looker Studio connector) that don't exist in v1. Rejected: sells vaporware tiers,
adds billing-UI complexity for gates that don't gate anything yet, and — per ADR-0061's own
"copy the behavior contract, not the exact numbers" discipline — there's no reason to match a
competitor's tier *count* just because their feature set eventually grew into four tiers.

### C — Copy Buffer's pure per-channel pricing
No tiers at all, a flat per-connected-account rate from account #1. Rejected for v1: removes
the free-tier adoption wedge ADR-0062 explicitly approved (one account, one network, free) —
Buffer's free tier exists but its paid pricing starts charging immediately past 3 channels with
no discrete "starter" band, which doesn't fit the free→paid on-ramp Veyrnox's own decision
already committed to.

### D — Flat single price, no tiers, no caps
One price, unlimited accounts. Rejected: removes the anti-abuse lever (connected-account caps)
that was one of ADR-0062's own decision drivers (§"Anti-abuse, not cost-recovery") — a
scheduling tool with zero marginal cost per post still has a real cost if a single account
connects hundreds of platform accounts and hits rate limits or abuses a platform's OAuth app
standing (ADR-0061 §2.11 risk).

## Decision drivers (ranked)

1. **Price to the workload Veyrnox actually ships in v1**, not to features that don't exist —
   avoids Option B's vaporware-tier problem.
2. **Preserve the free-tier adoption wedge** ADR-0062 already approved — the Generate→Schedule
   differentiator only compounds if users experience it before paying.
3. **Land near the real competitive anchor** ($20–25/mo for a ~5-account workload, confirmed
   from both Metricool and Buffer's live pricing) rather than guessing at what "feels right."
4. **Keep the account-cap as an anti-abuse lever, not a paywall on value** — the cap should be
   generous enough that a genuine solo creator on the free tier plus one paid seat rarely hits
   it, while still bounding a compromised account's platform-API blast radius.
5. **Minimize billing-engineering surface for v1** — a two-tier model with one add-on SKU is
   simpler to build correctly than a four-tier ladder, and this repo's Stripe integration
   history (ADR-0031, ADR-0033) shows every additional billing surface is its own source of
   edge cases.

## Trade-off table

| | A. Two tiers + add-on | B. Copy Metricool's 4 tiers | C. Buffer-style pure per-channel | D. Flat, no caps |
|---|---|---|---|---|
| Prices only what v1 ships | Yes | No — prices Phase 2/3 features | Partial | Yes |
| Preserves free adoption wedge | Yes | Yes | Weaker (free tier exists but no starter band) | N/A |
| Grounded in real competitor data | Yes | Yes | Yes | No |
| Billing engineering surface | Smallest viable | Largest | Small | Smallest, but no anti-abuse lever |
| Anti-abuse lever | Yes (cap + add-on) | Yes | Yes (linear cost) | No |
| Room to grow into Phase 2/3 pricing later | Yes — add a tier when features ship | Already spent the ladder | Yes | Weak — no tier structure to extend |

## Recommendation

**Accepted 2026-09-28: Option A**, with no changes from the product owner. Concretely, for v1:

- **Free — "Starter" (no paid plan required).** One connected account, any single one of the
  five v1 networks (Instagram, X, TikTok, LinkedIn, YouTube). **Unlimited scheduled posts,
  fair-use bounded** (not a hard monthly post cap like Metricool's 20/month free tier) — a
  generous free tier maximizes the number of users who actually experience Generate→Schedule,
  which is the product's whole reason to exist (ADR-0061 §1.1), and the real anti-abuse lever
  is the account cap, not an artificial post ceiling. 30-day analytics history, matching both
  competitors' free-tier norm.
- **Publish Plan — $19/month, or $15/month billed annually (≈21% off, matching the ~20–24%
  range both competitors offer).** Up to **5 connected accounts** — the natural "one of each v1
  network" unit. Unlimited scheduled posts (fair-use bounded), full analytics history, best
  time to post. This lands *below* Metricool's Starter ($25/mo monthly, $20/mo annual for the
  same 5-account band) and roughly matches Buffer's Essentials-for-5-channels ($25/mo) —
  positioned as price-competitive without being a race-to-the-bottom signal, on the premise
  that Generate→Schedule is the actual differentiator, not undercutting on price alone.
- **Additional accounts beyond 5: a flat $4/account/month add-on**, roughly Buffer's per-channel
  marginal rate ($5/channel Essentials, discounted here since it's an add-on to an existing
  paid plan rather than Buffer's from-account-one pricing). This covers the agency/multi-brand
  persona (product spec §1.4) without inventing a whole new discrete tier before Phase 2
  features (approval workflow, competitor tracking) exist to justify one.
- **No third tier for v1.** When Phase 2/3 ships (approval workflow, competitor tracking,
  SmartLinks), revisit whether those gate a new "Publish Pro" tier or simply raise the existing
  Publish Plan's price — a smaller, later decision, not blocking v1 launch.
- **Monthly billing only for v1; annual billing is a fast-follow, not launch-blocking.**
  Simplifies the first Stripe Checkout integration (subscription mode with inline recurring
  `price_data`, per ADR-0062) to one price point instead of two, consistent with "minimize
  billing-engineering surface for v1" above. The $15/mo annual figure above is the *target* rate
  to build toward, not a v1 commitment.

## Consequences

- `social_publish_plans` (ADR-0062's schema) gets exactly one paid row for v1: Publish Plan,
  $19/mo, 5-account cap, plus the add-on SKU for extra accounts. The free tier needs no plan
  row at all — it's simply the default state of a brand with no active `social_publish_subscriptions`
  row, capped at 1 account in application logic.
- The account-cap enforcement (free: 1, Publish Plan: 5 + add-ons) is a straightforward
  `COUNT(social_accounts) <= cap` check at connect-time, no new infrastructure beyond what
  ADR-0062's tables already specify.
- Add-on billing (extra accounts beyond 5) needs Stripe subscription item quantity handling —
  confirm this is compatible with the inline `price_data` pattern ADR-0062 specifies, or whether
  add-on seats need an actual Stripe Price object (a small implementation detail to resolve
  during build, not a reason to revisit this ADR's numbers).
- `CONTEXT.md` gains a **Publish Plan** price point ($19/mo, 5 accounts) alongside the glossary
  entry ADR-0062 already specified.
- Marketing/pricing-page copy can state Veyrnox Publish's price with confidence once Accepted,
  without the "no invented numbers" caveat that applied before this ADR existed.

## Open questions

**Resolved at acceptance (2026-09-28):** the actual numbers ($19/mo, 5-account cap, $4/account
add-on, $15/mo annual target) and monthly-only billing for v1 (annual as a fast-follow) were both
approved as proposed by the product owner.

**Still open, none blocking implementation start:**

1. **VAT/tax handling** — Metricool's pricing explicitly excludes VAT ("calculated before
   signing"); confirm Publish Plan pricing follows the same Stripe Managed Payments automatic-tax
   pattern already established for Top-ups (ADR-0031) rather than needing separate tax logic.
2. **Nonprofit/education discount** — Buffer offers 50% off for nonprofits; not recommended for
   v1 (adds verification/eligibility-checking scope Veyrnox doesn't have infrastructure for yet),
   but worth a deliberate "not yet" rather than silence.
3. **Does the $4/account add-on need its own fair-use ceiling** (e.g., a max total accounts per
   brand) to bound the same anti-abuse risk the base cap addresses, or is linear per-account
   billing itself a sufficient economic deterrent? Recommend deferring to implementation with a
   conservative default (e.g., 50 accounts total) rather than leaving it fully unbounded.
