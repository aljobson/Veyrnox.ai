# Architecture Decision Records

Phase-0 decision-support documents for the target architecture at `/Users/aljobson/Downloads/architecture.md` (external, not committed — sensitive). Each ADR is **Proposed** until the product owner signs off; nothing in Phase 1+ can start until the load-bearing ADRs are Accepted.

## Index

| ADR | Status | Summary | Blocks |
|-----|--------|---------|--------|
| [ADR-0000 — Product strategy: Replacer vs Reseller](0000-product-strategy.md) | **Accepted 2026-09-10 — Option A (Replacer)** | The meta-decision. Product owner picked full-stack rebuild over MuAPI reseller. Timeline 20-24 wk to first paying customer. | — |
| [ADR-0001 — Authentication provider](0001-auth-provider.md) | Superseded by 0004 | Original single-vendor auth ADR. Circular with 0002. | — |
| [ADR-0002 — Postgres host & serverless driver](0002-postgres-host.md) | Superseded by 0004 | Original single-vendor DB ADR. Circular with 0001. | — |
| [ADR-0003 — Billing / merchant-of-record](0003-billing-provider.md) | **Accepted 2026-09-10 — LemonSqueezy at launch** | Migrate to Stripe Direct at ~$20k MRR sustained 3 months. | — |
| [ADR-0004 — Auth + Postgres bundle](0004-auth-and-db-bundle.md) | Amended by 0006 | Original: Clerk + Neon. Superseded by 0006 on EU-residency grounds. | — |
| [ADR-0005 — Phase-0 business preconditions](0005-phase-0-business-preconditions.md) | **Accepted 2026-09-10** | UK Ltd, UK tax, EU-only data, 50-credit free tier, C2PA+ToS Article 50, registered-agent DMCA. | (unblocks Phase 1 Slice 3) |
| [ADR-0006 — Auth + DB amendment for EU residency](0006-auth-and-db-amendment-eu-residency.md) | **Accepted 2026-09-10 — Supabase Auth + Supabase Postgres (Frankfurt)** | Clerk EU-tier at ~$250–400/mo forced re-evaluation; Supabase EU on $25/mo Pro. MFA becomes a Phase-4 deliverable. | Slice 3+ |

## Decision graph

```
ADR-0000 (strategy) ── outcome shapes everything below
   │
   ├── If Reseller/Hybrid → ADR-0004 recommends Clerk + Cloudflare D1
   ├── If Replacer        → ADR-0004 recommends Clerk + Neon
   └── If Status Quo      → no other ADR applies
   │
   └── ADR-0003 (billing) ── independent, needed for any paying-user path
```

## Status lifecycle

`Proposed` → `Accepted` (signed off by product owner) → `Superseded` (only via a follow-up ADR that cites the predecessor). ADRs are append-only after Accepted — never edit in place. Before Accepted, edits are fine; supersession is the honest path once the direction changes.

## Format

Each ADR follows:

1. **Context** — the problem, grounded in specific target-architecture section numbers.
2. **Options considered** — 2–4 real candidates.
3. **Decision drivers** — the criteria that matter, ranked.
4. **Trade-off table** — one row per option, one column per driver.
5. **Recommendation** — engineering's pick and why, in plain terms.
6. **Consequences** — what changes downstream if this option is taken.
7. **Open questions** — anything the recommendation is contingent on.

## Business decision, not engineering

Every ADR here has cost, contract, and vendor-lock-in implications the product owner must weigh. Engineering can execute any of the options; the recommendation is engineering's opinion, not the decision.

## Cross-cutting concerns not yet in any ADR

Flagged for later or standalone treatment:

- **Legal entity** (sole-prop / LLC / Ltd / GmbH) is a precondition to every vendor contract. Ownership decision, not engineering — but every ADR here assumes it exists.
- **Data residency** (GDPR / UK-GDPR / regional laws) drives region and vendor eligibility. Called out in each ADR's open questions; may warrant its own ADR if EU-only data storage is a hard requirement.
- **EU AI Act — Article 50 transparency** applies to AI-generated content regardless of whether Veyrnox holds the model or MuAPI does. Legal input required before Phase 4 moderation work.
- **DMCA / abuse takedown workflow** requires a designated agent and a documented process. Paperwork, not engineering, but blocks public launch.
- **Transactional-layer choice** (Postgres locking vs Durable Object per `user_id` with async persist) may warrant its own ADR-0005 if ledger latency measurements show that Postgres row-locks are the bottleneck under concurrent debit.
