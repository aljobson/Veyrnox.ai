# ADR-0006 — Amendment to ADR-0004: EU data residency changes auth-provider math

- **Status**: Accepted (2026-09-10)
- **Deciders**: Product owner
- **Amends**: [ADR-0004 — Auth + Postgres bundle](0004-auth-and-db-bundle.md)
- **Triggered by**: [ADR-0005 §3](0005-phase-0-business-preconditions.md) — EU-only user data

## Context

ADR-0004 accepted **Clerk + Neon** for auth + Postgres on the assumption of Clerk's standard tier ($25/mo base + $0.02/MAU) with US data residency. ADR-0005 then resolved the data-residency precondition as **EU-only for user data**.

Clerk's EU data residency is a distinct add-on, gated behind their **Enterprise tier**, starting around **$100/mo minimum + per-MAU + a data-residency premium** — pricing quoted publicly on their site suggests $250–$400/mo effective floor once EU residency is added. This is a 10× cost jump versus ADR-0004's ~$25/mo assumption.

Supabase Auth, by contrast, lets you pick an EU region on the standard Pro tier ($25/mo) with no residency surcharge. MFA is still DIY there (~3–5 days work), but that's a one-time cost, not a recurring $250–400/mo.

The math flips.

## Options reconsidered

Only two candidates matter now — the ones that support EU residency at a workable price.

### A. Supabase Auth + Supabase Postgres (single vendor, EU region)

- Auth + Postgres + storage bundled at $25/mo Pro tier
- EU region selectable (Frankfurt, Dublin) — no surcharge
- MFA: TOTP API, no first-party UI — build one (est. 3–5 days)
- Row-Level Security pins auth-to-data at the database layer
- Single vendor = single blast radius; single dashboard
- `user_id` is a UUID in `auth.users` — a table we own

### B. Clerk Enterprise (EU residency) + Neon Frankfurt

- Clerk Enterprise minimum ~$100/mo base; EU-residency premium on top — realistic ~$250–400/mo at low MAU, more as usage grows
- MFA + passkeys + session UI out of the box (Clerk's core value)
- Neon Frankfurt at Launch tier $19/mo — fine
- Two vendors, two dashboards

### Fresh factor: **anonymous / free-tier signup pattern**

ADR-0005 confirmed a 50-credit free tier with email signup. Clerk supports this natively (email-only account, no MFA required for free-tier). Supabase Auth also supports email signup and anonymous users. Both fine here.

## Decision drivers (re-ranked given EU-residency constraint)

1. **EU data residency at Phase-1 budget** — must be workable at <$50/mo total for auth
2. **MFA on money-touching accounts** — non-negotiable but can be built
3. **Time-to-Phase-1** — auth+DB must not eat more than 2 of the 6–8 weeks

Cost dominates now. The MFA-UI-gap that killed Supabase in ADR-0004 is a 3–5 day one-time cost; Clerk's EU tier is $250–400/mo forever.

## Recommendation

**Amend to Option A — Supabase Auth + Supabase Postgres (Frankfurt region).**

- Bundle at $25/mo covers auth + Postgres + a small R2-alternative storage (though R2 stays for media per ADR-0000)
- Build MFA on top of Supabase's TOTP API in Phase 4 (before Article 50 launch anyway)
- Save ~$225–375/mo indefinitely
- Row-Level Security is a real security win

**Rejected**: Clerk Enterprise EU. The $250–400/mo floor is disproportionate for a pre-revenue product.

## Consequences

- **Slice 3 (auth) implementation** switches from Clerk SDK to Supabase Auth SDK. Middleware pattern is different but comparable size.
- **Slice 4 (Postgres)** collapses into the same vendor as auth. `scripts/migrate.mjs` targets Supabase's Postgres endpoint. Neon Launch tier no longer needed.
- **RLS policies** written alongside the migrations — every table that references `auth.users(id)` gets a `WHERE user_id = auth.uid()` policy for `SELECT`/`UPDATE`/`DELETE`.
- **MFA becomes a Phase-4 deliverable** with a concrete owner (this project). Track it there.
- **The archived `packages/db/*` code** — no change; the `PgLikePool` interface still applies. Supabase's `Pool` from `postgres.js` or `pg` compatibility layer both satisfy it.
- **Cost impact**: Phase 1 infrastructure floor drops from projected ~$50/mo (Clerk + Neon) to $25/mo (Supabase alone).

## Open questions

- **Neon branching**: ADR-0004 flagged Neon's per-PR preview branching as a DX win. Supabase has no equivalent. Compensate with `supabase db diff` + local Docker-Compose Postgres for feature branches. Not blocking.
- **Auth token verification in Cloudflare Workers**: Supabase JWTs (JWS with a project-scoped signing key) verify fine via `jose` in Workers. Latency comparable to Clerk's JWKS verification.
- **Migration off Supabase later**: if we outgrow it, Supabase → Neon or self-hosted Postgres is a `pg_dump` / `pg_restore` (schema and rows portable). Auth users can be exported via Supabase's admin API. Painful but bounded.
