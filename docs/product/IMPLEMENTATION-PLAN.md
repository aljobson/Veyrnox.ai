# Implementation Plan — Veyrnox.ai

**Status:** Current · 2026-10-02 (audited against `main` at `2da81dc`)
**Replaces:** [docs/PHASE-1.md](../PHASE-1.md) as the build sequence (it
still names Clerk, Neon, Inngest and LemonSqueezy). Feature sets keep their
own slice plans; this file orders them.
**Owner priority:** [ROADMAP.md](../../ROADMAP.md) is the owner's draft
priority list. Where this plan and ROADMAP differ, ROADMAP wins on *what*;
this plan wins on *order* (a step never starts before the one it depends
on).

## How to use this

- Do steps **in order within a track**. Tracks B–E can run in parallel once
  track A step A1 is done; each step lists what it needs.
- A step is done only when its **exit check** passes on production (or
  staging, where the step says so).
- Every step that touches the money spine: migration → acceptance test with
  an idempotency case → reconciliation zero rows → ADR updated.
- Before starting, check for a sibling session: `gh pr list`,
  `git branch -r`, `git worktree list`.

## 0. Foundation — done

The order the existing system was built in. An agent rebuilding or
extending a layer depends on everything above it.

| # | layer | evidence |
|---|---|---|
| 0.1 | Cloudflare Worker + OpenNext + Next 15 shell, security headers, CSP | `worker.js`, `next.config.mjs`, ADR-0060 |
| 0.2 | Supabase Auth: email/password, magic link, Google, Apple; Turnstile; confirm email | ADR-0006, 0026, 0030 |
| 0.3 | Gateway: `middleware.js` ES256/JWKS verification, identity headers, typed errors | `lib/supabaseJwt.js` |
| 0.4 | Ledger: users, balances, append-only ledger, debit/refund/grant RPCs, Free Credits | 0001–0038, ADR-0013 |
| 0.5 | Catalog + capability registry, margin floor | `model_catalog`, ADR-0011/0014/0027 |
| 0.6 | Jobs: debit → submit → webhook/poll → R2 copy → STORED; sweep and refunds | 0006–0018, 0099 |
| 0.7 | Providers: fal, kie, OpenRouter, GrsAI (BytePlus staged) | ADR-0009/0020/0058 |
| 0.8 | R2 (EU), presigned URLs, retention + reap, browser uploads | ADR-0008/0021/0028 |
| 0.9 | Credit Packs on Stripe, return + backfill recovery, refunds, disputes, Freeze | ADR-0018/0019/0031/0033 |
| 0.10 | Rate limits, reconciliation snapshot, recovery health, CI watches | ADR-0034–0047 |
| 0.11 | Studio, Library, Explore, Presets, Credits, Account, admin | `app/veyrnox/**` |
| 0.12 | Composites: Auto Short, Clip Editor (flag-gated) | ADR-0029, `docs/editor/` |
| 0.13 | Tenant foundation: orgs, workspaces, projects, document history, media quarantine (**staging**) | 0135–0141, ADR-0051/0055/0056 |
| 0.14 | Social Cinema: profiles → uploads → publication → paywall (**staging**) | 0132–0150, ADR-0048–0059 |
| 0.15 | Veyrnox Publish: 5 networks, scheduling, async engine | 0154–0161, ADR-0061 |
| 0.16 | Receipt redesign of public and money screens | #404, #406 |

## Track A — Launch the core (text-to-media, Credit Packs)

| step | build | needs | exit check |
|---|---|---|---|
| **A1** | Fix pack purchase (ISSUES S1): migration dropping the `variant_id` requirement, acceptance test buying `web-270` | — | test passes; live `/api/v1/top-ups` for each active pack returns a checkout URL |
| A2 | Remove LemonSqueezy (ISSUES I1): route, adapter, vars, config, tests, secrets | A1 | `grep -ri lemonsqueezy app lib packages wrangler.jsonc` empty |
| A3 | ~~Gate Publish (ISSUES P1)~~ — done: `PUBLISH_ENABLED` + Free cap (0169) | — | signed-in user without the flag cannot reach `/api/v1/social/*` |
| A4 | Stripe live evidence (#101): real purchase + refund, dispute/freeze drills, lost-webhook drill | A1 | `docs/operations/credit-pack-launch-acceptance.md` filled in |
| A5 | Ops checklist (#204): email quota or bounded plan, HIBP on, prod admin AAL2 journey, recovery-health alert delivery, DMCA agent | — | every #204 box ticked |
| A6 | Playwright smoke: sign up → confirm → generate → buy (ISSUES I5) | A1 | green in CI against a preview build |
| A7 | 24 h clean reconciliation, then widen sign-up | A4–A6 | reconcile watch silent 24 h; `check:signup-gate` closed |

## Track B — Publish to the public

| step | build | needs | exit check |
|---|---|---|---|
| B1 | Merge #399 (YouTube auth on continuation PUTs, session restart, quota backoff) | — | YouTube test upload reaches `published` |
| B2 | Fix disconnect and claim guards (ISSUES S2, S3) | — | acceptance tests: disconnected account never claimed; stale claim cannot overwrite |
| B3 | Publish Plan (ADR-0062/0063): plan table, account cap, Stripe subscription, entitlement check in the connect route | A1, B2 | Free user blocked at 2nd account; Plan user at 6th; webhook drives status |
| B4 | Platform app reviews (Meta, TikTok, YouTube), TikTok DNS record, token-key rotation runbook | B1 | approvals received |
| B5 | Remove the A3 gate | B3, B4 | Publish in nav for everyone |

## Track C — Core subscriptions (ADR-0064)

| step | build | needs | exit check |
|---|---|---|---|
| C1 | Owner confirms spend order (Subscription Credits first, soonest-expiring first) and non-rollover expiry | — | ADR-0064 amended |
| C2 | Ledger buckets: a credit source column/table so a debit can spend Free → Subscription → Purchased; extend `ledger_debit`, `ledger_refund`, reconcilers | C1 | `reconcile_*` zero rows; refund returns to source; acceptance tests per bucket |
| C3 | Monthly grant + expiry job (keyed `ledger_grant`, `expire_*`) | C2 | replay is a no-op; expiry never touches purchased Credits |
| C4 | Stripe subscription checkout + webhook (`invoice.paid` grants, cancellation, dispute → Freeze) | C3 | test-mode cycle: subscribe, renew, cancel, refund |
| C5 | UI: plans on `/pricing` and `/app/credits`; replace "No subscription" copy (ISSUES P3) | C4 | Finance/Legal wording approved |

## Track D — Uploads and Cinema

| step | build | needs | exit check |
|---|---|---|---|
| D1 | Choose and integrate CSAM hash matching on every upload path (ADR-0025 §8.1) | — | known-hash test file is refused before storage |
| D2 | Cinema fixes: legacy upload removal (S4), creator-status check on unlock (S7), nested `<main>` (U1) | — | acceptance tests |
| D3 | Turn on `CINEMA_SUBSCRIPTIONS_ENABLED` on staging with Stripe test keys; full Pass drill | — | buy, play to ceiling, cancel in cooling-off, refund |
| D4 | Legal: rights/age/territory policy, creator agreement, cooling-off and supply-consent wording; Stripe acceptance for recurring video | — | signed off |
| D5 | Repoint the Stream webhook to production; activate Cinema (#369) — profiles, creators, content, uploads, publishing, viewing | D1, D2, D4 | staging acceptance repeated on production |
| D6 | Turn on unlocks and Pass | D3, D5 | first real unlock reconciles |
| D7 | Face Filters Track A Slices 5–9 | D1 + fal cost data | per `docs/face-filters/IMPLEMENTATION-PLAN.md` |

## Track E — Platform (after A7)

| step | build | needs |
|---|---|---|
| E1 | Projects to production: `TENANT_PROJECTS_ENABLED`, malware scan or explicit decision, staging cleanup cron with R2 credentials | D1 |
| E2 | M03: project-aware generation with reserve/settle, Cloudflare Queues/Workflows for durable jobs | E1 |
| E3 | M04–M08: service-binding extraction, editor timeline, TTS/STT permissions, isolated render queue, publication moderation | E2 |
| E4 | Supply: BytePlus activation after pack safeguards and supplier terms; kie/GrsAI swaps verify-then-activate | — |
| E5 | Passkey enrolment UI (ISSUES P4) once ADR-0032 is accepted | — |

## Hygiene — any time, small PRs

Schema S5, S6, S8–S17 · infra I3, I4, I6–I10 · UI U2–U9 · docs D1–D7 from
[ISSUES.md](ISSUES.md). None of these block a track; batch them by area.

## Not doing

Auto-refill · any wallet, crypto or on-chain feature · LemonSqueezy ·
voice cloning · manual credit grants without an ADR · widening the CSP
without an ADR.
