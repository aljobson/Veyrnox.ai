# Video Agent (OpenMontage runner) — spec

Implements [ADR-0074](../adr/0074-openmontage-video-agent.md). Status: **Proposed**. Modelled on
[Auto Short](../auto-short/SPEC.md): same money path, same webhook and sweep pattern, one new external service.

## 1. What it is

A signed-in user fills a short brief (topic or reference-video URL, length, aspect, style). The app shows a **plan and
a price**. On **Approve** it debits once; a runner container produces the video; the MP4 lands in the Library. Any failure
refunds in full.

## 2. Reuse, do not rebuild

| Need | Already exists |
|---|---|
| Debit, refund, idempotency | `POST /api/v1/generations`, `ledger_debit`, `ledger_refund` |
| Multi-step job state | `job_steps` (Auto Short, 0201-series), `lib/autoShortSteps.js`, `lib/autoShortSweep.js` |
| Signed callbacks and dedupe | `app/api/webhook/*`, `webhook_events(source, external_id)` |
| Output storage | `packages/adapters/r2.js` presigned PUT, `get_user_asset` |
| Input rules, 501 on unknown model | `lib/modelCapabilities.js` (ADR-0027) |
| Flag and preview switch | `wrangler.jsonc` vars, `localStorage` preview key |

## 3. New pieces

1. **Runner repo** `veyrnox-montage-runner` (separate, pins an OpenMontage release): Dockerfile (Python, ffmpeg,
   Node/Remotion), a small HTTP wrapper with `POST /plan`, `POST /run`, `POST /cancel`, HMAC-verified, a per-run spend
   ceiling enforced at the provider gateway, an egress allowlist, a read-only repo mount.
2. **Worker side** (this repo): `lib/montage.js` (client + signing, `MONTAGE_RUNNER_BASE` constant),
   `app/api/webhook/montage/route.js` (verify, dedupe, bind to the job by id), a `montage` step kind in `job_steps`,
   a sweep branch for stuck runs, and a capability record. Migration adds the step kind and one **inactive** catalog row.
3. **UI** behind the flag: brief form, plan + price + Approve, step progress, result in Library.

## 4. Flow

1. `POST /api/v1/montage/plan` validates the brief, calls the runner `/plan`, returns `{plan, estimate_credits, plan_id}`.
   No debit. Rate limited. The reference URL is passed to the runner only.
2. `POST /api/v1/generations` with the montage `model_id` and `plan_id`: price from the catalog, `ledger_debit`, runner
   `/run`. A plan older than 30 min or already used is rejected before the debit.
3. Runner reports progress and completion to the signed webhook; output is uploaded with a Worker-minted presigned PUT.
4. Failure, timeout, cancel or ceiling hit: `ledger_refund` once (idempotent), runner machine stopped.

## 4a. Approve ticket (built with slice 3)

`/api/v1/montage/plan` returns `plan_id`, a stateless HMAC token (`lib/montagePlan.js`) bound to the caller, the exact
brief, the aspect, the catalog price and a 30-minute expiry, plus the `idempotency_key` (`plan_<nonce>`) the approving
job must carry. The generations route verifies the token before the debit, so a changed brief, another user's token, an
expired plan or a moved price is refused with nothing charged, and `ledger_debit`'s unique key makes one plan buy one
run. Needs `MONTAGE_PLAN_SECRET`, `MONTAGE_SIGNING_SECRET`, `MONTAGE_RUNNER_BASE` and `AGENT_VIDEO_ENABLED="true"`.
Planning shares the generation attempt limit (0113).

## 5. Build plan (one PR each, each with an exit gate)

| # | Slice | Exit gate |
|---|---|---|
| 0 | Owner closes ADR-0074 open questions 2 and 3 | Written note in the ADR |
| 1 | Runner repo with a **fake gateway**: plan and run one pipeline to a local MP4 | MP4 produced, spend counter reads 0 |
| 2 | Capability record + migration (step kind, inactive row) | Acceptance test: replayed webhook is a no-op, forward-only |
| 3 | Orchestrator, webhook, sweep, refund paths | Forced failure at each stage refunds exactly once |
| 4a (done) | Egress meter in the runner repo (`runner/meter.py` + mitmproxy addon): price table, ceiling, fail-closed | Unit tests; a fake upstream is refused at the ceiling and for unknown paths; no spend |
| 4b (done, runner repo `aljobson/veyrnox-montage-runner`) | Headless agent harness for OpenMontage with its own budget cap; runner `/run` becomes async with signed callbacks and the `upload_url` ask | A full fake-provider run end to end locally; no spend |
| 4c (image, pin and lock-down done; real runs pending) | Build and pin the image; enforce that the agent reaches the network only through the proxy (a deployment control, not yet designed); run `ClaudeAgent` for real (unverified until now); fill the price table from verified prices; measure 10 real runs | Max and p95 cost recorded in the ADR (needs provider and LLM keys, supplied by the owner on the runner only) |
| 5 | UI behind `AGENT_VIDEO_ENABLED` and the preview key | Owner generates one video on staging |
| 6 | Price migration from measured ceiling, flag on | `reconcile_balances()` clean 24 h |

Slices 1-3 spend no provider money and expose nothing to users. Slice 4 onward needs slice 0 closed.

## 6. First real agent run (slice 4c dry run, 2026-10-08)

The headless agent ran for the first time in the container, with the empty price table and no provider keys. It
finished: a 15 s, 1080x1920 video, 25 turns, **$0.77** of Anthropic tokens (Opus, default model; under the $2 cap),
**no paid provider call attempted** (it had none configured). Findings, each now fixed or open:

| Finding | State |
|---|---|
| The runner's own callbacks were sent through the spend proxy and refused | fixed (only the agent child uses the proxy) |
| Dry-run upload target unreachable from the container, so the run ended `upload_failed` | fixed in the test rig; the production path is untouched and not yet exercised against R2 |
| Remotion could not render: no headless Chrome | fixed (downloaded at build) |
| HyperFrames needs Node 22, image had 20 | fixed (Node 22.12.0, checksum-verified) |
| Free stock-footage and music hosts blocked by the proxy (403) | **open decision**: allow GET-only on a short list (Pexels, Pixabay, archive.org) or stay generate-only |
| No provider keys, so no paid call was priced | **open**: needs the owner's choice of providers and their keys on the runner only |
| The agent probes `127.0.0.1/api/health` and `localhost/system_stats` (local ComfyUI checks); refused, harmless | none |
| LLM cost is the default (Opus) model | open: try `--model sonnet` and compare quality before measuring |

Not yet proven: a run that actually uploads to R2 through the Worker's presigned URL, and any paid provider call.

### Second dry run (2026-10-08, fal key present, empty price table)

Completed end to end **including the upload callback flow** (a 15 s 1080x1920 teaser with a free Pixabay track, 45 turns,
7 minutes, 149 MB uploaded; no paid provider call reached a provider). Findings:

- **Refused tunnels were invisible.** The agent said fal, BFL, Google, Kling and MiniMax were blocked, but the log only
  recorded requests, not refused CONNECTs. Now logged, and `observe_hosts` (fal) opens the tunnel while still refusing
  and logging every request, so the next run lists the exact fal endpoints it tries.
- **Remotion still could not render**: loopback went through the proxy and the firewall allowed only the proxy port. Fixed
  (`NO_PROXY` for loopback; the agent may use its own loopback, never the runner's port); verified in the container.
- **149 MB for 15 s** is far above what is sensible to store and serve. Cap the output bitrate (a final re-encode, or an
  instruction in the prompt) before measuring; R2 and egress cost scale with it.
- The agent skipped research, stage checkpoints and decision logs "to save budget": the planned pipeline is not what ran.

### Third dry run (2026-10-08): the first paid call the agent tried

Observation only (fal tunnel open, every request refused, $0 at fal; $0.31 of Anthropic tokens, 11 turns). The agent
chose **one** paid endpoint, three times (three 5 s shots): `POST queue.fal.run/fal-ai/kling-video/v3/standard/text-to-video`.
It also tried `registry.npmjs.org` (refused, harmless).

- **The agent's own estimate was wrong**: it assumed about $0.10 per clip. fal's page (read 2026-10-08) says $0.084/s with
  audio off, $0.126/s with audio, $0.154/s with audio and voice control: **$0.42 to $0.77 per 5 s clip**. OpenMontage's
  estimates must not be trusted for pricing; only the meter's table counts.
- **Price depends on the request body** (duration, audio), so the meter now prices from the body: `duration x $0.154/s`
  (dearest tier), refusing a missing, unreadable or over-10 s body.
- **Scope question for the owner**: this endpoint (Kling v3 standard text-to-video) is not one of the catalog models the
  owner confirmed the resale terms for (the catalog has Kling v2.6 pro text-to-video and v3 pro image-to-video). It is the
  same vendor and model family; confirm it is in scope before the real run.
- fal's queue status and result reads are free, so `queue.fal.run` GET is allowed; a paid job could not be collected otherwise.

### Fourth run (2026-10-08): first real paid run, ceiling $2.50

Completed end to end and uploaded (12.4 MB, 15 s, 12 turns, 187 s). The agent made **three Kling v3 standard 5 s clips**
through fal, cut them in FFmpeg with crossfades and a title, and used the clips' own audio plus a free local drone.

| Measure | Value |
|---|---|
| Meter reservation (dearest tier, 3 x 5 s x $0.154) | **$2.31** of the $2.50 ceiling |
| Agent's own claim of paid spend | $0.30 (3 x $0.10), **wrong by the same 4-8x as its estimate** |
| fal's real billing | **not yet read**: owner to read fal's usage page (the figure that sets the price) |
| Anthropic tokens (Opus) | **$0.41** |
| Output size | 12.4 MB (earlier procedural run: 149 MB) |

New observations:
- The agent also tried `POST queue.fal.run/fal-ai/elevenlabs/...` (music): unpriced, refused, and it carried on without
  music. Left unpriced on purpose.
- Polling is cheap in requests (about 12 status reads per clip) and free.
- It chose Kling over Seedance (about $1.52 per clip by its own note) because of the cost instruction in the prompt.

The meter's worst case is conservative by design; the measured price must come from fal's billing, not from the meter or
from the agent. Ten runs at this size would reserve up to $23 at fal and about $4 in tokens.

### Fifth run (2026-10-08): Sonnet vs Opus, same brief, same $2.50 ceiling

| | Opus (run 4) | Sonnet (run 5) |
|---|---|---|
| Anthropic tokens | $0.41 | **$0.18** |
| Turns / time | 12 / 187 s | 7 / 194 s |
| Paid fal calls | 3 x Kling v3 standard 5 s (+1 music refused) | 3 x Kling v3 standard 5 s |
| Meter reservation | $2.31 | $2.31 |
| Output | 1080x1920, 12.4 MB, crossfades, title, colour lift, drone | 720x1280, 2.7 MB, plain joins and fades, **no title, no music** |
| Checked its own output | contact sheet of frames | **only ffprobe: "I didn't watch the video"** |

Reading: the token saving is about $0.23 a run, small next to fal (the three clips are the real cost). Sonnet delivered a
thinner product and did not look at it. Until the cost per video is known and quality is judged by a person, stay on the
default model. Open product decision: the output resolution is whatever the agent picks (720p vs 1080p); the spec must
state it, since fal bills the same clips either way but storage and bandwidth do not.

### Pricing worksheet (prepared 2026-10-08)

ADR-0014 floor: credits = ceil(cost / (0.5 x $0.033)) = ceil(cost / $0.0165). One run = three 5 s Kling v3 standard clips
(15 s of video) + Anthropic tokens ($0.41 on Opus, run 4). fal's published rates (read 2026-10-08): $0.084 / $0.126 / $0.154 per
second for audio off / audio on / audio + voice control.

| fal tier the clips were billed at | fal (15 s) | + tokens | cost | **credits at the floor** |
|---|---|---|---|---|
| audio off | $1.26 | $0.41 | $1.67 | **102** |
| audio on | $1.89 | $0.41 | $2.30 | **140** |
| audio + voice control | $2.31 | $0.41 | $2.72 | **165** |

Not in these numbers, so the real price is higher: the runner's own compute and storage, the cost of a **failed run**
(fal bills clips that finished even when a later step fails, and the user is refunded in full), retries, and any
music or other paid call added later. Until fal's real figure is known, the safe choice is the worst-case row (165 credits),
which is also what the per-run ceiling protects. Compare Auto Short: 110 credits for 32 s at a $0.70 ceiling.

**Decision 2026-10-08 (owner: "use 165")**: the working price is **165 credits** per video (the worst-case row), the per-run
ceiling at the runner is **$2.50**, and the `video-agent` catalog row carries `credits_5s = 165`, `provider_cost_per_unit = 2.72`,
still inactive (migration 0227). fal's real billing is still unread; when it is, the price may only come down, never silently go up.

## 7. Staging plan (written 2026-10-08; nothing below is done)

Every step touches shared infrastructure and waits for the owner's explicit yes. Staging is the Worker `veyrnox-ai-staging`
(`wrangler.jsonc` `env.staging`), with its own database and bucket.

| # | Step | Who | Check before the next step |
|---|---|---|---|
| 1 | Merge PR #618 (flag off everywhere) | owner | CI green on main; `AGENT_VIDEO_ENABLED` still `"false"` in both environments |
| 2 | Apply migration `0227` to **staging** through the `apply-migrations` workflow | owner approves the run | `video-agent` row exists, inactive, 165 credits; `reconcile_balances()` clean |
| 3 | Pick the runner host and prove the firewall there: `verify-lockdown.sh` must print 10 PASS on the real machine | owner picks, then me | all 10 pass **on that host**; if the guest kernel lacks netfilter support, choose another host (the container refuses to start rather than run unlocked) |
| 4 | Deploy the runner (EU region, one machine per run, 1 concurrent) with `RUNNER_AGENT=claude`, `RUNNER_MAX_LLM_USD`, a `montage-runner` fal key with a low balance, `RUNNER_CEILING_MICRO_USD=2500000` | owner supplies keys by `read -s` / the host's secret store, never in chat | `/health` answers over HTTPS; an unsigned request is 401 |
| 5 | Set the staging Worker's `MONTAGE_RUNNER_BASE`, `MONTAGE_SIGNING_SECRET` (same value as the runner's `RUNNER_SIGNING_SECRET`), `MONTAGE_PLAN_SECRET`, `AGENT_VIDEO_ENABLED="true"` (staging only); set the runner's `RUNNER_CALLBACK_URL` to the staging Worker's `/api/webhook/montage` | owner | Worker `/api/v1/montage/plan` returns a plan for a test account |
| 6 | Activate the `video-agent` row on staging only and give the test account credits (ADR-0022 style manual grant, with a written reason) | owner | the page at `/app/video-agent` (with `localStorage.veyrnox_video_agent = "1"`) loads |
| 7 | One real run through the page: plan, approve, a finished video in the Library; then a forced failure (stop the runner mid-run) and confirm exactly one refund | me, watching | ledger shows one debit, one refund; `reconcile_balances()` clean; the output object is in staging R2 |

Known risks to settle on the way:
- **The firewall on a real host (step 3).** Fly Machines are full VMs with their own kernel, so the rules are likely to
  work, but a community report shows a Fly kernel without the `raw` iptables table; our rules use only the `filter` table.
  Unverified until step 3 passes on the machine itself.
- **fal's real billing is still unread**, so the 165-credit price and the $2.50 ceiling are working numbers.
- **Output size and resolution** are not yet fixed by the product (see run 5).
- **The Worker-to-runner call** goes over the public internet: it is HMAC-signed with a 300 s window, and the runner
  accepts nothing unsigned, but a network allow-list on the runner host is a worthwhile second layer.

## 9. First staging run (2026-10-08): what it found

A real run through the page (sign in, plan, approve) on staging. The Worker-to-runner path, the debit, the step record and the agent all worked; the run failed safely
(the agent picked an unpriced Kling v2.1, the proxy refused it at no media cost, $0.31 in tokens). Three bugs, none visible in any unit test:

| Bug | Found how | Fix |
|---|---|---|
| Cloudflare answered the runner's default Python user-agent with **error 1010**, so every callback and upload was blocked and the "failed" never reached the Worker | zero `webhook_events`; reproduced with curl using that user-agent | own user-agent on callbacks and uploads; undelivered callbacks are logged; tests assert the user-agent (runner repo) |
| The **Auto Short sweep** (`sweepSteps`) failed the live montage step after 12 minutes (it declares any provider it cannot read FAILED) and never touched the parent, so **165 credits stayed held**; the montage sweep only looked at SUBMITTED steps | step `FAILED:provider_failed` under a SUBMITTED job | `autoShortSweep` excludes `provider=neq.montage`; `montageSweep` also heals FAILED steps under a SUBMITTED parent through `failParent` (PR #639). **Verified on staging: refunded exactly once, balance 72 to 237, reconcile clean** |
| The agent picked an **unpriced** model | meter log: 4 refused `kling-video/v2.1` calls | the agent prompt now names the priced endpoints, generated from the same price table the proxy reads |

Also: my first staging build used no environment variables and baked the **development identity** into the client (no Google button, sign-in broken); the runbook now has the full recipe. The plan text says "about 30 seconds" whatever the brief asks (a fixed default in the runner).

### Second staging run (2026-10-08, job 4e7d3820): a fourth bug, and the first run that reached fal

With the three fixes deployed the agent used the **priced** endpoint (`kling-video/v3/standard/text-to-video`, the proxy reserved $2.31 of the $2.50 ceiling at the
dearest tier) and was polling the clips when the run died: **Fly stopped the machine at about 346 seconds.** Fly's auto-stop only counts *inbound* traffic; `/run` answers
202 at once and a run then talks outward, so the machine looked idle. The first failed run ended in seconds, which hid it.

Fix: Fly auto-stop is off; the runner stops itself only after `RUNNER_IDLE_EXIT_SECONDS` (600) with **no run in flight and no request**, the restart policy is
`on-failure` so a clean exit leaves it stopped, and `auto_start_machines` wakes it on the next signed request. Tests: the watchdog never exits while a run is active.
The fal clips this run generated are probably billed with no video produced; the job stays SUBMITTED until the Worker's 45-minute timeout sweep refunds it (about 18:16 UTC).

Open: fal's real billing for this run (clip count and audio tier) is still unread; it is the number that sets the price.
