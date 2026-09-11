# Veyrnox.ai — Claude Code project rules

Ship the money spine. Every rule below exists to keep credits, secrets, and user
data safe under real load. Break any of them only with an ADR that explains why.

## Ground rules

- Do what was asked. Don't add speculative features, abstractions, or comments.
- Read the file before editing it. Prefer editing over creating.
- Keep files under 500 lines. Cross-file refactors need a plan.
- Never commit secrets, `.env*`, service-role keys, or private R2 credentials.
- `NEXT_PUBLIC_*` and Supabase anon key ARE safe to commit — they're public.
- Never add `Co-Authored-By` to a git commit unless `.claude/settings.json`'s
  `attribution.commit` is set. The Bash tool suggests one by default — ignore it.

## Bundler traps — the three libraries that break Cloudflare Workers Builds

Tripwires from PRs #25, #27, #38, #40:

- **`tsx`** in root `devDependencies` -> build fails. Install ad-hoc in CI.
- **`jose`** anywhere on the SSR import graph -> build fails. Use Web Crypto
  (`crypto.subtle.importKey`, `crypto.subtle.verify`) directly.
- **`@supabase/supabase-js`** anywhere the transpiled `packages/studio` bundle
  drags in -> build fails. Auth UI + auth client live under `app/` and
  `components/` and use plain `fetch` against `/auth/v1/*` and `/rest/v1/*`.

If a build starts failing after a dependency change, bisect these three first.

## Database (Supabase Postgres)

- **RLS on every user-facing table**, and `FORCE` it. Service-role bypasses RLS
  by design; the Worker uses service-role, the browser never talks to Postgres.
- **Ledger is append-only** — enforced by trigger `ledger_entries_append_only`.
  Never `UPDATE` or `DELETE` a ledger row. Corrections are compensating rows
  (positive delta = refund/grant, negative = debit).
- **Balance invariant**: `credit_balances.balance = SUM(ledger_entries.delta)`
  per `user_id`. Every mutation goes through `ledger_debit` / `ledger_refund` /
  `ledger_grant` / `signup_grant` RPC — never a raw `INSERT INTO ledger_entries`
  or a raw `UPDATE credit_balances`.
- **Idempotency**: every state-changing RPC takes an idempotency key
  (`jobs.idempotency_key` UNIQUE on `(user_id, idempotency_key)`,
  `webhook_events` UNIQUE on `(source, external_id)`). Replay must be a no-op.
- **SECURITY DEFINER** functions must `SET search_path = ''` (schema-qualify
  every reference) so a user can't hijack them by shadowing an unqualified name.
- Migrations live in `packages/db/schema/supabase/`. Apply via the Supabase MCP
  `apply_migration` tool with a `NNNN_<snake_case>` name — never `execute_sql`
  for DDL. Every migration must be idempotent (`IF NOT EXISTS`, `OR REPLACE`).
- No raw string interpolation into SQL. `execute_sql` takes user input only
  through parameters; PostgREST filters go through `encodeURIComponent`.
- Reconciliation nightly (`ledger.reconcile()`) must return zero rows in prod.

## API gateway (`/api/v1/*`)

- Middleware `middleware.js` gates every `/api/v1/*` path. Reject unauthenticated
  requests with 401. It verifies the Supabase JWT with **ES256 + JWKS via Web
  Crypto**. Never re-introduce HS256 shared-secret verification.
- After verification, forward identity in server-side headers only:
  `x-veyrnox-auth-id`, `x-veyrnox-auth-email`, `x-veyrnox-auth-role`.
  Overwrite any inbound header of the same name — a client must never spoof it.
- Standard-claim checks (issuer, audience `authenticated`, exp with 5s skew, sub
  present) run on every request. Missing/malformed -> 401, never 500.
- Rate limit at the entry point. Baseline: 10 gens per user per 60s via the
  Postgres-backed sliding window (`check_generation_rate_limit`).
- Validate every input against a regex or schema at the boundary. See
  `IDEMPOTENCY_RE` in `app/api/v1/generations/route.js` as the pattern.
- Return typed errors: `{error: "kebab_case_code", ...}`. Don't leak stack
  traces, DB messages, or upstream vendor payloads.
- No CORS wildcards on `/api/v1/*` — same-origin only. Studio proxies through
  the same host.

## Identity & sessions

- Supabase Auth is the only identity source. Providers: email/password, Apple,
  Google (see `AuthGate.jsx`).
- Anon key + Supabase URL live in `wrangler.jsonc` `vars` (public). Service-role
  key is a `wrangler secret` — never `NEXT_PUBLIC_*`, never in the client bundle.
- Client session in `localStorage['veyrnox_supabase_session']`. Never send
  refresh tokens in URL parameters. OAuth callback parses the URL fragment
  (`#access_token=...`) in `app/auth/callback/page.js` and clears it.
- Password minimum 8 chars enforced client-side; Supabase enforces its own
  server-side rules — don't bypass. No password logs, no password telemetry.
- Sign-out revokes the Supabase session (`POST /auth/v1/logout`) AND clears
  `localStorage`. Both, always.
- OAuth `redirect_to` MUST be an origin we control. Never accept a return URL
  from user input; construct it from `window.location.origin`.
- The `auth.users -> public.users + credit_balances + grant:signup` trigger
  (migration `0010`) is the only path that provisions a user. Do not create
  `public.users` rows any other way.

## Web security

- **CSP** in `next.config.mjs` is `default-src 'self'`. `connect-src` allows
  only `'self'` + the Supabase project host. Adding a host means an ADR.
  `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`.
- **HSTS** `max-age=63072000; includeSubDomains; preload`. Never lower.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- No `dangerouslySetInnerHTML` with unsanitized input. If you must, sanitize
  with a library on the SSR path (jsdom + DOMPurify) — never trust the client.
- Never build a URL from user input without `encodeURIComponent`.
- CSRF: same-site cookies aren't in play (we're Bearer-only), but any state-
  changing GET is forbidden. Mutations are POST/PUT/PATCH/DELETE only.

## Provider webhooks (fal.ai, Stripe/Lemon, etc.)

- Every webhook verifies a cryptographic signature. Fal is Ed25519 via JWKS
  (see `packages/adapters/fal.js#verifyWebhookSignature`). Stripe is HMAC with
  replay window <=5 min. Missing/invalid signature -> 401, never 200.
- Every webhook is idempotent via `webhook_events(source, external_id)`.
  Duplicate -> early return, no side effects.
- Webhook handlers must not trust the payload's `user_id`. Look the job up
  by `id` and use its `user_id`.
- Webhook host lives at `PUBLIC_HOST` env; construct callback URLs from that,
  never from `req.headers.host` or `req.url`.

## Secrets & credentials

- Secrets set via `wrangler secret put` — never in `wrangler.jsonc`, never in
  `.env` committed to git.
- Rotate any secret that leaves the machine (posted in Slack, pasted into a
  chat) within 24 hours.
- `SUPABASE_SERVICE_ROLE_KEY`, `FAL_KEY`, `R2_SECRET_ACCESS_KEY` — service
  credentials. Never log them, never echo them, never mirror to `NEXT_PUBLIC_*`.
- `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` —
  public. `wrangler.jsonc` `vars` is the right home.

## Object storage (R2)

- SigV4 signing lives in `packages/adapters/r2.js` — Web Crypto only, no
  `@aws-sdk`.
- Every asset is scoped to `job_id` and to the job's `user_id`. Presigned GET
  URLs are minted only through `get_user_asset` RPC, which enforces ownership.
- Presigned URL TTL <=15 min. Longer TTLs need an ADR.
- R2 keys use random UUIDs, never user-controlled paths.

## Money & billing

- The catalog is normative for pricing (`model_catalog.credits_5s`). Never
  compute a price in the app layer.
- A model is only `active = true` when its `provider_endpoint` has been verified
  against the live provider. Falsy endpoints = guaranteed refund cycles and
  wasted user experience.
- Every debit path has a matching refund path on submit failure, provider
  failure, or user-cancel. Test both.
- Never grant credits outside `signup_grant` / `ledger_grant`. Manual grants
  need a written ADR and a `reason` field that identifies the human who made
  the decision.

## OWASP Top 10 — how each is handled

1. **Broken Access Control** — RLS + service-role-only Worker + JWT sub check.
2. **Cryptographic Failures** — TLS everywhere, ES256 JWT, SigV4 to R2, Ed25519
   webhooks. No self-rolled crypto, only Web Crypto primitives.
3. **Injection** — parameterized SQL, `encodeURIComponent` for PostgREST
   filters, JSON schema at the API boundary, no shell interpolation of user
   input in scripts.
4. **Insecure Design** — append-only ledger, idempotency keys, RPC-only
   writers, reconciliation job.
5. **Security Misconfiguration** — `wrangler.jsonc` reviewed on every PR, CSP
   / HSTS / CORS locked, no debug endpoints in prod, no default credentials.
6. **Vulnerable & Outdated Components** — Round-N dependency audits run on
   every green main. Any critical/high CVE is a same-day PR.
7. **Identification & Authentication Failures** — Supabase Auth handles rate
   limits, breach checks, and lockout. Middleware rejects malformed tokens.
8. **Software & Data Integrity Failures** — migrations in git, RPC-only writes,
   R2 objects immutable after upload.
9. **Security Logging & Monitoring Failures** — `console.error` for every
   security-relevant failure (auth reject, webhook signature fail, ledger
   invariant violation). Wrangler tail is the tail-view.
10. **Server-Side Request Forgery** — outbound fetch targets are constants
    (`FAL_QUEUE_BASE`, `SUPABASE_URL`, `PUBLIC_HOST`), never derived from user
    input.

## Testing & CI

- Ledger acceptance tests (`packages/db/ledger.acceptance.test.ts`) must pass
  against a real Postgres before merging any RPC change.
- Every state-changing RPC has an idempotency test.
- No test writes to the shared staging DB without cleaning up. Prefer local
  Docker Postgres for destructive tests.
- CI enforces: build succeeds, tests pass, no `dangerously-` prefix new usage,
  no `console.log(secret)` patterns.

## Delivery

- `main` is deployable at all times. Cloudflare Workers Builds deploys every
  push. Break-glass rollback: `wrangler rollback <version-id>`.
- Feature flag new user paths behind `localStorage.veyrnox_*` until the DB
  migration has landed and the reconciliation job has run for 24h clean.
- Every PR touching the money spine (ledger, jobs, webhooks) needs an ADR
  update if behavior visible to the user or auditor changes.
