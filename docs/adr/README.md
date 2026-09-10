# Architecture Decision Records

This directory holds the ADRs that gate Phase 0 of the target architecture
(see `/Users/aljobson/Downloads/architecture.md`). Each ADR is a
decision-support document — Proposed, not Accepted — that presents
options, trade-offs, and a recommendation for the human decision-maker.

Nothing in Phase 1+ (money spine, billing, provider adapters, R2, studio
migration) can start until the three Phase-0 ADRs are Accepted.

## Index

| ADR | Status | Blocks |
|-----|--------|--------|
| [ADR-0001 — Authentication provider](0001-auth-provider.md) | Proposed | ADR-0003, all of Phase 1 |
| [ADR-0002 — Postgres host & serverless driver](0002-postgres-host.md) | Proposed | ADR-0001 outcome may collapse this | 
| [ADR-0003 — Billing / merchant-of-record](0003-billing-provider.md) | Proposed | Phase 2 |

## Status lifecycle

`Proposed` → `Accepted` (signed off by product owner) → `Superseded` (only via a follow-up ADR that cites the predecessor). ADRs are append-only — never edit in place after Accepted.

## Format

Each ADR follows:

1. **Context** — the problem in one paragraph, grounded in the target architecture doc's section numbers.
2. **Options considered** — 2–4 real candidates.
3. **Decision drivers** — the criteria that matter, ranked.
4. **Trade-off table** — one row per option, one column per driver.
5. **Recommendation** — my pick and why, in plain terms.
6. **Consequences** — what changes downstream if this option is taken.
7. **Open questions** — anything the recommendation is contingent on.

## Business decision, not engineering

Every ADR here has cost, contract, and vendor-lock-in implications the product owner must weigh. Engineering can execute any of the options; the recommendation is engineering's opinion, not the decision.
