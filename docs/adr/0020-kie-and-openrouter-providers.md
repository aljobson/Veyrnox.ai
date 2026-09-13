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
