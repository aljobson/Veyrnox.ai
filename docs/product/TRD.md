# TRD — Veyrnox.ai technical requirements

**Status:** Current · 2026-10-08 (audited against `main` at `42150476`; first written 2026-10-02 at `2da81dc`; Publish statements amended against `bee1ea4f`, PR #637/#638, migration 0228)
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
   └─ /auth/v1 ─► Supabase │  ├─ chat  ─► OpenRouter (own key) + Exa search
        Auth               │  ├─ copy  ─► R2 (EU)
                           │  ├─ Checkout ─► Stripe ─webhook─► Worker
                           │  ├─ tus ─► Cloudflare Stream (Cinema)
                           │  ├─ OAuth + publish ─► IG / X / TikTok / LinkedIn / YouTube
                           │  │                    + Facebook / Threads / Pinterest / Bluesky /
                           │  │                      Twitch / Business Profile (tester-stage)
                           │  ├─ email ─► Resend (violation notices, subscription alerts)
                           │  └─ plan / run ─► montage runner ─signed callback─► Worker (video agent, off)
                           └─ cron */5: sweeps, polls, recovery, publish queue
```

## 2. Stack

| layer | choice | version / where |
|---|---|---|
| framework | Next.js App Router | 16.3.x (`package.json`); auth gate stays `middleware.js`, not `proxy.js` (OpenNext Cloudflare) |
| UI | React | 19.3 |
| styling | Tailwind CSS + CSS custom properties | 3.4 (v4 tracked in #476); tokens in `app/globals.css`, `app/veyrnox/veyrnox.css` |
| fonts | `next/font/local`, self-hosted | Archivo, JetBrains Mono, Inter (`app/fonts/`) |
| adapter | `@opennextjs/cloudflare` | 1.20; `open-next.config.ts` defaults |
| runtime | Cloudflare Workers, `nodejs_compat` | `wrangler.jsonc`, compat date 2026-09-01 |
| Worker entry | `worker.js` wraps `.open-next/worker.js` | `fetch`: admin edge rate limit → body-size limit → OpenNext; `scheduled`: sweeps |
| language | JavaScript; TypeScript in `packages/db`, `packages/catalog`, typecheck of `packages/security` | TS 6.0.3 |
| Node | 22 | `engines` `>=22` and `.nvmrc` (ISSUES I6) |
| runtime deps | `next`, `react`, `react-dom`, `react-hot-toast`, `qrcode.react`, `motion`, `animejs`, `clsx`, `tailwind-merge`, `@number-flow/react`, `d3-array`, `d3-shape`, `@visx/*` (charts) | UI only; no vendor, auth or database SDK. `sharp` is a dev dependency |

The whole site is `export const dynamic = 'force-dynamic'` (`app/layout.js`)
because every HTML response carries a per-request CSP nonce (ADR-0060).

### Workspace packages

| package | role |
|---|---|
| `packages/adapters` | provider adapters, plain `fetch` + Web Crypto: `fal`, `kie`, `openrouter`, `grsai`, `byteplus`, `stripe`, `openrouterChat` (chat replies), `exa` (capped Web search), `resend` (email), `stripeCreditSubscriptions`, `r2` (SigV4), `r2Copy` (SSRF-safe copy with host allowlist), `social/*`; `lemonsqueezy` was removed (0180, #424) |
| `packages/provider-sdk` | server-only `PROVIDERS` registry used by `POST /api/v1/generations` (includes the `montage` runner, off) |
| `packages/db` | `supabase-client.js` (service-role RPC), `tenant-client.js` (user JWT, RLS applies), ledger types, 57 acceptance tests, all migrations |
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
| production | `veyrnox-ai` | `xdxdzmsztyzbnzeforxx` | eu-central-1 | Chat, free allowance, Personas, referrals and Clip Editor captions **on**; every Cinema flag, `TENANT_PROJECTS_ENABLED`, `PUBLISH_ENABLED`, `SUBSCRIPTIONS_ENABLED` and `AGENT_VIDEO_ENABLED` **off** |
| staging | `veyrnox-ai-staging` | `yrqzwqywxfesmbvhzjgj` | us-east-2 | tenant projects, most Cinema flags, Publish (analytics, insights, calendar, device uploads), Chat and captions **on** in `wrangler.jsonc`; free allowance, Personas, referrals, subscriptions and the video agent `"false"` there (deploys keep dashboard vars, so the live values may differ — unverified). Now has provider and R2 credentials for chat, images, captions and uploads; no Stripe test keys (ISSUES P6) |
| development | `next dev` | local Supabase `127.0.0.1:54321` | — | — |

Bindings: `ASSETS`, `ADMIN_EDGE_RATE_LIMITER` (60/min, ADR-0039), cron
`*/5 * * * *`. **No** R2 binding, KV, D1, Durable Objects, Queues or Email
binding — R2 is reached over SigV4, Stream over its REST API, email through
Supabase Auth's SMTP (Cloudflare Email Sending).

Configuration: public values in `wrangler.jsonc` `vars`; credentials via
`wrangler secret put`. Secret names (never values): Supabase service role,
`FAL_KEY`, `FAL_WEBHOOK_USER_ID`, `KIE_API_KEY`, `KIE_WEBHOOK_HMAC_KEY`,
`OPENROUTER_API_KEY`, `OPENROUTER_WEBHOOK_SECRET`, `OPENROUTER_CHAT_API_KEY`
(chat only, own spend cap, required in production), `EXA_API_KEY`,
`GRSAI_API_KEY`, `BYTEPLUS_API_KEY`, `R2_*`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `SUBSCRIPTION_ALERT_EMAIL`,
`CINEMA_STREAM_*` (6), social OAuth client ids/secrets (Meta, X, LinkedIn,
TikTok, YouTube and, since 0228, `FACEBOOK_*` (falls back to `META_*`),
`THREADS_*`, `PINTEREST_*`, `TWITCH_*`, `GMB_*`; Bluesky needs none),
`SOCIAL_OAUTH_STATE_SECRET`, `SOCIAL_TOKEN_ENCRYPTION_KEY`,
`SOCIAL_MEDIA_PROXY_SECRET`, `MONTAGE_RUNNER_BASE`, `MONTAGE_SIGNING_SECRET`,
`MONTAGE_PLAN_SECRET`, `TOP_UP_BACKFILL_TOKEN`, `ADMIN_REAP_TOKEN`,
`TYPESAFE_API_KEY`. `wrangler.jsonc` marks several social client secrets "not
yet provisioned"; which secrets are set is not visible from the repo.

Feature flags are **server-side `wrangler.jsonc` vars**, read per request, and
only the exact string `"true"` opens one. Production values at the audited
commit:

| on (`"true"`) | off (`"false"`) |
|---|---|
| `CHAT_ENABLED`, `FREE_ALLOWANCE_ENABLED`, `PERSONAS_ENABLED`, `REFERRALS_ENABLED`, `CLIP_EDIT_CAPTIONS_ENABLED`, `PUBLISH_CALENDAR_ENABLED` (moot while Publish is shut), `RECOVERY_HEALTH_ENABLED`, `ADMIN_REQUIRE_AAL2`, the six `*_RATE_LIMIT_ENABLED` | `PUBLISH_ENABLED`, `PUBLISH_EXTENDED_NETWORKS_ENABLED` (on in staging), `PUBLISH_ANALYTICS_ENABLED`, `PUBLISH_POSTING_INSIGHTS_ENABLED`, `PUBLISH_UPLOADS_ENABLED`, `INSTAGRAM_INSIGHTS_SCOPE_ENABLED`, `TIKTOK_ANALYTICS_SCOPE_ENABLED`, `SUBSCRIPTIONS_ENABLED`, `AGENT_VIDEO_ENABLED`, `TENANT_PROJECTS_ENABLED`, `UPLOAD_INTEGRITY_ENABLED`, every `CINEMA_*` / creator / voting / comments / PPV / premieres / recommendations flag |

`JEV_SUBMIT_ERRORS_MODE` is `off`. `CHAT_RESEARCH_ENABLED` (Deep research) is
read by `lib/chat.js` but not declared in `wrangler.jsonc`, so it is off by
being unset (ISSUES D10). While `PUBLISH_ENABLED` is not `"true"`,
`middleware.js` answers `/api/v1/social/*` with 503 `publish_not_open`; the
cron publish sweep is not gated. Client-only previews use `localStorage.veyrnox_*`:
`veyrnox_editor`, `veyrnox_editor_captions`, `veyrnox_auto_short`,
`veyrnox_video_agent`, `veyrnox_projects`, `veyrnox_social_cinema`. Chat has no
preview switch any more.

## 5. Data access

- **Identity:** Supabase Auth only — email/password, magic link, Google,
  Apple (ADR-0030), TOTP second factor; passkeys are implemented against the
  GoTrue REST API, enrolled and removed on `/app/account` (ADR-0032, still
  Proposed; production sign-in unconfirmed). Turnstile is verified by Supabase
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
| fal.ai | `adapters/fal.js` | breadth: image, video, audio, TTS, Clip Editor captions (`veed/subtitles`) | `Key FAL_KEY` | webhook, Ed25519 via fal JWKS + our user id |
| kie.ai | `adapters/kie.js` | price lane: Nano Banana, Kling, Hailuo, Flux, Veo, ElevenLabs | Bearer | webhook HMAC over `taskId.timestamp`; body not covered, so the task is re-fetched |
| OpenRouter | `adapters/openrouter.js` | Seedance video | Bearer | webhook HMAC over `t,` + raw body |
| OpenRouter (chat) | `adapters/openrouterChat.js`, `lib/chatTurn.js` | LLM Chat replies, streamed; separate key and spend cap, non-training providers only (ADR-0067) | Bearer `OPENROUTER_CHAT_API_KEY` | streamed response; no webhook |
| Exa | `adapters/exa.js` | the capped Web search for chat (0220); the price depends on the cap, so a capped row offers Web search only while the key is set | Bearer | synchronous |
| GrsAI | `adapters/grsai.js` | Nano Banana Pro / edit | Bearer | **poll only** (`lib/grsaiSweep.js`) |
| BytePlus ModelArk | `adapters/byteplus.js` | Seedance (rows staged inactive, ADR-0058) | Bearer | **poll only** (`lib/byteplusSweep.js`) |
| Stripe | `adapters/stripe.js`, `stripeCreditSubscriptions.js` | Credit Packs (Checkout, Managed Payments, automatic tax); Cinema Pass; Credit Subscriptions (built, `SUBSCRIPTIONS_ENABLED` off). The Publish Plan is decided but not built | Bearer | `Stripe-Signature` HMAC with timestamp tolerance; top-up id in metadata is HMAC-signed |
| Cloudflare R2 | `adapters/r2.js`, `r2Copy.js` | all media | SigV4 | presigned GET/PUT ≤ 15 min |
| Cloudflare Stream | `lib/cinema/stream.js` | Cinema upload (tus) and signed playback | Bearer + signing JWK | webhook HMAC (`webhook-signature`) |
| Cloudflare Access | `lib/accessJwt.js` | admin routes | — | Worker re-verifies the Access JWT |
| Turnstile | `components/Turnstile.jsx` | CAPTCHA on auth | — | verified by Supabase Auth |
| Instagram, LinkedIn, X, TikTok, YouTube, Facebook, Threads, Pinterest, Bluesky, Twitch, Google Business Profile | `adapters/social/*` (the last six: `facebook`, `threads`, `pinterest`, `bluesky`, `twitch`, `gmb`, shared `common.js`; PR #637) | Veyrnox Publish | OAuth2 (PKCE forwarded by X and Business Profile); Bluesky uses a dedicated app password, never stored; tokens AES-GCM encrypted at rest; HMAC-signed state; Facebook, Pinterest and Business Profile destinations chosen from an encrypted, single-use, ten-minute server-side selection (0228) | no inbound webhooks; cron publishes. Pinterest, Business Profile, Twitch, Bluesky and Threads tokens are renewed by the sweeps (atomic rotation, 0228); a durable pre-submission marker stops duplicate public posts (`provider_result_unknown_reconcile_before_retry`) |
| typesafe.ai (Jev) | `lib/jev.js` | classify untyped provider refusals (ADR-0066) | API key | ships `off` |
| Resend | `adapters/resend.js`, `lib/violationEmail.js` | violation notices from `support@veyrnox.ai`; subscription Operator alerts | Bearer | none |
| Montage runner | `lib/montage*.js`, `app/api/webhook/montage` | the video agent: plan, run, signed callback (ADR-0074); the Worker never runs ffmpeg | HMAC-signed request | HMAC over timestamp + raw body, ±300 s, `webhook_events` dedupe; off |

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
| generation attempts | 20 / min (chat turns and the video-agent plan call share it) | ADR-0034, 0113 |
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
and reservation sweeps, Auto Short step sweep, video-agent (montage) sweep
(inert until the runner is configured), asset reap, GrsAI and BytePlus polls,
Veyrnox Publish queue, the Publish analytics sweep (only when
`PUBLISH_ANALYTICS_ENABLED`; also fetches Twitch video statistics when the extended
switch is on), and weekly brand drafts (still the original five networks).

`pg_cron` in Postgres: asset expiry (15 min), stuck-job sweep (10 min), Free
Credit expiry (hourly :41), Subscription Credit expiry (hourly :07, 0184),
referral sweep (hourly :23, 0218), reconciliation snapshot (15 min), recovery
health (15 min), and the nightly `veyrnox-reconcile-balances` (03:17), which
raises on any row from seven checks: balances, Free Credits, top-ups, failed
refunds, Subscription Credits, free allowance, referrals.

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
| `deploy-production.yml` | push main | waits for green `ci`, checks the commit is still tip, `build:worker` + deploy, then `scripts/check-site-health.mjs`; on failure restores the previous deployment and opens a `deploy-failure` issue (a deploy refused for red `ci` opens one too) |
| `reconcile-watch.yml`, `recovery-health.yml`, `signup-gate.yml`, `auth-providers.yml` | hourly | open an issue on drift (reconcile-watch reads the five-count snapshot only; ISSUES S20) |
| `site-health.yml` | every 15 min | live health check; opens one issue per episode |
| `e2e.yml` | daily, manual | Playwright smoke against staging (sign-up, generate, buy; the last two skip without a staging test account) |
| `dependabot-automerge.yml` | PR | auto-merges patch and minor updates once checks pass |
| `fal-catalog-watch.yml` | weekly | fal endpoint/price drift |
| `top-up-backfill.yml` | manual | break-glass backfill |

Cloudflare Workers Builds uploads preview versions for every branch; only
`deploy-production.yml` promotes. Rollback: `wrangler rollback <version>` or
rerun the workflow on an older commit.

## 11. Testing

| layer | tool | where |
|---|---|---|
| unit | `node --test` | `tests/*.test.mjs` (240 files) |
| ledger / DB acceptance | `tsx --test` against real Postgres | `packages/db/*.acceptance.test.ts` (57) |
| integration | scripts against a disposable local DB | `scripts/test-*.mjs` (35) |
| live provider checks | manual scripts | `scripts/verify-*-endpoints.mjs` |
| E2E | Playwright smoke against staging, installed ad hoc (not in `package.json`) | `e2e/`; partly fixed — see ISSUES I5 |

Every state-changing RPC has an idempotency test; every debit path has a
tested refund path.
