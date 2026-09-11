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

Sub-slice 3b (shipped 2026-09-10, PR forthcoming):
- **`middleware.js` at repo root** — gates `/api/v1/*` on a verified
  Supabase JWT via `jose`. Reads Bearer header or Supabase SSR cookie.
  Fails closed on missing/invalid tokens. Forwards `x-veyrnox-auth-id`,
  `x-veyrnox-auth-email`, `x-veyrnox-auth-role` downstream.
- **`GET /api/v1/session/me`** — smoke-test endpoint reflecting the
  verified auth headers. Proves the gateway receives authenticated
  traffic before any money-touching route exists.
- **`POST /api/webhook/supabase`** — receives Supabase Database Webhook
  events on `auth.users` INSERT. Shared-secret authenticated,
  constant-time compared. Dedups via `webhook_events(source, external_id)`
  and calls the `signup_grant` Postgres RPC (migration 0005) which
  atomically creates the users row + credit_balances row + 50-credit
  `grant:signup` ledger entry.
- **`app/api/session/muapi/route.js`** carries `Deprecation: true` and
  `Sunset: Fri, 10 Oct 2026 00:00:00 GMT` (RFC 8594) plus a
  `Link: successor-version` header. 30-day dual-run; hard cutover 2026-10-10.
- `jose` added to root dependencies (pure JS, no native binaries — safe
  for Cloudflare Workers per Slice 1 tsx lesson).

- **Exit gate (3a):** JWT verifier unit tests pass; users.auth_id rename
  landed; RLS policies file present.
- **Exit gate (3b):** signup + login flow works against a real Supabase
  project; users appear in Postgres `users` table via the webhook.

### Slice 4 — Postgres wired to the Worker (Supabase per ADR-0006)

Sub-slice 4a (shipped, project already provisioned in Slice 3-2):
- Supabase staging Postgres live at `yrqzwqywxfesmbvhzjgj` (us-east-2 — see supabase-staging.md re: Frankfurt migration before Slice 9)
- Migrations 0001–0005 applied via Supabase MCP; catalog seeded

Sub-slice 4b (this PR):
- **`packages/db/schema/supabase/0006_ledger_rpc_functions.sql`** — atomic
  `ledger_debit`, `ledger_refund`, `ledger_grant`, `read_user_balance`
  Postgres functions. SECURITY DEFINER, `SET search_path = ''`, service_role
  only. Applied to staging.
- **`packages/db/supabase-client.js`** — minimal fetch-based PostgREST
  client. `rpc(name, args, cfg)` and `select(table, opts, cfg)`. No
  `@supabase/supabase-js` dep (heavy libs trip Workers Builds; the
  Slice 1 tsx / Slice 3b jose lessons apply).
- **`GET /api/v1/health`** — smoke test. Returns `select_latency_ms`
  (round-trip to Supabase via PostgREST) and `catalog_alive`.
- **`GET /api/v1/balance`** — reads `read_user_balance(auth_id)` using the
  middleware-verified `x-veyrnox-auth-id` header. Never trusts a
  client-supplied id.

Exit gate: with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_JWT_SECRET` set as wrangler secrets, an authenticated user
hitting `GET /api/v1/health` sees `select_latency_ms < 100` and
`catalog_alive: true`; `GET /api/v1/balance` returns their materialised
credit balance.

### Slice 5 — fal.ai adapter + submit endpoint + webhook (shipped)

- **`packages/adapters/fal.js`** — Worker-runtime adapter. `submitJob(job, cfg)`
  posts to `queue.fal.run/<endpoint>`; `verifyWebhookSignature(rawBody, sig)`
  Ed25519-verifies against fal's JWKS via Web Crypto. §5.4 invariant
  preserved (fal = Ed25519, never HMAC). JWKS cached 24h in-worker.
- **`packages/db/schema/supabase/0007_job_state_transitions.sql`** —
  `job_submitted`, `job_succeeded`, `job_failed` RPCs. service_role only.
- **`POST /api/v1/generations`** — auth → catalog lookup → user resolution
  → `ledger_debit` RPC → `fal.submitJob` → `job_submitted` RPC. Idempotent
  replay via jobs(user_id, idempotency_key). Refund on submit failure.
- **`POST /api/webhook/fal`** — Ed25519 verify → dedup via webhook_events
  → route by status: success → `job_succeeded`; failure → `job_failed` +
  `ledger_refund`. Never trusts the body until signature verification passes.
- Endpoint map sourced from `model_catalog.provider_endpoint` (Slice 2 seed).

Exit gate: with `FAL_KEY`, `PUBLIC_HOST`, and the Supabase secrets configured,
a POST to `/api/v1/generations` for a LAUNCH model triggers a real fal
submission; the fal webhook arriving back moves the job through SUBMITTED →
SUCCEEDED (or → FAILED → REFUNDED). Verified once against staging with a
real FAL_KEY.

### Slice 6 — Per-user rate limiting (Inngest scope collapsed)

Fal.ai's own queue + webhook (Slice 5) covers the async orchestration
Inngest would have provided — enqueue, fan-out, retry, callback. What we
still need is a **fair-use guard** so one user can't monopolise the
gateway. Full Inngest wiring is deferred to a real Slice 6' if durable
multi-step workflows are ever needed.

Shipped:
- **`packages/db/schema/supabase/0008_rate_limit_check.sql`** —
  `check_generation_rate_limit(auth_id, limit_per_window, window_seconds)`
  RPC. Sliding-window count against `jobs.created_at`, no dedicated
  table (existing `jobs_user_id_idx` covers it). Returns
  `{ok, count, limit}` or `{ok:false, code:'RATE_LIMITED',
  retry_after_seconds, ...}`. service_role only.
- **`POST /api/v1/generations`** — calls the rate check as step 0,
  before catalog lookup or debit. Rejected requests never move
  credits. Baseline: **10 generations per 60 seconds per user**.
  429 response carries a `Retry-After` header (RFC 9110).
  Tier-differentiated limits (Free/Starter/Plus/Ultra) arrive
  with Phase 4 premium gating.

Sanity-tested on staging: rate-check returned RATE_LIMITED with
retry_after_seconds populated correctly, USER_NOT_FOUND for a
phantom auth_id.

Exit gate: 11th generation submission inside 60s returns HTTP 429
with `Retry-After`; the 10th succeeds.

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
