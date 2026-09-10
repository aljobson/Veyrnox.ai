# ADR-0001 — Authentication provider

- **Status**: Superseded by [ADR-0004](004-auth-and-db-bundle.md)
- **Date**: 2026-09-10
- **Deciders**: Product owner (approver), Architect, Security reviewer
- **Blocks**: ADR-0002 (Postgres host — Supabase bundles auth so the choice collapses), all Phase 1 work
- **Related**: architecture.md §9.2, §11.2, §14

> **Superseded by [ADR-0004 — Auth + Postgres bundle](0004-auth-and-db-bundle.md).**
> The original ADR-0001 and ADR-0002 were circular — each recommended a choice contingent on the other. ADR-0004 is the honest, bundled form of that decision and adds Cloudflare D1, MFA-day-one, and anonymous-signup considerations that were missing here. This file is kept for history; do not act on its recommendation.

## Context

Veyrnox today has no user model of its own. `app/api/session/muapi/route.js` sets an `__Host-muapi_key` HttpOnly cookie that carries the user's own MuAPI vendor key; the "user" is just whoever holds that cookie in their browser. There is no `users` table, no login, no MFA, no session revocation, no admin.

The target architecture (§9.2, §11.2) requires a real identity layer — email/password + OAuth, MFA, JWT-based session, admin ban/refund tooling, and a stable `user_id` foreign key that the ledger (§25.3) can debit against.

An identity provider is a **lock-in** — the `user_id` values it mints end up on every ledger row, every job, every media asset. Migrating providers later means either re-authenticating every user against the new one or keeping the old one running for identifier resolution. The choice needs to survive years.

## Options considered

### A. Clerk

Hosted IdP, developer-friendly SDK, strong React/Next.js integration, MFA, passkeys, org support, session UI components. First-party Cloudflare Workers support via `@clerk/backend`.

- Free tier: 10k MAU
- Paid: $25/mo base + $0.02/MAU beyond free tier + $0.05/MAU for MFA/advanced features
- User data lives in Clerk; can be exported

### B. Supabase Auth

Auth is bundled with the Postgres it also hosts. GoTrue-based JWT, OAuth, magic links, no built-in MFA UI (must implement). Row-Level Security integrates directly with Postgres queries.

- Free tier: 50k MAU
- Paid: $25/mo base includes Postgres + auth + storage
- If chosen, ADR-0002 collapses — same vendor
- User data lives in `auth.users` Postgres table you own

### C. WorkOS

Enterprise-flavour IdP — SAML/SSO, directory sync, more expensive per-seat but strong for B2B. AuthKit provides hosted UI similar to Clerk.

- Free tier: 1M MAU on AuthKit alone (SSO/directory extra)
- SSO: $125/connection/mo starting
- Overkill for a B2C credit-metered product

### D. Roll your own on Postgres

`bcrypt` + `jsonwebtoken` + Redis session store. Full ownership, zero vendor cost, but MFA, OAuth, password reset, session revocation, breach detection, credential stuffing defence all become your problem.

- Real cost: 2–3 weeks up front + ongoing security burden
- Correct answer for a bank, wrong answer for a small team on a generation product

## Decision drivers (ranked)

1. **Time-to-Phase-1** — the money spine cannot start without user identifiers. Slower auth = slower revenue.
2. **Security surface** — auth is where breaches happen. Hosted providers ship 24/7 anti-abuse infrastructure a solo team cannot match.
3. **Vendor lock-in on `user_id`** — every downstream row references it. Exportability matters.
4. **B2C fit** — email + Google + Apple + passkeys. Not SAML.
5. **Cost at 10k users** — modest scale target.
6. **Cloudflare Workers compatibility** — the app runs on Workers via OpenNext.

## Trade-off table

| Driver / Option | A. Clerk | B. Supabase Auth | C. WorkOS | D. Self-hosted |
|---|---|---|---|---|
| Time-to-Phase-1 | ~1 day integration | ~1 day (if Postgres also Supabase) | ~2 days | ~2–3 weeks |
| Security surface | Best-in-class | Solid, no built-in MFA UI | Enterprise-grade | On you |
| Lock-in on `user_id` | Clerk-issued IDs | Postgres `auth.users.id` — you own the row | WorkOS IDs | You own everything |
| B2C fit | Excellent | Good | Poor (enterprise-flavour) | Depends on effort |
| Cost @ 10k MAU | ~$0 (free tier), then $25–$50/mo | $25/mo (bundled) | $0 (free tier), $125+/mo with SSO | Server-time only |
| Workers compat | First-party | REST/JWT, works fine | REST/JWT, works fine | Yes (Redis dependency) |
| MFA out of the box | Yes | No — build it | Yes | Build it |
| Data portability | Export API | You own the DB row | Export API | Complete |

## Recommendation

**Option B — Supabase Auth**, contingent on ADR-0002 also picking Supabase for Postgres.

Reasons:

- Collapses ADR-0002 into a single vendor decision (auth + Postgres + storage + realtime, one billing relationship, one dashboard).
- `user_id` is a plain `uuid` in a table Veyrnox owns — no external ID that becomes a hostage.
- Row-Level Security means the ledger can pin every read/write to the authenticated user at the database layer, not just the application. That is a real security win worth the missing MFA UI (MFA can be added later via the TOTP API — non-trivial, but not blocking).
- $25/mo covers Phase 1's infrastructure entirely.
- If Supabase becomes wrong later, migration is: dump `auth.users`, re-hash passwords or force reset, import into Clerk. Painful but bounded.

**Fallback** if Supabase's realtime/storage features are unwanted noise: **Option A — Clerk** with Neon for Postgres (ADR-0002 chooses Neon). Costs marginally more per month but keeps the auth layer as a first-party, best-in-class product with MFA out of the box.

**Reject**: WorkOS (wrong shape for B2C), self-hosted (wrong shape for a small team).

## Consequences

If Option B accepted:
- ADR-0002 must choose Supabase.
- Every user table (`users`, `subscriptions`, `ledger_entries`) has a FK to `auth.users(id)`.
- MFA implementation is a Phase-4 deliverable (§25.6 abuse controls).
- The existing `__Host-muapi_key` cookie flow is removed — hard cutover for the ~small population of technical users who pasted their own MuAPI keys. Retain the cookie route as an alias for 30 days with a redirect and a "your session moved to a real login" banner.

If Option A accepted:
- ADR-0002 stays open with Neon as the leading candidate.
- MFA lands with auth on day one.
- Two vendors (Clerk + Neon) to monitor instead of one.

## Open questions

- How many existing cookie holders are there today? If small (<100), silent cutover is fine. If material, dual-run for 30 days.
- Do we ever need SAML for enterprise? If a "sell to a company" path is on the 12-month roadmap, WorkOS reappears — but only then.
- Is the free-tier signup a real signup or an anonymous "try before you pay" flow? If the latter, we need anonymous users backed by a Turnstile-gated cookie, which is a different design than either Clerk or Supabase provides out of the box.
