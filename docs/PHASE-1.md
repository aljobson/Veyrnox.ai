# Phase 1 — Money Spine

**Status:** In progress · Kicked off 2026-09-10
**Target:** an authenticated user can debit credits, submit an image job through Inngest to fal.ai, receive the result stored in R2, and get refunded on failure — provably atomic under concurrent test.
**Timeline:** 4–6 weeks solo + AI assist
**Predecessor:** ADR-0000 (Replacer accepted), ADR-0003 (LemonSqueezy), ADR-0004 (Clerk + Neon).

Phase 1 exists to prove the money invariants — nothing user-visible until the ledger cannot lose money under concurrent load. Once proven, Phase 2 (billing) plugs in and Phase 3 (studio migration) can start.

## Load-bearing blockers

Six open questions from ADR-0000 gate vendor onboarding. Engineering can proceed on schema/logic in parallel, but Phase 1's Exit gate requires Clerk + Neon + Inngest + fal.ai + R2 accounts, which in turn require:

- [x] Legal entity for Veyrnox — **UK Ltd** ([ADR-0005 §1](adr/0005-phase-0-business-preconditions.md))
- [x] Product-owner tax residency — **United Kingdom** ([ADR-0005 §2](adr/0005-phase-0-business-preconditions.md))
- [x] Data residency — **EU-only** ([ADR-0005 §3](adr/0005-phase-0-business-preconditions.md)) — triggers auth-provider switch, see [ADR-0006](adr/0006-auth-and-db-amendment-eu-residency.md)
- [x] EU AI Act Article 50 — **C2PA + UI badge + ToS notice** ([ADR-0005 §5](adr/0005-phase-0-business-preconditions.md))
- [x] DMCA designated agent — **registered-agent / virtual-mailbox service** ([ADR-0005 §6](adr/0005-phase-0-business-preconditions.md)); onboarding out-of-band
- [x] Pricing hypothesis — Free 50 / Starter 200 / Plus 1000 / Ultra 3000 credits/mo ([Slice 2 catalog](../packages/catalog/index.ts), [ADR-0005 §4](adr/0005-phase-0-business-preconditions.md))

## Sprint slices

Each slice is one PR-sized unit. Ship in order. Slice N cannot merge before slice N-1 unless explicitly noted.

### Slice 0 — Scaffolding restored (this session, no vendors needed)
- Restore `packages/{db,adapters,catalog}` from `docs/archive/gateway-v1/reference/` back into the build tree
- Drop outbox module — Inngest replaces it per §25.7 (see gap analysis)
- Add `packages/db/schema/` with the Postgres migrations for `users`, `credit_balances`, `ledger_entries`, `jobs`, `model_catalog`, `assets`, `webhook_events`
- Wire packages into `package.json` workspaces
- Add `.env.example` with placeholders for `DATABASE_URL`, `CLERK_SECRET_KEY`, `INNGEST_SIGNING_KEY`, `FAL_KEY`, `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_WEBHOOK_SECRET`, R2 bindings
- Add `wrangler.jsonc` binding placeholders (commented) for Neon (env var), R2 bucket, Inngest secret
- **Exit gate:** `npm run build` still succeeds; new packages compile with `tsc --noEmit`

### Slice 1 — Ledger contract + schema (unblocked)
- Adapt `packages/db/ledger.ts` from archive: drop outbox INSERT, keep debit + refund + reconcile
- Adapt `packages/db/queries/debit.sql`: drop outbox insert, return `job_id`
- `packages/db/queries/` gets: `debit.sql`, `refund.sql`, `reconcile.sql`, `insert_grant.sql`
- Types in `packages/db/types.ts` — every table row shape
- Local Postgres via `docker-compose.yml` for testing (spec §19 says dev env uses local Postgres)
- Ledger acceptance test (from archive, `ledger.acceptance.test.ts`) adapted to hit local Postgres
- **Exit gate:** all §6 acceptance tests pass (50 concurrent debits → zero double-spend, idempotency guard, insufficient balance, refund, append-only trigger, reconciliation)

### Slice 2 — Model catalog + margin floor (unblocked, but blocked-on-pricing)
- `packages/catalog/` gets `models.ts` (typed) sourced from `platform_model_v2.xlsx` (**BLOCKED — file not in repo**)
- Migration `0002_model_catalog.sql` seeds catalog
- Margin-floor validator: `packages/catalog/margin-validator.ts` — CI check that every `credit_price × conversion_rate ≥ provider_cost × (1 + margin_floor)`
- **Exit gate:** CI job that fails if any row breaches margin floor. Currently requires the pricing hypothesis to be filled in.

### Slice 3 — Auth (Supabase per ADR-0006)

Sub-slice 3a (this PR, ships without a vendor account):
- `packages/auth/` — Supabase JWT verifier (`verifyToken` / `verifyRequest`)
  using `jose`. Works in Cloudflare Workers via Web Crypto.
- `verify.test.ts` unit tests cover happy path, wrong secret, wrong
  issuer, expired token, Bearer header, cookie fallback, SSR JSON-array
  cookie shape.
- Schema: `users.clerk_id` → `users.auth_id` (was named for the earlier
  Clerk plan; Supabase's `auth.users.id` fills this).
- RLS policies migration lives at `packages/db/schema/supabase/0003_rls_policies.sql`
  — Supabase-only (uses `auth.uid()` / `auth.role()`). Local Postgres
  ignores it; a future migration script applies both dirs against Supabase.
- `.env.example` gets `SUPABASE_URL`, `SUPABASE_JWT_SECRET`,
  `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_WEBHOOK_SIGNING_SECRET`.

Sub-slice 3b (blocked on Supabase provisioning):
- `middleware.ts` at repo root — gates `/api/v1/*` on a verified JWT,
  forwards `x-veyrnox-auth-id` header downstream.
- Supabase webhook `POST /api/webhook/supabase` inserts a `users` row
  on `user.created`, emits a 50-credit `grant:signup` via Ledger.grant.
- Existing `__Host-muapi_key` route deprecated — sunset banner + 30-day
  dual-run.

- **Exit gate (3a):** JWT verifier unit tests pass; users.auth_id rename
  landed; RLS policies file present.
- **Exit gate (3b):** signup + login flow works against a real Supabase
  project; users appear in Postgres `users` table via the webhook.

### Slice 4 — Neon Postgres + Hyperdrive — needs vendor account
- Neon project created (region per data-residency decision)
- Neon serverless driver `@neondatabase/serverless` in `packages/db`
- Cloudflare Hyperdrive optional overlay for connection pooling (add later if latency)
- Migrations run via CLI `wrangler d1` equivalent — a `scripts/migrate.mjs` that reads `packages/db/schema/*.sql` in order
- **Exit gate:** `scripts/migrate.mjs` deploys the schema to Neon; `SELECT NOW()` roundtrip <100ms from a Worker

### Slice 5 — fal.ai adapter (real endpoints)
- Adapt `packages/adapters/fal.ts` — keep Ed25519 webhook verification from R7, real endpoint map for the top-priority model (Wan 2.5 for T2V per §25.4)
- `packages/adapters/fal.integration.test.ts` — hits fal.ai sandbox / uses recorded fixtures
- **Exit gate:** submit a Wan 2.5 job to fal.ai, receive the webhook, verify signature, extract output URL

### Slice 6 — Inngest wiring — needs vendor account
- Inngest project + signing key
- `packages/queue/` — new package with Inngest client + function definitions
- Two functions: `job.submit` (submit to fal, transition to SUBMITTED), `job.completed` (transition to STORED, copy to R2, no refund)
- Per-user concurrency key: `event.user_id`
- Circuit breaker per (model, provider) — Redis-backed later, in-memory for now
- **Exit gate:** submit a job via POST `/api/v1/generations`, watch it flow through Inngest, land completed in DB

### Slice 7 — R2 media pipeline
- R2 bucket `veyrnox-media` created in Cloudflare
- Adapter fetches result URL, copies to R2 with signed-URL retention per plan (§10.6)
- Signed-URL helper: `packages/db/r2-urls.ts` (already in archive, adapt)
- **Exit gate:** completed job's `assets` row points to an R2 key; signed URL returns the image

### Slice 8 — Refund saga
- Job failure → compensating `+delta` ledger entry (`reason='refund:job_failed'`)
- Wired into Inngest failure handler
- Test: force a fal.ai failure, assert refund lands within 5s
- **Exit gate:** balance restored on provider failure; user sees "refunded" toast

### Slice 9 — End-to-end walk-through
- Wire ImageStudio's `generateImage()` call to POST `/api/v1/generations` instead of the MuAPI proxy
- Behind a feature flag: `USE_NEW_GATEWAY=true` in Clerk user metadata
- **Exit gate (Phase 1 done):** with the flag on, log in → click generate → see the image → balance debited. Repeat under 50-concurrent-user load without any double-spend or lost job.

## Not in Phase 1

Explicitly deferred to later phases per the gap analysis:

- Billing / Stripe / LMS checkout (Phase 2)
- Free-tier grants on signup (Phase 2)
- Replicate adapter + failover (Phase 3)
- Studio-wide migration (Phase 3)
- Moderation (Phase 4)
- Premium gating (Phase 4)
- Result cache (Phase 4)
- Sentry / PostHog (Phase 4)
- SOC2-adjacent controls, DR drill (Phase 5)

## What "done" looks like

Phase 1 exits when:

1. A Clerk-authenticated user can hit `POST /api/v1/generations` with an idempotency key, get their credit balance decremented (server-side, ledger append-only), see an Inngest event picked up, watch it hit fal.ai, and receive an R2-stored result.
2. Provider failure → automatic refund → balance restored.
3. 50 concurrent debits against the same user account complete with zero double-spend and zero negative balance (`packages/db/ledger.acceptance.test.ts`).
4. All migrations are checked in and applied against a real Neon Preview branch.
5. No production traffic touches the new gateway yet — the flag stays off outside of the developer's Clerk metadata. This is the point at which Phase 2 can start.

## What Phase 1 does not prove

- That anyone will pay for it — that requires Phase 2 (billing) and Phase 3 (real users).
- That provider costs stay predictable — Phase 4 sentinel not built yet.
- That moderation posture is defensible — Phase 4 job.

Phase 1 is entirely infrastructure. The value it produces is optionality: after Phase 1, everything else becomes a straight line.
