# ADR-0049 — Rendering prerequisite for nonce CSP

Status: Proposed; isolated app/auth implementation proof in draft PR #322.
Production rendering scope not yet accepted. Tracks #4.

## Verified baseline — 25 September 2026

At main ccb21be, next.config.mjs supplies a static CSP with script-src
'unsafe-inline'. middleware.js already exists and gates only /api/v1/*;
it must be extended, not recreated. Canonical /app routes rewrite to
/veyrnox/app; those aliases redirect. A read-only HEAD to production /app
returned HTTP 200, script-src 'unsafe-inline' and
Cache-Control: s-maxage=31536000. This is a header baseline, not a browser
hydration test or proof of nonce compatibility.

Next's [nonce guide](https://nextjs.org/docs/app/guides/content-security-policy)
requires dynamic rendering to attach a fresh request nonce to framework and
inline scripts. This repository uses Next 15.5.25 and OpenNext Cloudflare;
compatibility must be demonstrated on that installed stack, not inferred from
current Next documentation or the old issue's upstream blocker alone.

## Options and proposed sequence

| Option | Benefit | Cost / limit |
| --- | --- | --- |
| Whole-site dynamic rendering and nonce CSP | One policy; includes shared-origin public pages | Removes static HTML caching benefits; measure Worker/latency cost and hydration before acceptance |
| App/auth route proof first | Bounds the first experiment; marketing can remain static during investigation | Does not close #4; public pages share the origin and token storage, so residual injection risk remains |
| Keep static pages while investigating a supported hash strategy | Preserves caching | Not assumed supported; requires separate proof for inline RSC scripts and the installed OpenNext build |

Recommend an isolated app/auth proof first, followed by an explicit whole-site
or alternative strategy decision. Do not claim partial nonce coverage protects
all sessions: public pages can contain login UI and share localStorage with the
app. The mobile /m tree is a sample-data prototype, not automatically an
authenticated application; classify it intentionally in the final policy.

## Implementation PR contract

1. Preserve the existing API JWT verification and inbound identity stripping.
   Add page handling without forcing HTML navigation to supply a Bearer token.
2. Generate a cryptographically random nonce for each HTML request. Overwrite
   inbound nonce/CSP headers. Forward the generated CSP in request headers so
   Next can nonce its framework/flight scripts; use the same policy on response.
3. Make the chosen route layouts dynamic and disable shared HTML caching.
   Test canonical routes, internal redirects, rewrites, errors and RSC navigation.
   A middleware nonce on statically generated HTML is not a valid solution.
4. Remove production script-src 'unsafe-inline' only where rendering and all
   script consumers are compatible. Keep development-only HMR allowances
   separate; do not widen production hosts or weaken other security directives.
5. Thread the nonce into explicit Script/inline consumers, including Turnstile.
   Verify the final response has no conflicting static CSP header.
6. Retain rollout/rollback controls and measure latency/cache/Worker impact.
   A configured CSP-report endpoint, if added, must be bounded and must not
   persist session URLs or credentials.

## Required proof before closing #4

- Production-mode OpenNext/Workers preview build; no dev-server-only proof.
- Two independent responses have different nonces, matching their inline scripts.
- An injected script without an approved nonce is blocked.
- No nonce reuse through HTML caches or stale RSC/prefetch responses.
- Real-browser initial hydration, client navigation, login, OAuth return,
  Turnstile, generation controls and Stripe-return handling remain functional.
- Security headers and JWT/session regression tests pass; console/CSP errors
  are investigated; public-page scope and residual risk are recorded.
- Whole issue scope is satisfied, or the owner explicitly revises it and tracks
  remaining routes separately. A partial experiment must not auto-close #4.

## Rollout

PR #322 includes a preview implementation: dynamic app/auth layouts, fresh
128-bit nonces supplied to Next through request CSP, matching response CSP and
private/no-store responses. Static public pages retain their current policy.
The static CSP header rule excludes app/auth; the first Workers probe caught
OpenNext appending the fallback policy when it covered every path.

Keep the PR draft until the proof and final scope decision are complete. Do not
merge this experiment as whole-site protection. Public-to-app client navigation
can retain the original document policy; app-to-public navigation and error
rendering also need explicit coverage. The original static-rendering cost
prerequisite remains applicable.

## Reproducing the preview

Use Node 22/npm 10 with the committed lockfile, then `npm run build:worker`.
Start `wrangler dev --local --port 8795` and run
`node scripts/check-nonce-runtime.mjs`. The probe requires fresh nonces, matching
inline framework scripts, no script unsafe-inline, no shared caching, and a
working scoped 404. It deliberately fails on missing coverage.

The installed local workerd was too old for the configured 2026-09-01
compatibility date. The isolated test used workerd 1.20260925.1 via
MINIFLARE_WORKERD_PATH; no production date or dependency lockfile was changed.
Local timing is diagnostic only and does not establish production cost.
Browser login dialog opened successfully; Turnstile reported error 300030 on
localhost. Successful CAPTCHA, OAuth, authenticated generation and payment
return journeys therefore remain unproven.

## Preview results — 25 September 2026

- Node 22 build:worker completed on Next 15.5.25 / OpenNext Cloudflare 1.20.2.
- Application tests: 603 passed, one pre-existing skip; hard-wall passed.
- HTTP probe passed twice on /app, /app/credits, /app/account, /app/create,
  /app/library, /auth/callback and /app/not-a-page (404). All 14 nonces were
  distinct; each response's 5–8 executable inline scripts matched its nonce,
  and each had no-store and no script unsafe-inline. Public / kept its fallback.
- Local request times were 731ms for the first /app response and 25–71ms for
  the remaining requests. These are single-machine samples, not a benchmark.
- Real browser: initial app hydration, app-to-create navigation, sign-in modal
  and app-to-legal navigation worked. A dynamically appended inline script
  without a nonce was blocked on a freshly loaded app document.
- **Confirmed scope blocker:** navigating from public / to /app with the
  existing client link retained the permissive public document policy. The
  same harmless inline execution probe then ran. Reloading /app restores its
  nonce policy. A scoped rollout must enforce full-document boundary navigation,
  or the final strategy must cover every shared-origin document. Merely adding
  CSP to app RSC responses cannot change the current document's policy.
- Local Turnstile error 300030 prevents successful CAPTCHA proof. Authenticated
  OAuth/payment/generation journeys and production cost remain outstanding.

The browser probes changed only temporary local test-page state and were
removed/reloaded. No credentials, payments or production content were changed.
