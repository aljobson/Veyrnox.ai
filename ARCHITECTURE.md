# Architecture

How Veyrnox.ai fits together. This is the map; the reasons behind each choice are in [`docs/adr/`](docs/adr/), the rules that protect it are in [`CLAUDE.md`](CLAUDE.md), and the domain vocabulary is in [`CONTEXT.md`](CONTEXT.md). Environment-specific detail lives in [`docs/architecture/`](docs/architecture/) (`current-state.md`, `target-state.md`, `environments.md`).

The [system design proposal](docs/architecture/system-design.md) develops this architecture with workload estimates, durable dispatch and recovery boundaries, service objectives, and a staged delivery plan. Proposed components are distinguished from the running application.

## The shape in one picture

```
Browser (Next.js UI, Bearer token in localStorage)
   │  fetch /api/v1/*
   ▼
Cloudflare Worker  (worker.js + OpenNext)
   │  body-size caps · admin edge rate limit · cron every 5 min
   ▼
middleware.js  ── verifies Supabase JWT (ES256 + JWKS, Web Crypto)
   │            ── sets x-veyrnox-auth-* headers, overwriting any inbound copy
   ▼
Route handlers  app/api/v1/*   (service-role access to Postgres)
   │
   ├─► Supabase Postgres (EU)   ledger, jobs, catalog, RLS, RPCs
   ├─► Providers                fal · kie · GrsAI · OpenRouter · BytePlus
   ├─► Cloudflare R2 (EU)       private media, presigned URLs ≤ 15 min
   └─► Stripe                   Checkout in, signed webhooks back

Providers / Stripe ──signed webhooks──► Worker ──► ledger RPCs
```

The browser never talks to Postgres. Only the Worker holds the service-role key, and every user-facing table has forced RLS as a second line of defence.

## Request path

1. **Edge.** `worker.js` caps request bodies, rate-limits admin paths before OpenNext sees them, and runs the scheduled recovery tasks.
2. **Auth gate.** `middleware.js` rejects any `/api/v1/*` request without a valid Supabase JWT (signature, issuer, audience `authenticated`, expiry with 5 s skew, `sub`). Identity then travels only in server-set `x-veyrnox-auth-id`, `-email` and `-role` headers. Routes trust those headers and never trust a user id in a body.
3. **Route handler.** Validates input at the boundary, applies a Postgres-backed rate limit, then calls RPCs. Errors are typed `{error: "kebab_case_code"}` and never leak provider payloads or DB messages.
4. **Unauthenticated endpoints** (the Stripe, fal, kie, OpenRouter and Cloudflare Stream webhooks) authenticate by cryptographic signature instead. BytePlus and GrsAI have no signed callback, so their jobs are polled by a sweep and never register a webhook.

## The money spine

Credits are the product's liability, so this is the part with the strictest rules.

- **`ledger_entries` is append-only**, enforced by a trigger. Corrections are compensating rows.
- **`credit_balances.balance` always equals `SUM(ledger_entries.delta)`** per user. Free Credits are tracked as a slice of that balance (`free_delta`, `free_balance`).
- **All writes go through RPCs** (`ledger_debit`, `ledger_refund`, `ledger_grant`, `signup_grant`, `credit_top_up`, `apply_top_up_refund`, and others). Nothing inserts into the ledger directly.
- **Every state-changing RPC is idempotent**, keyed by `jobs.idempotency_key` or `webhook_events(source, external_id)`. A replay is a no-op.
- **Frozen accounts** come only from `apply_top_up_refund` or `apply_dispute_event`, and only `unfreeze_account` lifts a freeze. All three write `account_actions`.
- **Reconciliation** (`reconcile_balances`, `reconcile_free_credits`, `reconcile_top_ups`) runs nightly and must return zero rows. Cron recovery tasks repair lost webhooks and unfinished refunds.

### Generation lifecycle

```
POST /api/v1/generations
  validate against capability registry  → unknown model = 501 before any debit
  rate limit (attempts, then 10 jobs/60 s)
  resolve & inspect source media (owned uploads only, never client URLs)
  ledger_debit (idempotency key)        → jobs row
  submit to provider (server-built request)
        │
        ├─ provider webhook (signed) ─► fetch result → copy to R2 → job DONE
        └─ failure / cancel / timeout ─► ledger_refund → job FAILED
  sweeps (cron) finish anything a callback never closed
```

Every debit path has a matching refund path. Auto Short and Clip Edit are the multi-provider variants: one catalog row and one debit, a parent job plus service-role `job_steps` advanced by the same webhooks and sweeps, with all-or-nothing refund ([ADR-0029](docs/adr/0029-auto-short-composite-jobs.md)).

## Catalog and capabilities

Pricing lives in the database (`model_catalog.credits_5s`) and is normative; the app layer never computes a price. `lib/modelCapabilities.js` (plus `additionalModelCapabilities.js`) holds one record per provider endpoint that decides which inputs, lengths and fixed parameters are allowed. A request is built from that record, and undeclared parameters are dropped from the price check, the stored inputs and the provider request ([ADR-0027](docs/adr/0027-model-capability-registry.md)). A model is only `active` once its endpoint has been verified live.

## Billing

Credit Pack Top-ups use Stripe Checkout with prices set inline from the catalog and Stripe as Merchant of Record ([ADR-0031](docs/adr/0031-stripe-replaces-lemonsqueezy.md)). Webhooks are verified by signature and deduped by `webhook_events`. If a webhook never lands, a return-URL backfill and a cron sweep credit the Top-up from a re-fetched Stripe session ([ADR-0033](docs/adr/0033-stripe-top-up-recovery.md)). Refunds claw credits back pro rata; chargebacks and refund-after-spend freeze the account. Subscriptions are accepted but not built ([ADR-0064](docs/adr/0064-core-subscriptions.md)).

## Storage

Generated and uploaded media live in a private R2 bucket in the EU jurisdiction. Keys are random UUIDs, never user-controlled. Browsers upload start images straight to R2 with a gateway-signed PUT ([ADR-0028](docs/adr/0028-browser-upload-to-r2.md)); downloads use presigned GETs of 15 minutes or less, minted only through an ownership-checking RPC. Retention sweeps delete expired assets. Project media enters quarantine and is inspected before use ([ADR-0056](docs/adr/0056-project-media-quarantine.md)).

## Tenancy and projects

Project documents follow Organisation → Workspace → Project, with membership checked live on every mutation. Reads use the caller's bearer token so RLS applies; writes go through narrowly scoped `SECURITY DEFINER` functions that recheck membership and write an audit row in the same transaction ([ADR-0051](docs/adr/0051-tenant-platform-foundation.md)). Generation and media are still user-owned and migrate to projects later.

## Feature areas

| Area | Where | Notes |
|---|---|---|
| Studio and create page | `app/veyrnox/app`, `app/api/v1/generations` | Main product surface |
| Auto Short / Clip Edit | `lib/autoShort*.js`, `lib/clipEdit*.js` | Composite jobs on `job_steps` |
| Social Cinema | `lib/cinema`, `app/api/v1/cinema`, `creators` | Gated by rollout flags; Cloudflare Stream for video |
| Veyrnox Publish | `lib/social`, `packages/adapters/social`, `app/api/v1/social` | OAuth tokens encrypted at rest; async publish engine and sweeps |
| Admin and operations | `app/api/v1/admin`, `docs/operations` | Admin metrics require Cloudflare Access and, when enabled, `aal2` |

## Security boundaries

- **CSP** uses a per-request nonce; `connect-src` allows only `'self'`, the Supabase host and our R2 endpoint. HSTS, framing and permissions headers are fixed in `next.config.mjs`.
- **Secrets** are Worker secrets, never `NEXT_PUBLIC_*`. SSRF is avoided by using constant outbound hosts only.
- **Webhooks** never trust a payload's `user_id`; they look the job up by id.
- **Abuse limits** exist per endpoint (generations, uploads, reads, checkout, admin). See ADRs 0034 to 0041.

## Environments and deploy

Two separate Supabase projects exist (AI staging and AI production), each with its own R2 bucket and keys; see [`docs/architecture/environments.md`](docs/architecture/environments.md). `main` is deployable at all times. A GitHub Actions workflow deploys each push to `main` one run at a time. Cloudflare Workers Builds only uploads preview versions. Production migrations are applied only by the `apply-migrations` workflow after owner approval ([ADR-0023](docs/adr/0023-migrations-applied-by-workflow.md)). Schema lives in `packages/db/schema/supabase/` as idempotent `NNNN_name` files.

## Constraints that shape the code

- **Bundler traps.** Cloudflare Workers Builds breaks if `tsx` is a root devDependency, or if `jose` or `@supabase/supabase-js` is on the SSR import graph. Auth uses Web Crypto and plain `fetch`.
- **Hard wall.** This repo contains no wallet or on-chain framing. `scripts/check-hard-wall.sh` enforces it in CI.
- **EU residency.** The production database and media stay in the EU (staging's Supabase project is in `us-east-2` and holds test data only) ([ADR-0005](docs/adr/0005-phase-0-business-preconditions.md), [ADR-0021](docs/adr/0021-media-in-eu-jurisdiction-r2.md)).

## Where to look first

| If you are changing... | Read |
|---|---|
| Anything touching credits | `CLAUDE.md` Database section, `packages/db/README.md`, ADR-0013, ADR-0018 |
| A model or its price | ADR-0014, ADR-0027, `docs/pricing/` |
| Auth or sessions | ADR-0006, ADR-0026, ADR-0030, ADR-0032, `middleware.js` |
| Uploads or media | ADR-0021, ADR-0028, ADR-0044, ADR-0056 |
| Anything deployed | `docs/architecture/environments.md`, ADR-0023 |
