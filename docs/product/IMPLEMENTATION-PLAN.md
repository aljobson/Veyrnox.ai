# Implementation Plan — Veyrnox.ai

**Status:** Current · 2026-10-08 (audited against `main` at `42150476`; first
written 2026-10-02 at `2da81dc`)
**Replaces:** [docs/PHASE-1.md](../PHASE-1.md) as the build sequence (it
still names Clerk, Neon, Inngest and LemonSqueezy). Feature sets keep their
own slice plans; this file orders them.
**Owner priority:** [ROADMAP.md](../../ROADMAP.md) is the owner's draft
priority list. Where this plan and ROADMAP differ, ROADMAP wins on *what*;
this plan wins on *order* (a step never starts before the one it depends
on).

## How to use this

- Do steps **in order within a track**. Tracks B–G can run in parallel once
  track A step A1 is done (it is); each step lists what it needs.
- A step is done only when its **exit check** passes on production (or
  staging, where the step says so).
- Every step that touches the money spine: migration → acceptance test with
  an idempotency case → reconciliation zero rows → ADR updated.
- Before starting, check for a sibling session: `gh pr list`,
  `git branch -r`, `git worktree list`. Open PRs on 2026-10-08: #369 (Cinema
  activation), #364 (Cinema cloud imports), #361 (local Video Enhance
  prototype), #616 (dependency bump).

## 0. Foundation — done

The order the existing system was built in. An agent rebuilding or
extending a layer depends on everything above it.

| # | layer | evidence |
|---|---|---|
| 0.1 | Cloudflare Worker + OpenNext + Next 16 shell, security headers, CSP | `worker.js`, `next.config.mjs`, ADR-0060 |
| 0.2 | Supabase Auth: email/password, magic link, Google, Apple, passkeys; Turnstile; confirm email | ADR-0006, 0026, 0030, 0032 |
| 0.3 | Gateway: `middleware.js` ES256/JWKS verification, identity headers, typed errors | `lib/supabaseJwt.js` |
| 0.4 | Ledger: users, balances, append-only ledger, debit/refund/grant RPCs, Free Credits | 0001–0038, ADR-0013 |
| 0.5 | Catalog + capability registry, margin floor | `model_catalog`, ADR-0011/0014/0027 |
| 0.6 | Jobs: debit → submit → webhook/poll → R2 copy → STORED; sweep and refunds | 0006–0018, 0099 |
| 0.7 | Providers: fal, kie, OpenRouter, GrsAI (BytePlus staged) | ADR-0009/0020/0058 |
| 0.8 | R2 (EU), presigned URLs, retention + reap, browser uploads | ADR-0008/0021/0028 |
| 0.9 | Credit Packs on Stripe, return + backfill recovery, refunds, disputes, Freeze; LemonSqueezy removed (0180) | ADR-0018/0019/0031/0033 |
| 0.10 | Rate limits, reconciliation snapshot, recovery health, CI watches | ADR-0034–0047 |
| 0.11 | Studio, Library, Explore, Templates, Credits, Account, admin; Tools, Guides, model pages, Popular | `app/veyrnox/**`, ADR-0072 |
| 0.12 | Composites: Auto Short, Clip Editor (flag-gated), Clip Editor captions (**live**, 0225) | ADR-0029, `docs/editor/` |
| 0.13 | Tenant foundation: orgs, workspaces, projects, document history, media quarantine (**staging**) | 0135–0141, ADR-0051/0055/0056 |
| 0.14 | Social Cinema: profiles → uploads → publication → paywall (**staging**) | 0132–0150, ADR-0048–0059 |
| 0.15 | Veyrnox Publish: 5 networks, scheduling, async engine, drafts, analytics, calendar, device uploads (**built, dark in production**) | 0154–0161, 0182, 0188–0192, 0223, ADR-0061 |
| 0.16 | Receipt redesign of public and money screens | #404, #406 |
| 0.17 | DB hardening: claim guards, unique ledger backstops, default-privilege revoke, FK indexes, TRUNCATE guards | 0167–0178 (S1–S16) |
| 0.18 | Subscription Credit ledger bucket and reconcile (applied) | 0183–0185, ADR-0064 |
| 0.19 | LLM Chat (**live**): replies as jobs, ten models, Thinking, capped Web search, image/video attachments, folders, Personas, Studio skills | 0193–0203, 0210–0216, 0220, 0226; ADR-0067/0068/0072/0073 |
| 0.20 | Free allowance (**live**, two models) | 0205–0207, 0222; ADR-0069 |
| 0.21 | Referrals (**live**) | 0217–0219; ADR-0071 |
| 0.22 | Delivery safety: health-checked deploys with rollback, 15-min `site-health`, hourly `auth-providers`, Dependabot auto-merge, Playwright smoke | #427, #428, #436, #453 |

## Track A — Launch the core (text-to-media, Credit Packs)

| step | build | needs | exit check |
|---|---|---|---|
| ~~A1~~ | **Done.** Pack purchase fixed (ISSUES S1): 0167 applied; `/api/credit-packs` lists all four packs | — | a real purchase of each pack is still part of A4 |
| ~~A2~~ | **Done in code** (0180, #424); only two comments name LemonSqueezy. Residual: delete the two Worker secrets (ISSUES I1, unverified) | A1 | `ls app/api/webhook` has no `lemonsqueezy` |
| ~~A3~~ | **Done.** Publish gated (`PUBLISH_ENABLED="false"`) and Free capped (0169) | — | `/api/v1/social/*` answers 503 `publish_not_open` |
| A4 | Stripe live evidence (#101, open): real purchase + refund, dispute/freeze drills, lost-webhook drill | A1 | `docs/operations/credit-pack-launch-acceptance.md` filled in |
| A5 | Ops checklist (#204, open): email quota or bounded plan, HIBP on, prod admin AAL2 journey, recovery-health alert delivery, DMCA agent | — | every #204 box ticked |
| A6 | Playwright smoke exists (`e2e/`, daily `e2e.yml`; sign-up runs); generate and buy wait for a staging test account in `E2E_EMAIL`/`E2E_PASSWORD` (ISSUES I5) | A1 | green in CI against staging with the account set |
| A7 | 24 h clean reconciliation, then widen sign-up | A4–A6 | reconcile watch silent 24 h; `check:signup-gate` closed |
| A8 | Close the reconcile gap: add `reconcile_free_allowance()` and `reconcile_referrals()` to the snapshot, `reconcile_status()` and `check-reconcile.mjs` (ISSUES S20) | — | the hourly watcher fails on a seeded drift in either |

## Track B — Publish to the public

| step | build | needs | exit check |
|---|---|---|---|
| ~~B1~~ | **Done** (#399): YouTube auth on continuation PUTs, session restart, quota backoff | — | a YouTube test upload reached `published` on staging 2026-10-07 |
| ~~B2~~ | **Done** (0168): disconnected accounts are never claimed; only the live claim may report | — | acceptance tests |
| B3 | Publish Plan (ADR-0062/0063): plan table, account cap above Free, Stripe subscription, entitlement check in the connect route. **Not started** — no `publish_plan` code | A1 | Free user blocked at 2nd account (already true); Plan user at 6th; webhook drives status |
| B4 | Platform app reviews (Meta, TikTok, YouTube), TikTok DNS record, token-key rotation runbook | B1 | approvals received; then enable `INSTAGRAM_INSIGHTS_SCOPE_ENABLED` / `TIKTOK_ANALYTICS_SCOPE_ENABLED` |
| B4a | Owner picks an Instagram Business/Creator account for publish and analytics acceptance (`ACCEPTANCE-2026-10-07.md` §Next) | B4 | a real Instagram post and its insights recorded |
| B4b | Production activation order once B3/B4 land: migrations are already applied; set `PUBLISH_ENABLED`, then `PUBLISH_ANALYTICS_ENABLED`, `PUBLISH_POSTING_INSIGHTS_ENABLED`, `PUBLISH_UPLOADS_ENABLED` one at a time (uploads also need CSAM hash matching, D1) | B3, B4, D1 | each flip verified in the browser |
| B5 | Remove the A3 gate | B3, B4 | Publish in nav for everyone |

## Track C — Core subscriptions (ADR-0064)

| step | build | needs | exit check |
|---|---|---|---|
| ~~C1~~ | **Done** (accepted 2026-09-28; owner decisions on cancellation, failed renewal and plan changes recorded 2026-10-03) | — | ADR-0064 amended |
| ~~C2~~ | **Done** (0183, 0184, 0185; applied). Ledger buckets: spend Subscription → Free → Pack, refunds to source, `reconcile_subscription_credits()` | C1 | five reconcile counts zero |
| ~~C3~~ | **Done** (0183, 0184; applied). Monthly grant + hourly expiry sweep | C2 | replay is a no-op |
| C4 | **Built, default-off, applied.** Database (0186, 0187, 0189), `stripeCreditSubscriptions.js`, checkout/read/return/cancel routes, webhook (#514), renewal and failed-payment tests (#525), ended-checkout fix (#526). `SUBSCRIPTIONS_ENABLED="false"` in production **and** staging. Remaining: staging Stripe test keys and Resend/Operator-alert secrets, every box in `docs/operations/credit-subscription-acceptance.md`, Stripe's written acceptance, Finance/Legal wording | C3 | test-mode cycle: subscribe, renew, cancel, refund |
| C4a | Plan changes (upgrade now, downgrade at period end, monthly-to-annual undecided): new migration from the reviewed #508 design | C4 | acceptance tests for each change |
| C5 | UI: plans on `/pricing` and `/app/credits`; replace the "Nothing renews" copy (ISSUES P3) | C4 | Finance/Legal wording approved |

## Track D — Uploads and Cinema

| step | build | needs | exit check |
|---|---|---|---|
| D1 | Choose and integrate CSAM hash matching on every upload path, now including Publish device uploads (ADR-0025 §8.1). **Not started** | — | known-hash test file is refused before storage |
| D2 | Cinema fixes: ~~creator-status check on unlock (S7)~~ and ~~nested `<main>` (U1)~~ done; legacy upload removal (S4) and the same-second pass-event fix (S19) open | — | acceptance tests |
| D3 | Turn on `CINEMA_SUBSCRIPTIONS_ENABLED` on staging with Stripe test keys; full Pass drill | S19 | buy, play to ceiling, cancel in cooling-off, refund |
| D4 | Legal: rights/age/territory policy, creator agreement, cooling-off and supply-consent wording; Stripe acceptance for recurring video | — | signed off |
| D5 | Repoint the Stream webhook to production; activate Cinema (#369, open) — profiles, creators, content, uploads, publishing, viewing | D1, D2, D4 | staging acceptance repeated on production |
| D6 | Turn on unlocks and Pass | D3, D5 | first real unlock reconciles |
| D7 | Face Filters Track A Slices 5–9 | D1 + fal cost data | per `docs/face-filters/IMPLEMENTATION-PLAN.md` |

## Track E — Platform (after A7)

| step | build | needs |
|---|---|---|
| E1 | Projects to production: `TENANT_PROJECTS_ENABLED`, malware scan or explicit decision, staging cleanup cron with R2 credentials | D1 |
| E2 | M03: project-aware generation with reserve/settle, Cloudflare Queues/Workflows for durable jobs | E1 |
| E3 | M04–M08: service-binding extraction, editor timeline, TTS/STT permissions, isolated render queue, publication moderation | E2 |
| E4 | Supply: BytePlus activation after pack safeguards and supplier terms; kie/GrsAI swaps verify-then-activate | — |
| ~~E5~~ | Passkey set-up UI is **done** (#491). Remaining: record a production passkey sign-in and accept ADR-0032 (ISSUES P4) | — |

## Track F — Chat and growth surfaces (live; what is left)

| step | build | needs | exit check |
|---|---|---|---|
| ~~F1~~ | **Done and live:** Chat, Personas, Studio skills, free allowance, referrals, Popular templates | — | `CHAT_ENABLED`, `PERSONAS_ENABLED`, `FREE_ALLOWANCE_ENABLED`, `REFERRALS_ENABLED` are `"true"` |
| F2 | Verify the production secrets behind Chat: `OPENROUTER_CHAT_API_KEY`, `EXA_API_KEY` (ISSUES P10) | — | one reply and one Web search walked on production |
| F3 | Deep research (ADR-0070): staging runbook `chat-research-staging-runbook-2026-10-05.md`, then declare `CHAT_RESEARCH_ENABLED` in `wrangler.jsonc` and flip it | F2 | staging walk and cost drill; measured worst case matches the price |
| F4 | Accept ADR-0073 (merged, live, still "Proposed") and bring the ADR index up to date (ISSUES D9) | — | ADR statuses match the code |
| F5 | Chat media tool calls (a model starting a priced job behind a confirm step): own ADR first (ADR-0072 deferred v2) | F3 | ADR accepted |
| F6 | Watch free-allowance spend and referral rewards against their daily/monthly caps for a week; revisit ADR-0069's values with real numbers | A8 | ADR amended or confirmed |

## Track G — Video agent (ADR-0074, built, off)

| step | build | needs | exit check |
|---|---|---|---|
| ~~G1–G3, G5~~ | **Done** (#618, 0227): runner contract, step kind, orchestrator, signed webhook, sweep, refund paths, `/app/video-agent`, ticketed Approve. Runner repo: egress meter (4a) and harness (4b) | — | forced failure at each stage refunds once |
| G4c | Pin and lock down the runner image; read fal's real billing for the five 2026-10-08 runs; decide stock-footage hosts and output resolution | owner keys on the runner only | max and p95 cost recorded in the ADR |
| G6 | Staging plan (`docs/montage/SPEC.md` §7, seven owner-gated steps, none done): apply 0227 to staging, pick and prove the host, deploy the runner, set secrets, one real run, one forced failure | G4c | ledger shows one debit and one refund; `reconcile_balances()` clean |
| G7 | Price migration from the measured ceiling (working price 165 credits, ceiling $2.50), flag on, `reconcile_balances()` clean 24 h | G6 | first production run reconciles |

## Hygiene — any time, small PRs

Open: schema S4, S10, S18–S20 · product P4–P6, P9–P11 · infra I1, I2, I5, I9 ·
docs D3 (ADR-0012), D8–D10 from [ISSUES.md](ISSUES.md). The rest of the 2026-10-02
list (S1–S3, S5–S9, S11–S17, P1–P3, P7–P8, I3–I4, I6–I8, I10, U1–U9, D1–D7) is
fixed. None of the open items block a track except S19 (before D3/D6) and S20
(before widening sign-up, A7). Batch the others by area.

## Not doing

Auto-refill · any wallet, crypto or on-chain feature · LemonSqueezy ·
voice cloning · cash referrals · a model that starts a generation
without the person's confirm · manual credit grants without an ADR · widening
the CSP without an ADR.
