# Current state — 25 September 2026

Assessment baseline: `ca9a75a` (origin/main). [Implementation brief](https://chatgpt.com/s/t_6ab64fd555c88191bcadd66e190edb7c), sections 126–128, requires assessment, backlog, then P0 implementation. The original local checkout was `3beaedf`, behind the live database; implementation was moved to current main before finalizing changes. No remote database was changed.

## Verified environment identities

| Environment | Supabase project | Reference |
| --- | --- | --- |
| AI staging | veyrnox.ai staging | yrqzwqywxfesmbvhzjgj |
| AI production | veyrnox-ai-production-eu | xdxdzmsztyzbnzeforxx |

Verified using read-only Supabase project metadata on 25 September. The two other Veyrnox projects belong to another product and are out of scope. Do not query their tables, apply migrations, rotate their credentials or reuse their project IDs. Public project identifiers and publishable keys are configuration, not credentials.

## Existing architecture

Next.js 15 / React 19 / JavaScript / Tailwind runs through OpenNext. `worker.js` adds request body ceilings, admin edge rate limiting, cron-driven recovery and retention. Preserve the current framework, UI, upload and credit flows.

| Area | Evidence | Baseline assessment |
| --- | --- | --- |
| Identity | `lib/supabaseJwt.js`, `middleware.js`, `lib/cinema/strongAuth.js` | EXISTS: bearer-only ES256, issuer/audience/expiry, anonymous rejection, bounded stale JWKS, AAL and recent-MFA context. PARTIAL: issuer-scoped key cache and generic request correlation absent; strict session revocation not universal. |
| Tenant/project model | Existing `users`, jobs and assets | PARTIAL: user ownership. MISSING: organisation/workspace/project membership and reusable project APIs. |
| Database authorization | Supabase migrations through 0133 | EXISTS: RLS/forced RLS, restricted RPCs, replay/ledger acceptance suites. New tenant policies require their own actual-role tests. |
| Billing | Ledger RPCs, free credit expiry, chargeback freeze, payment reconciliation | EXISTS: append-only ledger, transaction locks, debit/rate limit, refund and idempotency. Preserve all later migrations; do not replace with the old 0030 function. PARTIAL: org budgets and reserve/settle accounting. |
| Providers | Generations route, `packages/adapters`, `lib/modelCapabilities.js` | EXISTS: fal, Kie, GrsAI, OpenRouter and VEYRNOX orchestration; server-controlled capabilities/payloads. NEEDS-REFACTOR: registry defined inside route. |
| Generation/editor | Auto Short, Clip Editor, recovery sweeps | EXISTS: multi-step orchestration and editing features. PARTIAL: no tenant-owned canonical saved project/timeline; no Cloudflare Workflows/Queues service decomposition. |
| Storage | `resolveSource`, `uploadSource`, `uploadReservations`, R2 adapter | EXISTS: owned sources, consent, magic/length checks, private signed URLs, bounded downloads, hashes, retention and gated upload reservations. PARTIAL: independent quarantine/moderation pipeline and project lineage. |
| Social | `lib/cinema`, migrations 0132–0133, social-cinema docs | EXISTS: gated profile/creator application/review foundations and MFA. PARTIAL: publication, delivery, voting and monetisation—not a completed social product. |
| Environments | `next.config.mjs`, `wrangler.jsonc`, production deploy workflow | NEEDS-REFACTOR: Next pins production identity for every build, no named staging config. Existing staging/prod databases must be reused. |
| Browser/API security | `next.config.mjs`, `worker.js` | EXISTS: scoped CSP, HSTS, nosniff, framing/permissions controls, request caps. Inline scripts retained for static RSC hydration; preserve narrower R2 sources. |
| Operations | Workflows, migration replay, recovery health | EXISTS: build, unit/ledger tests, audits, sink/credential grep gates, migration ledger and protected serialized deploy. PARTIAL: lint command unusable, no common business audit beyond specific domains. |

This is repository evidence, not certification of live bucket configuration. Migration 0134 is a new additive tenant foundation; existing generation and media remain user-owned until a reviewed transactional project migration is delivered.
