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

## 5. Build plan (one PR each, each with an exit gate)

| # | Slice | Exit gate |
|---|---|---|
| 0 | Owner closes ADR-0074 open questions 2 and 3 | Written note in the ADR |
| 1 | Runner repo with a **fake gateway**: plan and run one pipeline to a local MP4 | MP4 produced, spend counter reads 0 |
| 2 | Capability record + migration (step kind, inactive row) | Acceptance test: replayed webhook is a no-op, forward-only |
| 3 | Orchestrator, webhook, sweep, refund paths | Forced failure at each stage refunds exactly once |
| 4 | Real gateway with ceiling; measure 10 runs | Max and p95 cost recorded in the ADR |
| 5 | UI behind `AGENT_VIDEO_ENABLED` and the preview key | Owner generates one video on staging |
| 6 | Price migration from measured ceiling, flag on | `reconcile_balances()` clean 24 h |

Slices 1-3 spend no provider money and expose nothing to users. Slice 4 onward needs slice 0 closed.
