# ADR-0049 — Rendering prerequisite for nonce CSP

Status: Proposed; rendering scope not yet accepted. Tracks #4.

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

This ADR changes no headers or rendering. Approval of a rendering strategy
and the production-mode proof precede the implementation rollout. The pending
choice comes from next.config.mjs's documented architecture/cost prerequisite,
not from a requirement to obtain permission for routine code edits.
