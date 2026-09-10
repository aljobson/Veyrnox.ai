# ADR-0000 — Product strategy: MuAPI-replacer vs MuAPI-reseller

- **Status**: Proposed
- **Date**: 2026-09-10
- **Deciders**: Product owner (sole)
- **Blocks**: Every other ADR. Nothing else can be decided until this is.
- **Related**: architecture.md (whole document — assumes replacer path)

## Context

Veyrnox.ai has two internally consistent product identities, and today the shipped code and the target architecture doc disagree on which one is real.

**Shipped code today** — a hardened Next.js app whose `app/api/*` routes are thin proxies to `https://api.muapi.ai`. Each user pastes their own MuAPI key into `app/api/session/muapi/route.js`, which stores it as an `__Host-muapi_key` HttpOnly cookie. MuAPI is the merchant, holds the customer relationship, runs the credit ledger, hosts the media, moderates content, and takes the margin. Veyrnox is a **UI layer** on top of MuAPI — a "bring-your-own-key" studio.

**Target architecture doc** — a full-fat platform where Veyrnox holds the customer relationship: users sign up on Veyrnox, buy credits from Veyrnox via a merchant-of-record, and Veyrnox routes their generation requests to fal.ai (primary) and Replicate (fallback). Postgres, Inngest, R2, moderation, spend-tracking, margin-floor guards. MuAPI does not appear at all in the target architecture.

These are not two phases of the same product. They are two different products. Their auth, billing, DB, adapter, and ops requirements are largely disjoint.

There is a third option — a **hybrid** where MuAPI stays as one provider in a multi-provider adapter layer, with Veyrnox owning auth + ledger on top. This is not what the doc describes but is the natural extension of the shipped code.

## Options considered

### A. MuAPI-Replacer (target-doc canonical)

Rebuild the whole stack: users, ledger, jobs, adapters, R2, billing, moderation, catalog authority. Direct integrations with fal.ai + Replicate + Stripe/LMS + Clerk/Supabase + DeepSeek. MuAPI removed entirely.

- Scope: ~20–24 weeks solo + AI assist per gap-analysis Phase 1–4.
- Margin: full spread between provider cost (fal.ai list) and retail credit price.
- Customer relationship: Veyrnox.
- Risk: high (10+ vendor relationships, real ledger, real money, real moderation liability, PCI-scope-adjacent even with MoR).
- Reward: real business with defensible margin.

### B. MuAPI-Reseller-with-ledger

Keep MuAPI as the single upstream. Add on top: proper user accounts (not "whoever holds the cookie"), a ledger of debits/credits Veyrnox owns, and a billing layer so Veyrnox can charge users at Veyrnox prices instead of the user paying MuAPI directly with their own key.

- Scope: ~6–8 weeks — auth + DB + billing + ledger-as-thin-adjustment-layer. No adapter development. No R2. Moderation is MuAPI's problem.
- Margin: spread between MuAPI list and Veyrnox retail. Smaller than replacer, but real if MuAPI offers volume pricing (assumption to verify).
- Customer relationship: Veyrnox.
- Risk: medium (single-vendor concentration on MuAPI; if MuAPI dies, so does Veyrnox).
- Reward: real business at much smaller build cost, but ceiling capped by MuAPI's own pricing and reliability.

### C. Hybrid (MuAPI as first-among-providers)

Same as Replacer, except MuAPI is one entry in the provider adapter table, alongside fal.ai and Replicate. Route to whichever provider is cheapest/fastest per model, or fall back to MuAPI when direct-provider integrations aren't yet built.

- Scope: ~10–14 weeks — replacer scope minus the "must have every provider integrated on day one" pressure. MuAPI covers the long tail.
- Margin: mixed — direct on integrated models, thin on MuAPI-fronted models.
- Customer relationship: Veyrnox.
- Risk: medium (still 10+ vendors, but MuAPI is a safety net that reduces per-model integration urgency).
- Reward: closest to replacer, faster to launch, credible path off MuAPI over time.

### D. Bring-your-own-key (status quo)

Do nothing about business layer. Keep the cookie-based BYOK model. Veyrnox is a free open-source UI for MuAPI users.

- Scope: zero.
- Margin: zero (or affiliate cut if MuAPI has a referral program — verify).
- Customer relationship: MuAPI, not Veyrnox.
- Risk: none technical; product-market question is whether the audience is large enough to matter.
- Reward: hobbyist project without revenue potential.

## Decision drivers (ranked)

1. **Do we want to be a business, or a portfolio piece?** — every other question hangs on this.
2. **Capital and time available** — solo team + AI assist has finite output.
3. **MuAPI counterparty risk** — is MuAPI's business stable? Its pricing predictable? Its uptime acceptable?
4. **Provider integration capacity** — can we realistically wire fal.ai + Replicate + moderation + billing well, or will half the integrations be brittle?
5. **Time to first paying customer** — the sooner we validate that anyone pays, the sooner we know the product is real.
6. **Ceiling** — Option B has a ceiling set by MuAPI's own pricing and reliability. Option A has no ceiling but a higher floor.
7. **Reversibility** — Reseller can migrate to Hybrid can migrate to Replacer. The reverse is much harder.

## Trade-off table

| Driver / Option | A. Replacer | B. Reseller | C. Hybrid | D. Status quo |
|---|---|---|---|---|
| Time to launch | 20–24 wk | 6–8 wk | 10–14 wk | 0 |
| Vendor count | 10+ | 4–5 | 8+ | 1 |
| MuAPI dependency | None | Total | Partial | Total |
| Margin potential | Highest | Bounded by MuAPI wholesale terms | Mixed | Zero |
| Moderation liability | You | MuAPI | You (for non-MuAPI providers) | MuAPI |
| Compliance surface | Large (GDPR + AI Act + DMCA + tax) | Medium (GDPR + billing tax) | Large | Small |
| Reversibility | N/A | Easy to escalate | Easy to slide either way | Easy |
| Fits shipped code | No — rewrite | Yes — extend | Partial — extend + integrate | Yes |
| Product-owner risk profile | Big-bet | Cautious | Balanced | Hobby |

## Recommendation

**Option C — Hybrid**, entered via **Option B — Reseller** as the first milestone.

Reasoning:

- The shipped code and 10 audit rounds are real assets. Replacer throws them away for a rewrite. Reseller preserves them.
- Reseller (~6–8 weeks) gets to a paying customer 3–4× faster than Replacer (~20–24 weeks). Time-to-revenue is the highest-value information the product will produce.
- Once paying customers exist, Hybrid lets Veyrnox harvest margin on the highest-volume models by integrating fal.ai directly while MuAPI carries the tail. That's a *conditional* investment triggered by revenue, not an up-front bet.
- The Replacer path is still open from Hybrid — just add more direct integrations until MuAPI is a rounding error. The reverse is not: once you've thrown away the MuAPI proxy layer, you don't get it back cheaply.
- Reject D (status quo) unless the product owner explicitly wants a hobby project. Reject A (replacer) as too much up-front risk for a team of this size before validating that anyone pays.

**Sequence**:

1. **Reseller (6–8 weeks)** — auth + DB + billing + ledger + MuAPI as sole upstream. Launch. Discover whether people pay.
2. **Direct integration of the top revenue model (4 weeks)** — whichever single model is generating the most revenue. Adapter, moderation gate, margin-floor check. Now Hybrid.
3. **Iterate** — each subsequent direct integration is a business case: "does this model's volume × margin gain justify the integration cost?" Some models never justify direct — they stay on MuAPI forever.

## Consequences

If Option C via B is accepted:

- **ADR-0001 (auth) and ADR-0002 (Postgres) shrink** — reseller scope needs both but the choice pressure is lower. Bundle them (see revised ADR-0004).
- **ADR-0003 (billing) is unchanged** — needed identically for reseller and replacer.
- **The archived `packages/db/*` code (Ledger, JobState) is directly reusable** for reseller. The `packages/adapters/*` code becomes relevant only at the Hybrid milestone.
- **MuAPI wholesale/reseller pricing must be confirmed** — if MuAPI charges retail regardless of channel, Reseller has no margin and B is dead. Business precondition.
- **Moderation stays MuAPI's problem** at Reseller stage. Article 50 (EU AI Act) transparency obligation still applies to Veyrnox because we hold the customer relationship, but the moderation implementation is upstream. Confirm with legal counsel.
- **DMCA/abuse takedown** likewise upstream at Reseller; must be documented in Veyrnox ToS as "we forward to upstream provider."

If Option A (Replacer) accepted anyway:

- Every ADR reverts to the version already drafted.
- Timeline slips to 20–24 weeks before first customer.
- 10+ vendor relationships to onboard.

## Open questions (product owner)

- **Is there wholesale MuAPI pricing?** Confirm before accepting B/C. Without it, Reseller has no margin.
- **Does MuAPI's ToS permit reselling?** Some providers restrict this. Read the ToS.
- **Product-owner risk profile** — is the goal a real business (accept some level of A or C) or a validated side project (B is enough)?
- **Legal entity** — sole-prop / LLC / Ltd / GmbH — is a precondition to signing any billing/auth/DB vendor contract. What entity is Veyrnox?
- **Product-owner tax residency** — determines merchant-of-record eligibility (LMS/Paddle both restrict which jurisdictions they will onboard).
- **Data residency** — do we target EU users, and if so is data-in-EU a hard requirement? Drives DB region and vendor.
- **EU AI Act Article 50** — transparency requirements for AI-generated content. Applies whether we hold the model or MuAPI does. Legal input needed.
- **DMCA takedown workflow** — even in reseller mode, receiving takedown notices at the Veyrnox domain requires a designated agent. This is filing paperwork, not engineering.
- **What is the pricing hypothesis?** — until there is a price, "reseller margin" is a placeholder.
