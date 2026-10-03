# TRD — Veyrnox.ai technical requirements

**Status:** Current · 2026-10-02 (audited against `main` at `2da81dc`)
**Precedence:** [CLAUDE.md](../../CLAUDE.md) and [docs/adr/](../adr/README.md)
win over this document. This is the blueprint an agent reads before making a
technical choice: what the stack *is*, what is allowed, and what is banned.
**Diagram:** [diagrams/system-architecture.html](diagrams/system-architecture.html)
(source `diagrams/system-architecture.json`, Archify).

## 1. Shape of the system

One Cloudflare Worker (`veyrnox-ai`) serves the Next.js site and the
`/api/v1/*` gateway. Supabase provides identity and Postgres. All money
moves inside Postgres through `SECURITY DEFINER` RPCs. Media lives in a
private EU-jurisdiction R2 bucket. Generation is asynchronous: debit, submit
to a provider, complete by signed webhook or by cron poll, copy the output to
R2, mark the job `STORED`.

```
Browser ──Bearer JWT──► Worker (middleware.js → Next route) ──RPC──► Postgres
   │                       │  ├─ submit ─► fal / kie / OpenRouter / GrsAI / BytePlus
   └─ /auth/v1 ─► Supabase │  ├─ copy  ─► R2 (EU)
        Auth               │  ├─ Checkout ─► Stripe ─webhook─► Worker
                           │  ├─ tus ─► Cloudflare Stream (Cinema)
                           │  └─ OAuth + publish ─► IG / X / TikTok / LinkedIn / YouTube
                           └─ cron */5: sweeps, polls, recovery, publish queue
```

## 2. Stack

| layer | choice | version / where |
|---|---|---|
| framework | Next.js App Router | 15.5.x (`package.json`) |
| UI | React | 19.2 |
| styling | Tailwind CSS + CSS custom properties | 3.4; tokens in `app/globals.css`, `app/veyrnox/veyrnox.css` |
| fonts | `next/font/local`, self-hosted | Archivo, JetBrains Mono, Inter (`app/fonts/`) |
| adapter | `@opennextjs/cloudflare` | 1.20; `open-next.config.ts` defaults |
| runtime | Cloudflare Workers, `nodejs_compat` | `wrangler.jsonc`, compat date 2026-09-01 |
| Worker entry | `worker.js` wraps `.open-next/worker.js` | `fetch`: admin edge rate limit → body-size limit → OpenNext; `scheduled`: sweeps |
| language | JavaScript; TypeScript in `packages/db`, `packages/catalog`, typecheck of `packages/security` | TS 5.9 |
| Node | 22 in CI | no `engines` field (see ISSUES.md) |
| runtime deps | `next`, `react`, `react-dom`, `react-hot-toast`, `qrcode.react` | nothing else ships |

The whole site is `export const dynamic = 'force-dynamic'` (`app/layout.js`)
because every HTML response carries a per-request CSP nonce (ADR-0060).

### Workspace packages

| package | role |
|---|---|
| `packages/adapters` | provider adapters, plain `fetch` + Web Crypto: `fal`, `kie`, `openrouter`, `grsai`, `byteplus`, `stripe`, `r2` (SigV4), `r2Copy` (SSRF-safe copy with host allowlist), `social/*`; `lemonsqueezy` is retired but still present |
| `packages/provider-sdk` | server-only `PROVIDERS` registry used by `POST /api/v1/generations` |
| `packages/db` | `supabase-client.js` (service-role RPC), `tenant-client.js` (user JWT, RLS applies), ledger types, ~40 acceptance tests, all migrations |
| `packages/catalog` | CI-only margin-floor validator; runtime prices come from `model_catalog` |
| `packages/security` | config/environment validation, typed `ApiError`, bounded body reader, logging |

## 3. Banned and constrained

| rule | why |
|---|---|
| No `jose`, no `@supabase/supabase-js`, no `tsx` in root deps | each breaks the Workers build (PRs #25/#27/#38/#40) |
| No vendor SDKs (AWS, Stripe, provider SDKs) | bundle size and the Workers runtime; adapters are hand-written `fetch` |
| No HS256 JWT verification | ES256 via JWKS only |
| No raw SQL interpolation; DDL only as numbered migrations | CLAUDE.md §Database |
| No new CSP host without an ADR | CLAUDE.md §Web security |
| No outbound fetch to a URL derived from user input | SSRF; hosts are constants or allowlisted |
| No manual credit grants without an ADR naming the human | money spine |
| No wallet, crypto or on-chain anything | separate company; `hard-wall.yml` |

## 4. Hosting and environments

| `APP_ENV` | Worker | Supabase ref | region | notes |
|---|---|---|---|---|
| production | `veyrnox-ai` | `xdxdzmsztyzbnzeforxx` | eu-central-1 | all Cinema and tenant flags **off** |
| staging | `veyrnox-ai-staging` | `yrqzwqywxfesmbvhzjgj` | us-east-2 | tenant projects and most Cinema flags **on**; no provider/payment/R2 credentials, so not a full generation environment |
| development | `next dev` | local Supabase `127.0.0.1:54321` | — | — |

Bindings: `ASSETS`, `ADMIN_EDGE_RATE_LIMITER` (60/min, ADR-0039), cron
`*/5 * * * *`. **No** R2 binding, KV, D1, Durable Objects, Queues or Email
binding — R2 is reached over SigV4, Stream over its REST API, email through
Supabase Auth's SMTP (Cloudflare Email Sending).

Configuration: public values in `wrangler.jsonc` `vars`; credentials via
`wrangler secret put`. Secret names (never values): Supabase service role,
`FAL_KEY`, `KIE_API_KEY`, `KIE_WEBHOOK_HMAC_KEY`, `OPENROUTER_API_KEY`,
`OPENROUTER_WEBHOOK_SECRET`, `GRSAI_API_KEY`, `BYTEPLUS_API_KEY`, `R2_*`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CINEMA_STREAM_*` (6),
social OAuth client ids/secrets, `SOCIAL_OAUTH_STATE_SECRET`,
`SOCIAL_TOKEN_ENCRYPTION_KEY`, `SOCIAL_MEDIA_PROXY_SECRET`,
`TOP_UP_BACKFILL_TOKEN`, `ADMIN_REAP_TOKEN`, `TYPESAFE_API_KEY`.

Feature flags are **server-side `wrangler.jsonc` vars** (e.g.
`CINEMA_ENABLED`, `TENANT_PROJECTS_ENABLED`, `*_RATE_LIMIT_ENABLED`,
`ADMIN_REQUIRE_AAL2`, `JEV_SUBMIT_ERRORS_MODE`, `PUBLISH_ENABLED`). Client-only previews use
`localStorage.veyrnox_*` (`veyrnox_editor`, `veyrnox_auto_short`).

## 5. Data access

- **Identity:** Supabase Auth only — email/password, magic link, Google,
  Apple (ADR-0030), TOTP second factor; passkeys are implemented against the
  GoTrue REST API (ADR-0032, Proposed). Turnstile is verified by Supabase
  Auth (ADR-0026). Browser client: `app/lib/authClient.js` +
  `components/AuthGate.jsx`, plain `fetch` to `/auth/v1/*`. Session in
  `localStorage['veyrnox_supabase_session']`.
- **Money and jobs:** Worker → `POST {SUPABASE_URL}/rest/v1/rpc/<name>` with
  the service role, 8 s timeout (`packages/db/supabase-client.js`). Bypasses
  RLS by design; RLS is the second line.
- **Projects / tenant data:** Worker → PostgREST with the *user's* JWT and the
  publishable key (`packages/db/tenant-client.js`), so RLS is the enforcing
  line (ADR-0051). 256 KB response cap, no redirects.
- **Schema:** [SCHEMA.md](SCHEMA.md). Migrations are the authority.

## 6. External providers

| provider | adapter | used for | outbound auth | completion / inbound verification |
|---|---|---|---|---|
| fal.ai | `adapters/fal.js` | breadth: image, video, audio, TTS | `Key FAL_KEY` | webhook, Ed25519 via fal JWKS + our user id |
| kie.ai | `adapters/kie.js` | price lane: Nano Banana, Kling, Hailuo, Flux, Veo, ElevenLabs | Bearer | webhook HMAC over `taskId.timestamp`; body not covered, so the task is re-fetched |
| OpenRouter | `adapters/openrouter.js` | Seedance video | Bearer | webhook HMAC over `t,` + raw body |
| GrsAI | `adapters/grsai.js` | Nano Banana Pro / edit | Bearer | **poll only** (`lib/grsaiSweep.js`) |
| BytePlus ModelArk | `adapters/byteplus.js` | Seedance (rows staged inactive, ADR-0058) | Bearer | **poll only** (`lib/byteplusSweep.js`) |
| Stripe | `adapters/stripe.js` | Credit Packs (Checkout, Managed Payments, automatic tax), Cinema Pass and Publish Plan subscriptions | Bearer | `Stripe-Signature` HMAC with timestamp tolerance; top-up id in metadata is HMAC-signed |
| Cloudflare R2 | `adapters/r2.js`, `r2Copy.js` | all media | SigV4 | presigned GET/PUT ≤ 15 min |
| Cloudflare Stream | `lib/cinema/stream.js` | Cinema upload (tus) and signed playback | Bearer + signing JWK | webhook HMAC (`webhook-signature`) |
| Cloudflare Access | `lib/accessJwt.js` | admin routes | — | Worker re-verifies the Access JWT |
| Turnstile | `components/Turnstile.jsx` | CAPTCHA on auth | — | verified by Supabase Auth |
| Instagram, LinkedIn, X, TikTok, YouTube | `adapters/social/*` | Veyrnox Publish | OAuth2 (PKCE where supported); tokens AES-GCM encrypted at rest; HMAC-signed state | no inbound webhooks; cron publishes |
| typesafe.ai (Jev) | `lib/jev.js` | classify untyped provider refusals (ADR-0066) | API key | ships `off` |

The provider is an internal routing detail; it is never shown to the user.
A model row is `active` only after its live endpoint returned real output.

## 7. API conventions (`/api/v1/*`)

- `middleware.js` gates every `/api/v1/*` path: ES256 verification against
  the Supabase JWKS (cached 1 h, stale ≤ 6 h, refresh on unknown `kid` at
  most once a minute), claims `iss`, `aud=authenticated`, `exp` ±5 s, `sub`.
  Failure → 401 with a reason code; JWKS outage → 503; never 500.
- Identity is forwarded only in server-set headers
  `x-veyrnox-auth-{id,email,role,aal,mfa-at}`; inbound copies are stripped.
- Validate every input at the boundary (regex or schema; see
  `IDEMPOTENCY_RE` in `app/api/v1/generations/route.js`). Bodies are size
  capped in `worker.js`.
- Errors are typed: `{ "error": "kebab_case_code", ... }`. No stack traces,
  DB messages or vendor payloads.
- Mutations are POST/PUT/PATCH/DELETE; no state-changing GET; same-origin
  only, no CORS wildcard.
- Every state-changing call takes an idempotency key; replay is a no-op.

### Rate limits (Postgres sliding windows unless noted)

| surface | limit | source |
|---|---|---|
| generation jobs | 10 / 60 s per user (inside `ledger_debit`) | CLAUDE.md |
| generation attempts | 20 / min | ADR-0034, 0113 |
| upload URLs | 60 / min | ADR-0035 |
| account + balance reads | 120 / min | ADR-0036 |
| checkout attempts | 20 / min | ADR-0038 |
| top-up reads / returns | 120 / 30 per min | ADR-0040 / 0041 |
| admin edge | 60 / min per IP (Workers rate-limit binding) | ADR-0039 |

## 8. Web security

- **CSP** is built per request in `lib/contentSecurityPolicy.mjs` and applied
  by `middleware.js` with a nonce: `default-src 'self'`; `script-src 'self'
  'nonce-…' challenges.cloudflare.com`; `connect-src 'self'` + the Supabase
  origin + both R2 endpoints + the two Stream upload hosts; `frame-src`
  Turnstile + Stream; `frame-ancestors 'none'`, `object-src 'none'`,
  `base-uri 'self'`, `form-action 'self'`. HTML responses are
  `Cache-Control: private, no-store`.
- Fixed headers (`next.config.mjs`): HSTS 2 years + preload,
  `X-Frame-Options: DENY`, `nosniff`, strict-origin referrer, camera/mic/geo
  disabled.
- Admin: Cloudflare Access in front of `/app/admin*`, `/api/v1/admin/*`,
  `/api/admin/*`; `aal2` required when `ADMIN_REQUIRE_AAL2` is true.
- Logging: `console.error` on every auth reject, webhook signature failure
  and ledger invariant violation; Workers observability is on.

## 9. Background work

`worker.js#scheduled` (every 5 min, each task isolated with
`Promise.allSettled` and recorded by `observeRecovery`): project asset
cleanup, Cinema upload recovery and removal, Stripe top-up backfill, upload
and reservation sweeps, Auto Short step sweep, asset reap, GrsAI and BytePlus
polls, Veyrnox Publish queue.

`pg_cron` in Postgres: asset expiry, stuck-job sweep, balance reconciliation,
Free Credit expiry, reconciliation snapshot (15 min), recovery health
(15 min).

There is no queue product yet; Cloudflare Queues/Workflows are a later step
(see [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)).

## 10. CI/CD

| workflow | trigger | does |
|---|---|---|
| `ci.yml` | PR, push main | grep gates, migration numbering, catalog-update guards, lint, typecheck, security check, `npm test`, `next build`, `npm audit --audit-level=high` |
| `ledger-tests.yml` | PR, push main | Postgres 16 service: rebuild schema, margin test, migrate, acceptance tests |
| `verify.yml` | PR, push main | no submodules, no live MuAPI code |
| `hard-wall.yml` | PR, push main | wallet-term ban |
| `migration-ledger.yml` | PR, push, hourly | live applied migrations vs repo |
| `apply-migrations.yml` | push main | plan, then owner-approved apply to production (ADR-0023) |
| `deploy-production.yml` | push main | waits for green `ci`, checks the commit is still tip, `build:worker` + deploy |
| `reconcile-watch.yml`, `recovery-health.yml`, `signup-gate.yml` | hourly | open an issue on drift |
| `fal-catalog-watch.yml` | weekly | fal endpoint/price drift |
| `top-up-backfill.yml` | manual | break-glass backfill |

Cloudflare Workers Builds uploads preview versions for every branch; only
`deploy-production.yml` promotes. Rollback: `wrangler rollback <version>` or
rerun the workflow on an older commit.

## 11. Testing

| layer | tool | where |
|---|---|---|
| unit | `node --test` | `tests/*.test.mjs` (~175 files) |
| ledger / DB acceptance | `tsx --test` against real Postgres | `packages/db/*.acceptance.test.ts` (~40) |
| integration | scripts against a disposable local DB | `scripts/test-*.mjs` |
| live provider checks | manual scripts | `scripts/verify-*-endpoints.mjs` |
| E2E | **none** | gap — see ISSUES.md |

Every state-changing RPC has an idempotency test; every debit path has a
tested refund path.
