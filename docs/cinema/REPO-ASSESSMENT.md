# Veyrnox Cinema repository assessment

Assessed 25 September 2026 against main `2f60cec` before implementation.
Source: [Cinema specification v1.0](https://chatgpt.com/s/t_6ab643224f9881919a05694d64a5a7dc), sections 1–125. This is EPIC 0. The original `docs/social-cinema/README.md` and 01–09 source files remain intact; this newer source expands the product and takes precedence where requirements differ. The source's examples are proposals, not evidence of deployed infrastructure.

## Existing architecture and reusable components

| Area | Repository evidence | Cinema integration |
| --- | --- | --- |
| Frontend | `package.json`: Next 15, React 19; `app/veyrnox`, Tailwind tokens, shared navigation, Button, AuthGate and AccountBoundary | Extend the existing app and design. No second frontend or login. |
| Edge | `worker.js` wraps OpenNext; `wrangler.jsonc` configures assets, cron, observability and an admin rate limiter | Reuse Worker deployment and versioned Next route handlers. |
| Database | `packages/db/schema/supabase/0003…0132`; native fetch RPC client; forced RLS; narrow service-role-only functions | Retain Supabase Postgres. Reuse numbered, reviewed migrations and isolated replay tests. |
| Identity | `middleware.js`, `lib/supabaseJwt.js`, `app/lib/authClient.js`, `components/AuthGate.jsx` | Reuse verified ES256 subject, issuer/audience/expiry validation, JWKS rotation, Apple/Google/email UI and session refresh. Live provider configuration still needs end-to-end verification. |
| Existing Cinema foundation | Migration 0132, ADR-0048, `/api/v1/social-cinema/profile`, `/social-cinema` | Opt-in profile, private role/status, owner read and idempotent create already exist. No account duplication or backfill. |
| Studio | `app/veyrnox/app`, existing generation tools; `_lib/cinema.js` is camera-prompt configuration | Keep generation Studio distinct from entertainment catalogue and creator publishing. |
| Storage | `packages/adapters/r2.js`, `r2Copy.js`; credentials reference an existing bucket through SigV4 | Reuse asset ownership patterns. R2 is not the new film streaming backend. Exact production bucket is secret configuration, not inferable here. |
| Billing | `packages/adapters/stripe.js`, `/api/webhook/stripe`, top-up RPCs and append-only credit ledger | Existing Stripe sells one-off generation Credit Packs. Cinema subscriptions and creator cash earnings need separate records and event dispatch. Never reinterpret credits as creator money. |
| Security | Bounded body readers, durable account quota, verified internal identity headers, AAL2, Cloudflare Access on admin routes | Reuse these boundaries. User metadata cannot grant Cinema roles. |
| CI/release | `ci.yml`, `ledger-tests.yml`, `verify.yml`, hard-wall and migration-ledger checks; `deploy-production.yml` serializes deployment after green CI | Focused squash PRs. Schema deployment uses owner-approved `apply-migrations.yml`; do not mutate production manually. |

## Database impact and architectural conflicts

The source assumes D1 is the current application database. This repository has **no D1 binding or migrations**. Its user provisioning, financial invariants, reconciliation, row locks, foreign keys, RLS, idempotency and account deletion already live in Supabase Postgres. Introducing a second account/ledger database would split those controls. Under source sections 123–124, retain the stronger existing design and document this deliberate adaptation. No D1 migration is needed for the foundation; future Cinema tables belong in the existing numbered Postgres migrations.

The source suggests a JOSE library; `CLAUDE.md` records SSR build failures with `jose` and `supabase-js`. Keep the tested Web Crypto verifier and native fetch Auth client. Do not create a second verifier or trust unverified token claims.

The source proposes automatic application-user creation. Existing Auth triggers are the only user provisioning path; Cinema profiles remain opt-in. Keep the distinction between billing Frozen status and Cinema moderation status. Preserve the private role boundary from ADR-0048; later multi-role capabilities need an additive migration and audited administration, not an edit to applied 0132.

The source's nested error object differs from the established gateway's string `error` codes. Keep the existing contract and add request correlation without breaking consumers. Use `/api/v1`; protect private handlers with existing middleware. Public catalogue access must be explicitly designed, not exempt all Cinema endpoints from auth.

## Cloudflare impact

No D1, Stream, Queues, Durable Objects, Workflows, Workers AI, Vectorize or Images bindings are configured in `wrangler.jsonc`. Only assets and the admin rate limiter are bound. There are no service bindings. R2 is used through the existing adapter, not a binding. Do not claim those proposed services are already available.

Add Stream direct/tus sessions and signature-verified webhooks after creator/content ownership and quota records exist. Large video bytes must go directly to Stream. Add specific upload/playback CSP hosts under an ADR; do not widen to arbitrary hosts. Queue consumers need idempotency, retry/dead-letter handling and separate environment resources. Durable Objects and Workflows should be introduced only with the first feature that needs coordination or durable execution. Semantic recommendations are later-phase work.

## Security and billing impact

New trust boundaries: creator-owned content; moderation and publication authority; direct upload grants; Stream webhook signatures; entitled playback; subscription provider events; qualified viewing; earnings and payouts. Each needs negative tests and replay/concurrency tests. A valid JWT does not override a banned Cinema account. A creator cannot approve their own content, grant monetisation or choose payout balances. Admin and payout changes require verified AAL2 and audited server-side roles.

Stripe Connect, subscription products, creator contracts, entitlement expiry, refunds and cash ledger reconciliation are not implemented. Prices/revenue shares in the source are indicative, not production launch decisions. Use integer minor units and explicit currency, immutable accounting and compensating reversals. Existing top-up handling must continue unchanged. No Apple/Google mobile application or purchase integration exists in this repo; those adapters belong with an actual mobile client and provider setup.

## Proposed PR sequence

1. **Foundations**: this assessment, Cinema routes, default-off server feature flags, domain contracts and tests. Reuse migration and API frameworks.
2. **Auth and creator applications**: reuse Auth, enforce active account and server roles; add creator application, audited AAL2 approval and safe public profiles. Verify OAuth in preview.
3. **Content**: creator-owned drafts, films/shorts/trailers, series/seasons/episodes, structured AI disclosures and versioned rights declarations. Test creator-to-creator isolation and repeat mutations.
4. **Stream**: direct/tus sessions, quota reservations, cancellation/retry/resume, signed webhook processing and processing UI. Verify in isolated Stream environment.
5. **Viewer**: service-driven catalogue, content/series pages, entitlement-gated playback, watch progress/history/watchlist. Empty states must remain honest until approved content exists.
6. **Social**: follows, competitions, qualified votes, comments and reports with durable uniqueness/rate limits.
7. **Subscriptions**: configured plans, Stripe subscription events, entitlement expiry/revocation and replay-safe webhooks.
8. **Creator revenue**: qualified viewing, configurable net-revenue allocation, immutable cash ledger, estimates/holds/reversals and reconciliation.
9. **Connect**: onboarding, MFA-protected payout changes, durable settlement, payout status and provider reconciliation.
10. **Moderation**: build publication checks alongside content; then cases, appeals, console and specialist safety integration.
11. **Analytics**: idempotent event ingestion/queues, creator metrics, rankings, trending and rising creators.
12. **Hardening and launch**: cross-feature abuse tests, Turnstile, review WAF, accessibility, performance, complete creator-to-payout journey.

Each feature PR includes implementation, relevant tests, documentation, schema/security/deployment implications. Foundations do not mean the later epics are complete.

## Risks and open decisions

- Live Stream configuration, isolated environments, webhook secrets and approved playback domains cannot be established from source; verify before activation.
- Reconcile existing opt-in single membership role with the later multi-role model without granting privileges through signup or metadata.
- Creator agreement, rights text/version, age/region policy, supported territories and currencies need product decisions before publication or paid launch.
- Subscription pricing, creator split, settlement reserve and payout thresholds are configuration proposals; do not charge or pay using unapproved defaults.
- Existing `npm run lint` invokes deprecated `next lint` and prompts for missing configuration; establish a noninteractive ESLint invocation before claiming lint passes. TypeScript is concentrated in DB/catalog; frontend/routes use JavaScript.
- Registration is currently gated. Follow the repository's migration plus 24-hour clean reconciliation requirement before activation, and verify authenticated browser flows in preview.
- The website entry exists after PR #325, but catalogue/playback/upload/voting/monetisation do not. No fixture content should imply otherwise.
