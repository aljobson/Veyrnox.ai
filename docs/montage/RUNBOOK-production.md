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
| `kling-3.0-standard-t2v` catalog row (0232, added 2026-10-09) | exists, **inactive**: a record of the fal model the agent buys clips from, not a product |
| Runner | **none**. Only the staging app `veyrnox-montage-runner-staging` exists |
| `MONTAGE_*` Worker secrets and vars | **none** |
| `reconcile_balances()` | 0 rows |

So production is two switches (flag, row) and one missing service (runner) away. Nothing a user can reach today.

## Gates: all eight are met (G1 to G8; table brought up to date 2026-10-09)

Do not start the rollout until each has a written yes in the SPEC.

| # | Gate | Why it blocks | Who |
|---|---|---|---|
| G1 | **fal's real bill read**, and the price confirmed or lowered | 165 credits and the $2.50 ceiling are worst-case guesses (CLAUDE.md: the catalog price must cover the provider cost; never guess it) | **read 2026-10-09**: $0.14 per second, $2.51 a run with tokens, 153 credits at the floor, so 165 covers it (SPEC pricing worksheet). **Done**: the owner kept 165 on 2026-10-09 |
| G2 | **The three unproven paths pass on staging**: the automatic 45-minute timeout refund, a failure in the middle of a real run, a reload during a live multi-minute run | "Every debit path has a matching refund path ... Test both" | **met 2026-10-09** (SPEC section 11). Proven on staging: the timeout refund (job `f6001734`, 49 min 38 s), a reload during a live run, a run lost mid-run to a runner restart (`run_lost`, job `4e282a58`, with the lost-run flag on), and a `failed` callback from the runner (`brief_refused`, refunded in 15 s). **The last path, 2026-10-09 09:01 UTC:** with the staging runner's run limit set to 120 s for one run (`RUNNER_RUN_TIMEOUT_SECONDS`, put back to 1800 and checked afterwards), job `9288666c` bought 15 s of clips (two paid calls on the runner's spend log), was stopped by the runner at its limit, reported `failed` with `timeout`, and was refunded 126 s after the start: one debit, one refund, `reconcile_balances()` 0 rows. fal bills those clips; the user is refunded in full |
| G3 | **Ten measured runs** on staging: max and p95 cost, failure rate, time | one success is not a price or a reliability figure | **met 2026-10-09** (SPEC section 12). Five runs with the per-run spend recorded: all delivered, $1.66 to $2.41 a run (mean $2.22), 154 to 345 s. With the seven earlier deliveries: twelve of twelve delivered, median 233 s, longest 445 s. That is five runs with cost and twelve with time, against the ten this gate asks for; cost is bounded by the $2.50 ceiling in any case. **Met 2026-10-09 (owner: "go with recommendation"):** accepted as the measured set |
| G4 | **The fal model is on the books**: Kling v3 standard text-to-video is not a catalog row; ADR-0074 says it is added through the usual verified-endpoint route before a user can reach it | CLAUDE.md "Money & billing": a model is live only once its endpoint is verified | **met 2026-10-09 (owner: "go with recommendation").** fal's model page marks the endpoint "Commercial use" with no preview label, and migration `0232` records it as `kling-3.0-standard-t2v`: **inactive**, $0.70 per 5 s from fal's bill, 43 credits at the floor. It is a record, not a product; users reach the model only through `video-agent`. **Met 2026-10-09 07:5x UTC:** `apply-migrations` run 37900969904 (approved by the owner) applied 0232, and a read-only query on production shows the row inactive at 43 credits and $0.70 per 5 s, with `video-agent` still inactive and `reconcile_balances()` at 0 rows |
| G5 | **Brief moderation decided.** Today the brief is checked for length and control characters only; the prompts the agent writes go to fal, which applies its own filter. There is no check of ours, and no refusal copy beyond the generic failure | every other generation path leans on the provider filter too, but this one writes its own prompts from free text | **met 2026-10-09 (owner: "accept with the two fixes").** The agent refuses a brief on five rules (runner `agent.py`): a real, identifiable person; a minor in harm's way or anyone sexualised; sexually explicit; promoting violence, self-harm or hatred; imitating a named living artist or a brand. A refused brief makes no paid call, fails as `brief_refused` and is refunded in full. Fix 1: the message names every rule (this PR). Fix 2: one brief per rule refused on staging, each one debit and one refund: rule 1 on 2026-10-08 (15 s), rules 5, 4, 3 and 2 on 2026-10-09 (jobs `61d6836f`, `f404b46c`, `c801b8bf`, `bf77829e`; 20, 24, 16 and 13 s). Known limits, accepted: it is the agent's judgement, not a classifier (fal's filter is the second line); the check runs after the debit, not at the free plan step; one brief per rule is not a red-team |
| G6 | **Capacity: decided 2026-10-08** (owner: "approve"; SPEC section 10). A busy runner is refused before the debit (#651: "nothing was charged, try again"), capacity is added at a measured trigger, and there is no queue yet. Design and numbers: [CAPACITY.md](CAPACITY.md) | **done on staging 2026-10-08 21:35 UTC:** the runner is on 2 dedicated CPUs and 8 GB (`performance-2x`; owner: "apply A"). On the shared machine it had been on, the CPU quota and the 4 GB were the limits, not the slot count (CAPACITY.md section 5). Step 1 creates the production runner from the runner's `fly.toml` as it now is. Not yet tried: a run on the new machine, and three at once. A second machine needs routing first, not `fly scale count 2` | with the owner's go: one run, then three at once, on staging |
| G7 | **Monitoring exists**: the montage sweep is not in `worker_task_health` (`observeRecovery`), the runner is not in `site-health`, and an undelivered callback is only a log line on Fly | a silent runner outage holds credits for 45 minutes at a time | **built 2026-10-09 (owner: "go with recommendation": alerts are GitHub issues, like every other watch here).** Two watches: (1) the sweep reports to the Worker heartbeat as `video_agent` (#650, migration 0229, applied), so `recovery-health` opens an issue when it stops or errors, once the catalog row is active; (2) `runner-health.yml` asks the runner's `/health` four times a day and opens a `runner-health` issue when it does not answer. It is off until the repository variable `MONTAGE_RUNNER_HEALTH_URL` is set at rollout step 1. Four times a day because each probe starts a stopped machine for about 10 minutes (about 9 cents a day); so a dead runner can go unseen for up to 6 hours, during which users are refused before the debit. Not built: anything for an undelivered callback, which stays a log line on Fly; its effect is caught by the sweep. **Met 2026-10-09:** the variable is set and run 37911078018 was green |
| G8 | **Fly is on a paid footing.** The account is on the free trial (2 hours of machine time or 7 days) | the runner stops when the trial ends | **met 2026-10-09.** Fly's billing page for the `personal` organisation (billing email support@veyrnox.com), read in the owner's browser: Account Status "Good Standing", Payment Method "Charged automatically", upcoming invoice $0.95, no trial notice. Which card it is was not looked at |

## Rollout, once the gates are met

**Progress (2026-10-09).** Steps 1 and 2 are done, in the order 2 then 1: the runner stops at boot without
`RUNNER_CALLBACK_URL`, so the secrets had to be staged before the first deploy.

- **Step 2, 09:2x UTC:** the owner ran a script with hidden prompts. `fly secrets list -a veyrnox-montage-runner` shows the four
  names: a new fal key (`montage-runner-prod`), a new Anthropic key, a signing secret generated on the owner's machine and never
  shown, and `RUNNER_CALLBACK_URL` = `https://veyrnox.ai/api/webhook/montage`. The signing secret is kept in the owner's home
  directory (mode 600) until step 4 puts the same value in the Worker, then deleted.
- **Step 1:** app `veyrnox-montage-runner` (owner created it), one machine `8654e06fedee68` in `ams`, `performance-2x` with 8 GB,
  the image staging ran for gates G2 and G3 at its digest (`sha256:426dcb91...a208`, runner main `7818a09`), `RUNNER_AGENT=claude`,
  ceiling $2.50, three slots. Checks: `verify-lockdown.sh` 21 PASS on the production machine (the script has grown from the 15 in
  the table below), `/health` 200, unsigned `/plan`, `/run`, `/cancel`, `/status` and `/runs` all 401.
- **G7:** the repository variable `MONTAGE_RUNNER_HEALTH_URL` is set and `runner-health` run 37911078018 was green.

- **Step 3:** `MONTAGE_RUNNER_BASE` = `https://veyrnox-montage-runner.fly.dev` in the top-level `vars` of `wrangler.jsonc`, flag still
  "false". With no `MONTAGE_SIGNING_SECRET` in the Worker yet, the routes and the sweep still answer "not configured".

- **Step 4, 10:54 UTC:** the owner ran a script with no prompts. It ran `deploy-production` on main first (run 37920270605), checked
  before each edit that the newest uploaded version was the live one, and set `MONTAGE_SIGNING_SECRET` (piped from the file step 2
  left, so it is the runner's value) and `MONTAGE_PLAN_SECRET` (random, kept nowhere else). The live script was the same before and
  after, and the file was deleted. Checked from outside afterwards: both names are on the production Worker; an unsigned
  `POST /api/webhook/montage` answers 401 `invalid_signature` (it was 503 `not_configured`); the plan route still answers 401 signed
  out; the catalog does not list `video-agent`. The next ordinary deploy of main (`84d94a76`) kept both secrets. A branch preview had
  been uploaded 50 seconds before the script's own deploy, which is the case the procedure exists for.
  Not proven until step 8: that a signed call from the Worker is accepted by the runner. Nothing makes one while the flag is off.

- **Found before step 5 (2026-10-09):** an active `video-agent` row was offered in the Create picker like any other video model
  (seen on staging). Step 5 would have shown every production user a model that cannot be bought from that page, with the flag
  off. Fixed: a row that takes a `plan_id` is held back by `isShelfModel` (landing shelf, pricing, model pages, search) and by the
  Create picker, like the Clip Editor and Auto Short. Checked on staging: the picker no longer lists it, `/api/catalog` still does
  (the page and the Library need its name and price), and `/app/video-agent` still makes a plan. **Step 5 waits for this to be live.**

- **Step 5, prepared:** the picker fix is live on production (#697, deploy run 37924602437). Migration `0234_video_agent_activate`
  sets the row active with the row-count guard. Checked on production before writing it: 0233 is the latest applied migration, the
  `video_agent` heartbeat is arriving and healthy (so `recovery-health` will not alert when the row turns active), and the row is
  inactive at 165 credits. Done once the owner approves the `apply-migrations` run; step 6's 24 hours start then.
- **Step 5 done, 2026-10-09 11:56 UTC:** the owner approved `apply-migrations` run 37925889732, whose plan listed only 0234. Checked on
  production afterwards: `video-agent` is active at 165 credits; `/api/catalog` lists it; the plan route still answers 401 signed out and
  the webhook 401 unsigned; the landing page, `/pricing` and `/models` do not mention it; `reconcile_balances()`,
  `reconcile_free_credits()` and `reconcile_top_ups()` return 0 rows; the `video_agent` heartbeat is healthy; no production job exists
  for the model. **Step 6 runs until 2026-10-10 11:56 UTC.**

- **Step 7, prepared 2026-10-09:** a draft PR sets `AGENT_VIDEO_ENABLED` to "true" in the production `vars`. It was written during
  step 6 and **must not be merged before 2026-10-10 11:56 UTC**, and only if the step 6 check is clean. After it deploys: the plan
  route answers a signed-in request; step 8 is the owner's one real video with `localStorage.veyrnox_video_agent = "1"`.
  `MONTAGE_LIVENESS_ENABLED` stays "false" (a lost run is refunded by the 45-minute timeout); turning it on is a separate decision.
- **Runner image changed during step 6 (2026-10-09 14:2x UTC, owner: "deploy the format fix to production").** The five measured
  videos were all 15 s long but came out at two sizes (three at 720x1280, two at 1080x1920) and one was 61 MB. Runner `50ff92e` tells
  the agent one size per aspect ratio (1080x1920, 1920x1080, 1080x1080), 30 fps, H.264 at no more than 8 Mbit/s. One real run on
  staging with the brief of the 61 MB video: 1080x1920, 15 s, 6.4 MB, delivered in 262 s (job `1fe7c06f`). Production now runs that
  image at its digest (`sha256:77a60a8c...cba0`), replacing `sha256:426dcb91...a208`: 21 lockdown checks pass, `/health` 200, the five
  signed routes answer 401 unsigned, the four secrets are deployed, settings unchanged. The only difference from the image the gates
  were met on is that paragraph of the agent's instructions; it has had one real run, at 9:16.

- **Step 7 happened early.** The flag PR (#710) was marked ready and merged at 2026-10-09 16:23 UTC from the owner's GitHub account,
  about four and a half hours into step 6, not after it. `AGENT_VIDEO_ENABLED` has been "true" on the live Worker since that deploy.
  The session that wrote the PR did not merge it and found this on 2026-10-10 09:35 UTC. Checked then, 21.5 hours after the row went
  active: `reconcile-watch` 22 runs, `recovery-health` 41, `site-health` 62 and four scheduled `runner-health` runs, none failed;
  the three reconcile checks at 0 rows; the heartbeat healthy; **no video-agent job from any user**. So the 24 hours were not kept
  before the flag, and nothing went wrong in them.
- **Step 8 done, 2026-10-10 09:55 UTC.** With the browser switch on and the owner signed in (and the owner's "yes" to the purchase
  in the session), one real video was bought and delivered on production: job `33d1c8d6`, 9:16, brief "a 15 second teaser for a
  small-batch coffee roaster, warm and cinematic".
  - Approve to stored: 362 s. One debit of 165 Credits, no refund; the account went from 205 to 40. `reconcile_balances()` 0 rows.
  - The video: 1080x1920, 15 s, 10.0 MB, in the Library. That is the size and the bitrate cap the runner now asks for.
  - Spend, from the runner's own log: one paid fal call, 10 s of clips ($1.54 on the meter, $1.40 at the billed rate); tokens $0.37
    over 17 turns. About $1.77 against the $2.72 the price covers.
  - What it proved for the first time: the Worker and the runner accept each other's signed calls (plan, run and the callbacks), and
    the production fal key and Anthropic key work.
  - An earlier Approve on a second account was refused before any charge ("Not enough credits": it held 86). A manual grant was
    prepared for it and **not run**; no manual grant was made on production.

Next: step 9 (open it to users) after a week of step 8 without a stuck job. That is the owner's decision.

Each step has its own check and its own undo. Stop at the first check that fails.

| # | Step | Who | Check | Undo |
|---|---|---|---|---|
| 1 | **Production runner on Fly**: a new app (`veyrnox-montage-runner`, EU region), the same image at a pinned digest, `RUNNER_AGENT=claude`, `RUNNER_CEILING_MICRO_USD` from G1/G3, one machine | owner creates the app; I deploy | set the repository variable `MONTAGE_RUNNER_HEALTH_URL` to the app's `https://.../health` and run `runner-health` once by hand (G7); `scripts/verify-on-fly.sh` shows **15 PASS on the production machine**; `/health` 200; unsigned request 401 | `fly apps destroy` |
| 2 | **Runner secrets**, all new and production-only: a signing secret (not staging's), a dedicated fal key (`montage-runner-prod`), an Anthropic key in a workspace with its own spend limit, `RUNNER_CALLBACK_URL` = the production Worker's `PUBLIC_HOST` + `/api/webhook/montage` (the same origin fal calls back on; it is not in `wrangler.jsonc`, so read it from the Worker's settings rather than assuming it) | owner, at hidden prompts | `fly secrets list` shows the four names | `fly secrets unset` |
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
