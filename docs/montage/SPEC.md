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
