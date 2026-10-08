# Video agent: production rollout plan (written 2026-10-08; nothing below is done)

A plan for the owner to approve, not a record. Every step that touches production is the owner's to run or approve.
Background: [ADR-0074](../adr/0074-openmontage-video-agent.md), [SPEC](SPEC.md) sections 6-9, [staging runbook](RUNBOOK-staging.md).

## Where production stands today (checked read-only, 2026-10-08 18:40 UTC)

| Piece | State |
|---|---|
| Code on main (#618, #639, #647) | deployed by `deploy-production`; every route is refused while the flag is off |
| `AGENT_VIDEO_ENABLED` | `"false"` |
| Migration `0227` | **applied** (apply-migrations run of 14:45 UTC): `montage` step kind and provider added, `captions` kept |
| `video-agent` catalog row | exists, **inactive**, 165 credits, cost 2.72 per generation |
| Runner | **none**. Only the staging app `veyrnox-montage-runner-staging` exists |
| `MONTAGE_*` Worker secrets and vars | **none** |
| `reconcile_balances()` | 0 rows |

So production is two switches (flag, row) and one missing service (runner) away. Nothing a user can reach today.

## Gates: none of these is met yet

Do not start the rollout until each has a written yes in the SPEC.

| # | Gate | Why it blocks | Who |
|---|---|---|---|
| G1 | **fal's real bill read**, and the price confirmed or lowered | 165 credits and the $2.50 ceiling are worst-case guesses (CLAUDE.md: the catalog price must cover the provider cost; never guess it) | owner reads fal, then a price decision |
| G2 | **The three unproven paths pass on staging**: the automatic 45-minute timeout refund, a failure in the middle of a real run, a reload during a live multi-minute run | "Every debit path has a matching refund path ... Test both" | me, with the owner's go (spends at fal) |
| G3 | **Ten measured runs** on staging: max and p95 cost, failure rate, time | one success is not a price or a reliability figure | me, with the owner's go (about $25 at fal, $4 in tokens) |
| G4 | **The fal model is on the books**: Kling v3 standard text-to-video is not a catalog row; ADR-0074 says it is added through the usual verified-endpoint route before a user can reach it | CLAUDE.md "Money & billing": a model is live only once its endpoint is verified | owner decision, then a migration |
| G5 | **Brief moderation decided.** Today the brief is checked for length and control characters only; the prompts the agent writes go to fal, which applies its own filter. There is no check of ours, and no refusal copy beyond the generic failure | every other generation path leans on the provider filter too, but this one writes its own prompts from free text | owner decision |
| G6 | **Capacity decided.** The runner takes one run at a time; a second user gets `montage_busy`, which today fails and refunds the job instead of queueing | a launch with one slot refunds most people | owner decision: queue, more machines, or a waiting message |
| G7 | **Monitoring exists**: the montage sweep is not in `worker_task_health` (`observeRecovery`), the runner is not in `site-health`, and an undelivered callback is only a log line on Fly | a silent runner outage holds credits for 45 minutes at a time | me (code), owner (alert destination) |
| G8 | **Fly is on a paid footing.** The account is on the free trial (2 hours of machine time or 7 days) | the runner stops when the trial ends | owner (card on file) |

## Rollout, once the gates are met

Each step has its own check and its own undo. Stop at the first check that fails.

| # | Step | Who | Check | Undo |
|---|---|---|---|---|
| 1 | **Production runner on Fly**: a new app (`veyrnox-montage-runner`, EU region), the same image at a pinned digest, `RUNNER_AGENT=claude`, `RUNNER_CEILING_MICRO_USD` from G1/G3, one machine | owner creates the app; I deploy | `scripts/verify-on-fly.sh` shows **15 PASS on the production machine**; `/health` 200; unsigned request 401 | `fly apps destroy` |
| 2 | **Runner secrets**, all new and production-only: a signing secret (not staging's), a dedicated fal key (`montage-runner-prod`), an Anthropic key in a workspace with its own spend limit, `RUNNER_CALLBACK_URL=https://veyrnox.ai/api/webhook/montage` | owner, at hidden prompts | `fly secrets list` shows the four names | `fly secrets unset` |
| 3 | **Worker var** `MONTAGE_RUNNER_BASE` in `wrangler.jsonc` top-level `vars` (public, not a secret), by PR; flag still `"false"` | me (PR), owner merges | deploy green; routes still refuse | revert the PR |
| 4 | **Worker secrets** `MONTAGE_SIGNING_SECRET` (the same value as the runner's) and `MONTAGE_PLAN_SECRET`. **Follow the secret-edit procedure**: run `deploy-production` on main first so the newest upload is the live version, then `wrangler secret put`, then compare the live etag with the latest main deploy and redeploy if they differ | owner | live version is main; `/api/webhook/montage` unsigned is 401, not 503 | `wrangler secret delete` |
| 5 | **Activate the row** by migration (next free number; an UPDATE with the exact ROW_COUNT assertion the README requires). Flag still `"false"`, so nothing is reachable | me (PR), owner approves the `apply-migrations` run | row active; `/api/catalog` lists it; plan route still 404 | a mirror migration setting `active = false` |
| 6 | **Wait 24 hours** with `reconcile_balances()`, `reconcile_free_credits()` and `reconcile_top_ups()` at zero rows (CLAUDE.md "Delivery") | nobody | the nightly reconcile job is green | none needed |
| 7 | **Flag on**: `AGENT_VIDEO_ENABLED: "true"` in production `vars`, by PR | me (PR), owner merges | plan route answers a signed-in request | set it back to `"false"`; runs in flight still finish or refund, because the webhook is not behind the flag |
| 8 | **Owner makes one real video in production**, with `localStorage.veyrnox_video_agent = "1"`; the page is not in the navigation | owner | video in the Library; one debit; reconcile clean; fal and Anthropic usage match the meter | step 7's undo |
| 9 | **Open it to users**: a navigation entry and removing the browser switch, in its own PR, only after a week of step 8 without a stuck job | owner decision | n/a | revert the PR |

### What "on" means between steps 7 and 9

The page stays hidden, but the API does not check the browser switch: any signed-in user who calls `/api/v1/montage/plan` and `/api/v1/generations`
directly can buy a video for 165 credits. That is a real, priced, refundable purchase, the same exposure Auto Short had before its launch, and it is why
the gates on price (G1, G3) and capacity (G6) come first. If that exposure is not acceptable, set `gated_flag = true` on the row for step 8 and test
with a second, owner-only path; say so before step 5.

## Emergency stop

In order of speed:
1. `AGENT_VIDEO_ENABLED: "false"` and deploy: no new plans or runs. Runs in flight still finish or refund.
2. `fly machine stop` on the production runner: runs in flight die and are refunded by the sweep within 45 minutes.
3. A migration setting the row `active = false`.
4. `wrangler rollback <version-id>` for the Worker. A rollback does not undo migrations.

Money is never stranded by a stop: every path ends in `ledger_refund` exactly once (the healing sweep of #639 covers a step left FAILED under a live job).

## What it costs to run

Per video, at today's working numbers: up to $2.31 at fal (three 5 s Kling v3 standard clips at the dearest tier), about $0.43 of Anthropic tokens, a few cents
of Fly machine time, and 10 MB of R2 storage. A failed run that got as far as generating clips still costs the fal part while the user is refunded in full.
