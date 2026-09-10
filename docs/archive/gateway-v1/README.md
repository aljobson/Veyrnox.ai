# Gateway v1 — Archived Specs (2026-07 → 2026-09)

**Status: NOT SHIPPED. Reference only.**

The `WEEK_1.md` … `WEEK_4.md` documents and the `reference/packages/{db,adapters,catalog}` code in this directory describe an ambitious rewrite of Veyrnox into a standalone Cloudflare Workers gateway with:

- D1 ledger + append-only entries + idempotent debit
- Job state machine + outbox relay
- fal.ai / Replicate / Stripe / DeepSeek-moderation adapters
- Cloudflare R2 signed URLs
- Presets, premium gating, margin-floor CI

The **specs and scaffolding never became production code**. Evidence at the time of archiving:

- `wrangler.jsonc` had no D1, R2, KV, or Queues bindings
- No `src/worker/gateway.ts` or `src/index.ts` in the tree
- Zero call sites for `FalAdapter`, `ReplicateAdapter`, `Ledger`, `JobState`, `outbox`, `debit`, `createJob` in shipped code
- `packages/db/*` and `packages/adapters/*` were orphan library scaffolding
- 10 audit remediation rounds (R1 → R10) hardened the actual production surface: the Next.js app under `app/` with `app/api/*` proxies to MuAPI

The shipped Veyrnox product is a hardened MuAPI-proxy web app, not a standalone gateway.

## What lives here

- `WEEK_1.md` — Ledger & Debit Transaction spec
- `WEEK_2.md` — Job State Machine + fal.ai Adapter + Outbox Relay spec
- `WEEK_3.md` — Stripe Integration & Grant Management spec
- `WEEK_4.md` — Adapter Batch 1 + Failover + Margin Validation spec
- `reference/packages/db/` — TypeScript stubs for ledger, job-state, failover, grants, R2 URLs, presets, premium-gating, margin-validator
- `reference/packages/adapters/` — Stub adapters: fal, replicate, stripe, deepseek-moderation, types
- `reference/packages/catalog/` — Stub catalog re-exporting from `packages/studio/src/models.js` plus a `PRICES` map
- `reference/ledger.acceptance.test.ts` — Never-run acceptance tests targeting the D1 ledger

## Why archive rather than delete

Some of this scaffolding is worth keeping as reference if the gateway direction is ever revisited: the ledger transaction shape, webhook signature invariants (fal ed25519 vs Replicate HMAC), the outbox pattern, and the margin-floor gate encode real thinking. Deleting loses that. Archiving keeps them out of the build graph while preserving the record.

## What NOT to do with this directory

- Do not import from it in shipped code.
- Do not treat the specs as a live roadmap.
- Do not resurrect pieces of it without a fresh design pass — the assumptions here were written before 10 rounds of security work on the actual product.
