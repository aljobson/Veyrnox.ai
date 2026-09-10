# ADR-0004 — Auth + Postgres bundle

- **Status**: Proposed
- **Date**: 2026-09-10
- **Deciders**: Product owner (approver), Architect, Security reviewer
- **Depends on**: ADR-0000 (product strategy). If B (Reseller) accepted, scope is smaller than if A (Replacer) accepted.
- **Supersedes**: ADR-0001 (auth alone) and ADR-0002 (DB alone) — those were circular; this bundle is the honest form of the decision.
- **Related**: architecture.md §9.2, §10, §11.2, §25.3

## Context

Authentication and the primary datastore are coupled. Every real user has a `user_id`, that ID is a foreign key on every ledger, subscription, job, and asset row, and it is issued by the auth provider. If auth and DB are the same vendor, the `user_id` is a plain Postgres column you own. If they are separate, it is an external identifier and the auth vendor holds the customer relationship.

Additionally, this app runs on Cloudflare Workers via OpenNext. Workers cannot hold long-lived TCP connections to Postgres — they need an HTTP-based driver or a connection pooler in front. That constrains DB options.

Two constraints from ADR-0000:

- **If Option B (Reseller)** is chosen, the DB and auth are small: `users`, `credit_balances`, `ledger_entries`, `subscriptions`, `webhook_events`. That's it. Volume is modest.
- **If Option A (Replacer)** is chosen, add `jobs`, `assets`, `model_catalog`, plus much heavier write load from every generation. Volume grows fast.

The MFA-on-day-one requirement is non-negotiable for a product that debits real money; that eliminates any option where MFA is "build it yourself later".

## Options considered

### A. Supabase (Auth + Postgres bundled)

Single vendor for auth, Postgres, storage, realtime. Postgres 15 with RLS. HTTP driver via `@supabase/supabase-js` + connection-pooled Postgres via Supavisor.

- Free: 500 MB DB, 50k MAU, 1 GB storage
- Pro: $25/mo — 8 GB DB, PITR (7-day), 100 GB storage
- **MFA**: TOTP via API; **no first-party MFA UI** — you build the enrolment/verification flow. Blocking for money product without extra work.
- Passkeys: WebAuthn API supported; UI is DIY
- Anonymous users: supported (temporary account, upgrade path to real account)
- Region: choose one; EU (Frankfurt/Dublin), US, Asia
- Blast radius: single vendor outage = auth + data both down

### B. Clerk + Neon

Separate vendors: Clerk for auth (best-in-class UI, MFA, passkeys, session UI), Neon for Postgres (purpose-built for serverless, HTTP driver, per-branch preview DBs).

- Clerk free: 10k MAU (basic); paid $25/mo base + $0.02/MAU
- Neon Launch: $19/mo — 10 GB, 5 branches, PITR (7-day)
- Combined baseline: ~$25–$50/mo at Phase-1 scale
- **MFA**: Clerk ships MFA UI, passkeys, WebAuthn — zero UI work
- Anonymous users: not native (Clerk requires an identity); would need a "guest" pattern
- Region: Clerk US-primary with EU support; Neon multi-region
- Blast radius: split — Clerk outage takes auth, Neon outage takes data
- Neon branching: ephemeral money-database per PR is a real DX win

### C. Cloudflare Access + Cloudflare D1

Same-runtime end-to-end. Cloudflare Access (Zero Trust) for auth via email OTP or IdP federation. D1 as the SQLite-on-the-edge datastore.

- Cost: Cloudflare Access free up to 50 users on Zero Trust free plan, then $3/user/mo (not viable for B2C)
- D1: free tier generous; billed on rows read/written
- **MFA**: Cloudflare Access supports it via IdP; Access itself is designed for B2B/employee auth, not B2C consumer signup
- D1 recently added PITR
- Latency: zero — same runtime as the app
- Blast radius: Cloudflare is already the deploy target. If Cloudflare is down, the whole product is down anyway.
- **Blocking issue**: Cloudflare Access is the wrong product for B2C signup. It's meant to gate internal apps behind SSO. Rejected on shape, not merit.
- **Alternative**: keep D1 as the datastore, pair with Clerk or Supabase Auth. Considered as B'.

### B'. Clerk + Cloudflare D1

Clerk for auth (as B), D1 for datastore (same-runtime, SQLite semantics, native binding in `wrangler.jsonc`).

- Cost: Clerk $25+/mo, D1 free tier ~generous, then usage-based
- **MFA**: Clerk (yes)
- D1 concurrency semantics: SQLite writes are serialised per DB — good for ledger (no lock contention within a single database), but limits horizontal write throughput
- PITR: D1 added Time Travel (30-day point-in-time restore) in 2024
- **Trade**: D1's schema is limited to SQLite features — no `pg_advisory_lock`, no `LISTEN/NOTIFY`, no `SELECT FOR UPDATE` semantics (SQLite serialises writes globally instead). The ledger design must be shaped around SQLite, not Postgres.
- Fits Reseller (Option B) trivially — data volume is small
- May not fit Replacer (Option A) at large scale — SQLite's single-writer per DB is a known ceiling

### D. Self-hosted on Fly Postgres + roll-your-own auth on top

Full ownership. Full effort. Rejected up-front — MFA + OAuth + credential-stuffing defence + session revocation is 2–3 weeks of work every solo team gets wrong the first time.

## Decision drivers (ranked)

1. **MFA out of the box** — non-negotiable for money.
2. **Time-to-Phase-1** — Reseller (ADR-0000 option B) targets 6–8 weeks total. Auth+DB must not eat more than 2 of them.
3. **Serverless-driver quality on Cloudflare Workers** — no persistent TCP.
4. **Blast radius** — single vendor vs split.
5. **Reversibility** — a wrong choice must be migratable.
6. **Ops burden** — solo team.
7. **Cost at Phase-1 scale** — modest.
8. **Data residency** — EU/UK targeting possible.

## Trade-off table

| Driver / Option | A. Supabase | B. Clerk + Neon | B'. Clerk + D1 | C. Same-runtime (rejected) | D. Self-hosted (rejected) |
|---|---|---|---|---|---|
| MFA out of the box | No — build TOTP UI | Yes | Yes (Clerk) | Depends | No |
| Time to Phase 1 auth+DB | ~1–2 days | ~1–2 days | ~1 day (D1 binding native) | N/A | ~2–3 weeks |
| Workers driver | Supavisor HTTP | Neon HTTP native | D1 native binding | N/A | Bring your own |
| Blast radius | 1 vendor | 2 vendors | 1 vendor (Cloudflare-only DB) + Clerk | 1 | 1 (you) |
| Reversibility | Export DB, migrate auth | Dump each independently | D1 export standard SQLite | N/A | Full |
| Ops burden | Low | Low | Lowest (native binding) | Low | High |
| Cost @ Phase 1 | $25/mo | $25–$50/mo | $25/mo (Clerk) + D1 free tier | N/A | Server-time |
| Data residency | Region-selected | Neon region-selected; Clerk US-primary | D1 replicates globally, primary region selectable | N/A | Where you put it |
| Anonymous users | Native | Guest pattern needed | Guest pattern needed | N/A | Roll your own |
| Postgres feature parity | Full | Full | SQLite subset — ledger schema must adapt | N/A | Full |
| Suits Reseller (ADR-0000 B) | Yes | Yes | Yes — best fit | N/A | Yes |
| Suits Replacer (ADR-0000 A) | Yes | Yes | Concurrency ceiling risk | N/A | Yes |

## Recommendation

**Option B' — Clerk + Cloudflare D1**, if ADR-0000 accepts Reseller (B) or Hybrid (C).

Reasoning:

- Reseller scope is small enough that SQLite semantics are not limiting. Ledger writes serialise per-DB, which for our volume is a feature (no lock contention) not a bug.
- D1 is a native `wrangler.jsonc` binding — no external Postgres over HTTP, no pooler, no cold-start driver. Lowest possible operational surface.
- D1 recently added Time Travel (30-day PITR) — the money-data requirement is met.
- Clerk covers MFA on day one, passkeys, session UI, OAuth. Every hour spent building auth UI is an hour not spent on the ledger.
- If Replacer is chosen later and D1's SQLite ceiling becomes a real problem, migration to Neon is a schema-compatible export/import (SQLite → Postgres has well-worn tools). Escape is bounded.
- The Clerk + D1 combination is $25/mo total at Phase-1 scale.

**If ADR-0000 accepts Replacer (A)**: switch this recommendation to **Option B — Clerk + Neon**. Postgres feature parity + branching become worth their cost as generation volume grows; the SQLite ceiling would bite within 12 months.

**If ADR-0000 accepts Status Quo (D)**: this ADR does not apply — no auth or DB needed.

**Reject Option A (Supabase)** on MFA — the "build your own TOTP UI" gap is 3–5 days of work at a moment when we cannot spare it. Supabase would be a strong pick if MFA-UI shipped natively; monitor for that change.

**Reject Option C (Cloudflare Access for auth)** — wrong product shape for B2C.

**Reject Option D (self-hosted auth)** — wrong for a solo team.

## Consequences

If B' (Clerk + D1):
- `packages/db/*` archived code (which was written for D1 originally, per WEEK_1.md) is directly reusable with minor changes.
- `wrangler.jsonc` gets a `d1_databases` binding for `veyrnox-primary`.
- Clerk webhook consumer creates a corresponding D1 `users` row on signup. That handler is the seam between the two vendors.
- Schema migrations go via `wrangler d1 migrations`. Version them in `migrations/*.sql`.
- Preview environments: D1 doesn't have Neon-style branching. Use a separate D1 DB per environment (dev/staging/prod) and seed scripts.
- Row-level auth pinning: every D1 query filters by `user_id` from the Clerk-issued JWT verified in a middleware. No RLS — this is application-layer enforcement, must be uniform.

If B (Clerk + Neon):
- `packages/db/*` needs the D1 driver replaced with the Neon serverless driver. ~2 days of porting.
- Neon per-PR branching for previews. Real DX win.
- Two vendors, two dashboards, two outage surfaces.

If A (Supabase):
- Add ~5 days for MFA UI before Phase 1 can complete.
- Single vendor. Simpler ops. Larger blast radius.
- RLS lets us pin auth to data at the DB layer — real security win worth the MFA gap.

## Open questions

- **Confirm D1 Time Travel guarantees** — 30-day retention, granularity of restore, tested restore drill. Verify against current docs before accepting.
- **Cloudflare Workers + Clerk JWT verification cost** — each request verifies a JWKS-cached key. Latency should be <1ms per request; measure in a spike.
- **Anonymous / guest signup** — Reseller path may want "try 3 free generations before signup." Neither Clerk nor Supabase natively supports anonymous-then-upgrade cleanly. Design the ledger to accept a `guest_session_id` in place of `user_id`, upgraded on real signup.
- **EU data residency** — Clerk is US-primary with EU support (extra cost). D1 replicates globally; primary region can be selected. If EU-only data storage is required, Clerk EU tier is needed and D1's primary region must be Frankfurt.
- **Passkey adoption** — Clerk supports; D1 doesn't affect it. Non-blocking.
