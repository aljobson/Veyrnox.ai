# ADR-0020 — kie.ai and OpenRouter as generation providers

- **Status**: Accepted (2026-09-12). OpenRouter live 2026-09-13 (seedance-2.0-fast). **kie.ai: no-go** (owner decision 2026-09-13: no DPA, data sent to the US); kie rows stay inactive and Veo stays on fal at 4s clips (migration 0066).
- **Date**: 2026-09-12
- **Deciders**: Product owner (sole)
- **Related**: [ADR-0016 — Data-residency claim correction](0016-data-residency-claim-correction.md)

## Context

A supplier price check on 2026-09-12 found the same models well below fal's
price elsewhere:

| Model | fal | Alternative |
|---|---|---|
| Veo 3.1 Fast, 8s 720p with audio | $1.20 | kie.ai $0.30 |
| Veo 3.1, 8s 720p with audio | $3.20 | kie.ai $1.25 |
| Nano Banana, one image | $0.039 | kie.ai $0.02 |
| Seedance 2.0 Fast, 5s 720p | $1.21 (row switched off in 0029) | OpenRouter $0.4536 |

The gateway only spoke to fal.

## Decision

Add both providers behind the existing money spine, with no change to the
ledger, the job state machine, or the refund rules.

- `packages/adapters/kie.js` and `packages/adapters/openrouter.js` build and
  submit requests. Each request is pinned to the unit its catalog row is
  priced at (clip length, resolution, allowed aspect ratios). Inputs the
  provider cannot express at that unit are refused **before** the debit.
- `app/api/v1/generations/route.js` picks the adapter by `model_catalog.provider`
  and records that provider on the job.
- `/api/webhook/kie` and `/api/webhook/openrouter` share
  `lib/providerCompletion.js`: dedup on `webhook_events`, `job_succeeded`, copy
  to R2, `job_stored`; or `job_failed` then `ledger_refund`. A refund happens
  only for a job that is FAILED, using the job row's user and credits.
- Migration 0035 adds `veo-3.1-fast-kie`, `veo-3.1-kie` and `nano-banana-kie`,
  and moves the inactive `seedance-2.0-fast` row to OpenRouter. **All rows are
  inactive.**

### Signatures

- **kie.ai** signs only `taskId.timestamp` (HMAC-SHA256, base64), not the body.
  A verified callback is treated as a prompt to re-read the task from kie with
  our API key; the callback body never decides the outcome.
- **OpenRouter** signs `t,` plus the raw body (HMAC-SHA256, hex). The job is
  still re-read with our key, because output is only downloadable from
  `openrouter.ai/api/v1/videos/{id}/content` with that key. `copyUrlToR2` sends
  an `Authorization` header only for provider `openrouter`, whose allowlist is
  the single host `openrouter.ai`.
- Both fail closed (503) with no secret set, and answer 409 when a signed
  callback names a task we have not recorded yet, so the provider redelivers
  instead of the callback being dropped before `job_submitted` lands.

### Submit rejections (#117, 2026-09-13)

A provider refusing a submit leaves the job without a `provider_job_id`, so
`job_failed` cannot record a reason. The gateway now calls
`job_submit_rejected` (migration 0053) to set a typed `error_code` on the
still-DEBITED job, then `ledger_refund` exactly as before. Codes match
`^[a-z0-9_]{1,64}$` and name the class of failure (for OpenRouter:
`provider_payment_required`, `provider_auth_failed`, `provider_request_rejected`,
`provider_rate_limited`, `provider_unavailable`, `provider_timeout`, ...);
vendor messages stay in the Worker log only. OpenRouter job failures record
`provider_error`, `provider_cancelled` or `provider_timeout`, not the vendor's
error text. fal and kie rejections record `provider_submit_failed`.

## Consequences

- New secrets: `KIE_API_KEY`, `KIE_WEBHOOK_HMAC_KEY`, `OPENROUTER_API_KEY`,
  `OPENROUTER_WEBHOOK_SECRET`.
- **kie.ai has no DPA** and its privacy policy sends data to the United States.
  Prompts go to kie. Do not activate a kie row for EU/UK users until that is
  settled or accepted in writing.
- OpenRouter has a DPA; EU in-region routing needs a Business plan.
- kie output URLs expire in about 24 hours. The R2 copy runs on the callback;
  a job left SUCCEEDED without an asset is refunded by `sweep_stuck_jobs`.

## Before activating any row

1. Set the provider's secrets on `veyrnox-ai` and enable `webhookHmacKey` in kie.
2. Run one live generation per row end to end and confirm STORED.
3. Confirm kie's output host is on `.aiquickdraw.com`, and that OpenRouter's
   content endpoint returns the bytes directly. A redirect is refused by
   `copyUrlToR2`, which would refund every job.
4. Flip `active` in a migration.

## Update (2026-09-24): kie is live, and its savings are passed on (0104)

The **no-go** in the Status line above is stale. The owner's data-residency
objection was waived, and kie has served production traffic since the rows were
verified live and activated: `nano-banana-kie` (0075), the two Veo rows (0079)
and `veo-3.1-lite-kie` (0080).

0074 priced the kie rows at their fal twin's credits so the supplier swap was
invisible and the saving stayed ours. The owner has decided to spend it.
Migration 0104 reprices the four live kie rows to the ADR-0014 floor,
`ceil(provider_cost_per_unit / 0.0165)`:

| row | credits (was -> now) | kie cost |
|---|---|---|
| veo-3.1-fast-kie | 46 -> 19 | $0.30 |
| veo-3.1-kie (gated) | 122 -> 76 | $1.25 |
| veo-3.1-lite-kie | 23 -> 10 | $0.15 |
| nano-banana-kie | 3 -> 2 | $0.02 |

`seedance-2.0-fast` on OpenRouter is already at its floor (28 credits for
$0.4536) and is unchanged. The floor is 50% margin at the $0.033 reference
rate, so at Credit Pack rates ($0.075-0.10 per credit, ADR-0018) the margin on
these rows is far higher; the per-credit rate is a separate decision.

### Staged twins (0105)

kie's public rate card (`api.kie.ai/client/v1/model-pricing/page`, the JSON
behind kie.ai/pricing) lists most fal-hosted models below fal. Migration 0105
stages three kie twins **inactive**, with adapter branches in
`packages/adapters/kie.js` and capability records in `lib/modelCapabilities.js`:

| row | fal (credits, cost) | kie cost | credits |
|---|---|---|---|
| wan-2.5-kie | 31, $0.50 | $0.30 (720p, 5s) | 19 |
| kling-2.6-pro-kie | 22, $0.35 | $0.275 (audio off, 5s) | 17 |
| nano-banana-pro-kie | 10, $0.15 | $0.09 (2K) | 6 |

They go live only after `scripts/verify-kie-endpoints.mjs --submit --only=<id>`
passes with `KIE_API_KEY` set and kie's dashboard confirms the charge matches
the cost above; activation is a separate migration that swaps the fal twin off.
Nano Banana Pro Edit, Kling 3.0 I2V, Hailuo 02 and the audio rows are not
staged (see 0105's header for why). Negative prompt and seed are not offered on
the kie twins.

### Activated (0106, 2026-09-24)

`wan-2.5-kie`, `kling-2.6-pro-kie` and `nano-banana-pro-kie` are live under
their plain names (Wan 2.5 19 credits, Kling 2.6 Pro 17, Nano Banana Pro 6);
their fal rows are inactive. `nano-banana-pro-edit` stays on fal.

Evidence is in 0106's header: one live job per row through
`scripts/verify-kie-endpoints.mjs`, each output served from
`tempfile.aiquickdraw.com` over HTTP 200 without a redirect, and kie's
dashboard charge equal to the row's `provider_cost_per_unit` (Wan 60 credits
$0.30, Kling 55 credits $0.275, Nano Banana Pro 18 credits $0.09, twice). Wan
came out 1280x720 and Kling 1920x1080, both 5.04s; Kling has no audio track.
A 10s clip was not run live; kie's rate card prices it at exactly 2x.

### Staged twins, second batch (0107)

Three more kie twins staged **inactive**, with adapter branches, capability
records and tests. Credits are the ADR-0014 floor.

| row | fal row (credits, cost) | kie cost | credits |
|---|---|---|---|
| hailuo-02-kie | 17, $0.27 (6s) | $0.15 | 10 |
| elevenlabs-tts-turbo-kie | 4, $0.05 | $0.03 per 1000 characters | 2 |
| seedream-4.5-kie | 3, $0.04 | $0.0325 (2K) | 2 |

Seedream is a 4 -> 4.5 upgrade and its saving holds only against the recorded
$0.04; fal's live Seedream 4 price may be nearer $0.03. The speech twin pins the
voice to Rachel, fal's default, so the swap is not audible; confirm by ear on
the live run. They activate only after `scripts/verify-kie-endpoints.mjs` passes
and kie's dashboard charge matches, in a separate migration.

**Content filter.** kie's `nsfw_checker` defaults to false, which disables its
filtering (docs.kie.ai). This gateway does no moderation of its own, so every
kie row that exposes the parameter sends `nsfw_checker: true` (#277 fixed Wan
2.5, which 0106 had switched on without it). Kling 2.6, Nano Banana Pro and
the speech row expose none.

## Update (2026-09-24): staged GrsAI Nano Banana Pro route (0111)

Add GrsAI behind the same generation gateway and money spine. ApiPass is not
integrated: its documented Kling 2.6 create endpoint returned HTTP 404
(`Model type not found or not configured`) in the authorised smoke test.

### Verified scope and cost

The owner authorised up to $2 total for initial GrsAI/ApiPass tests and manually
funded GrsAI. One direct GrsAI task, `15-e87e0b94-981a-4f63-8c1d-ce511920333d`,
succeeded in 41 seconds with a visually inspected 2048x2048 PNG. GrsAI's
consumption log charged 1800 credits (333000 -> 331200). On the purchased
$5 / 333000-credit pack, that is $0.027027... per image, about 70% below kie's
$0.09. This is a single provider smoke test, not evidence of model provenance,
long-term reliability or deployed Veyrnox end-to-end completion. The new
adapter also re-read that successful task with the saved key without another
paid submission.

0111 stages `nano-banana-pro-grsai` **inactive** at 2 Veyrnox credits. The
four-decimal cost column rounds conservatively up to $0.0271. This uses the
existing ADR-0014 floor and leaves the live kie row and Credit Packs unchanged.
At current pack rates, two credits cost $0.15-$0.20, with 82%-86.5% generation
margin before payment fees, storage, support and other costs. A proposed $0.09
retail price would have about 70% generation margin, but needs a separate
credit/pack pricing decision; this change does not implement it.

### Completion and security

- `packages/adapters/grsai.js` calls the fixed global API `grsaiapi.com` with
  `GRSAI_API_KEY`: POST `/v1/draw/nano-banana` for submission and POST
  `/v1/draw/result` for reads. No caller can supply an API host or model.
- Requests pin `nano-banana-pro`, `imageSize: 2K`, `webHook: -1` and
  `shutProgress: true`. One output; text-to-image only. Prompt/aspect bounds
  are checked before debiting. No image edit, paid upscale or model fallback.
- No unsigned webhook is exposed. The existing five-minute Worker cron
  polls with our key and verifies that each response names the requested task.
  Up to 50 oldest unfinished jobs are read, five concurrently; storage is
  serial with a 20 MB image cap and a three-minute work budget. This
  introduces up to a polling interval of completion latency under normal load;
  sustained backlogs need a queue before broad rollout.
- Only terminal API outcomes reach `completeJob`: the existing event dedup,
  job transition, R2 storage and idempotent ledger refund. A provider failure
  is refunded using our job's user and credits. A still-running task after
  30 minutes fails with `provider_timeout`; transient read errors retry at
  the next tick. The database's stuck-job sweep remains the backstop.
- The scheduled handler passes R2 credentials explicitly from `env`; it
  cannot depend on a request's `process.env`. Existing webhook callers keep
  their default configuration.
- Output URLs reportedly expire after two hours. Only the exact observed
  host `file6.aitohumanize.com` is added to the provider-specific R2 allowlist.
  No wildcard, no redirects and no provider key on CDN downloads. A new host
  fails closed until separately verified. Existing size limits and content
  sniffing remain in force.
- A rejected submit follows the gateway's existing refund path. Paid submits
  are never retried automatically, including ambiguous timeouts. Transient
  result/storage failures retry completion without buying another image.

### Rollout

Deploy the code with the catalog row inactive. Provision `GRSAI_API_KEY` via
`wrangler secret put` without printing it. Validate the deployed
submit -> authenticated poll -> R2 -> STORED path and failure/refund path in
an isolated test environment, and verify the current output host and charge.
Provider data handling and production suitability remain unverified by this
technical smoke test. Activation/swap is a separate migration through the
owner-approved `apply-migrations` workflow on main (ADR-0023); never direct SQL.
No production activation or pack-price change is part of this staging change.

## Update (2026-09-24): Hailuo output verified; activation prepared (0112)

The remaining resolution check for `hailuo-02-kie` is complete. On kie's
Logs page, task `408da84ad1071e48a5ec5bc42d1c7de8` shows success and a
30-credit charge ($0.15). The Result preview's loaded HTML video metadata is
**1366x768, 5.875 seconds**, matching the nominal 6s 768p tier. The output is
served from `tempfile.aiquickdraw.com`; the earlier adapter run recorded
HTTP 200 without redirect. This inspection reused the existing paid result.

0112 activates this row as "MiniMax Hailuo 02" and deactivates the fal row
`minimax-hailuo-02` in one guarded DO block. A missing row or a changed kie
endpoint, cost or billed unit aborts the whole swap. Replaying it is harmless.
The fallback model and SUNSET DRIFT preset move together to 10 credits.

| One nominal 6s Hailuo clip | Before (fal) | After (kie) |
|---|---:|---:|
| Supplier cost | $0.27 | $0.15 |
| Veyrnox credits | 17 | 10 |
| Retail at current pack rates | $1.275-$1.70 | $0.75-$1.00 |

That is a 41% reduction in credits and a 44% reduction in supplier cost.
The gateway still sells one unit, pins duration `6` with `nsfw_checker: true`,
and exposes no 10s option. The established signed kie callback, result re-fetch,
R2 copy and refund paths are unchanged. A Hailuo-specific generation through
the signed-in app remains unverified; this is provider-output verification,
not a claim that that app test ran.

This migration follows the owner-approved production workflow. Seedream's
4 -> 4.5 decision, the failing kie speech row and GrsAI activation are separate.
Rollback is a new guarded migration making the fal Hailuo row active and kie
inactive, with the matching fallback/preset reversal.

## Update 2026-09-24 — second verified GrsAI output host

An isolated Docker integration run submitted one real Nano Banana Pro 2K
request through the generation route handler. GrsAI task
`11-ab2a57ac-a29f-46f6-8286-4e214e2498a4` succeeded but returned an image
from `file1.aitohumanize.com`; the existing exact-host allowlist correctly
refused it because only `file6.aitohumanize.com` was known.

An authenticated read of the same task and a direct unauthenticated output
fetch verified HTTPS, HTTP 200 without redirection, image/png, 5,241,901 bytes,
and a decoded size of 2048 x 2048. Add only this exact hostname alongside
file6. No wildcard, redirect, credential-forwarding or size-limit change.
Regression tests cover successful storage from both hosts, absent CDN auth,
lookalike hosts, unknown siblings and redirects.

The integration uses local Postgres/PostgREST and a TLS S3 emulator, with
direct route and sweep invocation. It does not verify production JWT
middleware, Cloudflare cron scheduling or actual R2 deployment. GrsAI stays
inactive pending those deployment checks. This fix requires no migration.
