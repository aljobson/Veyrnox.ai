# ADR 0075 fal submission outcomes

Status: proposed; first code slice built behind `FAL_SUBMIT_OUTCOME_ENABLED="false"` in production and staging. Date: 8 October 2026. No environment activation is implied.

Related: [System design proposal](../architecture/system-design.md), [ADR 0009](0009-fal-429-retry-policy.md), [ADR 0066](0066-jev-provider-submit-error-classifier.md).

## Problem

Generation debits before submitting to fal. A connection failure or timeout can occur after fal accepted the request. The old adapter reports that as unsuccessful, and the route refunds immediately with `provider_submit_failed`. A malformed acceptance reply and a failed `job_submitted` acknowledgement also leave uncertainty. Declaring rejection encourages a fresh paid request while the original provider work may still exist.

fal's [queue documentation](https://fal.ai/docs/documentation/model-apis/inference/queue) describes acceptance returning a request ID, which must be stored for later status/result operations. Losing that response does not establish whether submission was accepted. Its [webhooks](https://fal.ai/docs/documentation/model-apis/inference/webhooks) are a completion mechanism; existing callback authentication and provider-handle correlation remain unchanged.

## Decision proposed

Normalize fal submit results as `accepted`, `rejected`, or `unknown`, alongside the existing `ok` field. Local validation failures are rejected before dispatch. Treat HTTP 4xx except 408 as refusals, preserving 429's no-retry/refund policy. Treat transport errors, HTTP 408, server errors, malformed/oversized acceptance JSON, and missing or invalid provider IDs as unknown. This is a conservative application policy, not a claim that fal provides submission idempotency.

Bound submit response bodies to 128 KiB and apply the submission timeout to both headers and body reads. The adapter never retries submission.

When the flag is on for a fal job:

- Explicit refusals keep the current typed-classification and idempotent refund path.
- Unknown results return HTTP 503 `{error:"outcome_unknown",job_id}` with `Cache-Control: no-store`. Existing Studio error copy directs users to Library before trying again. A batch stops at that response.
- Record `provider_outcome_unknown` using the existing `job_submit_rejected` RPC, which only annotates an unsubmitted DEBITED job. It does not move state, create ledger rows, or refund. If annotation fails, still return uncertainty with the durable job ID and emit a structured event.
- If fal returned an accepted ID but persisting `job_submitted` throws or reports `ok:false`, return the same uncertainty response. A structured persistence event records the accepted handle for operator investigation. It contains no credentials or signed URLs. A lost RPC acknowledgement may hide a successful state transition, so do not assume the job is still DEBITED.
- Replay of the same idempotency key uses the existing job and never calls fal again. Annotation is not repeated by replay, so replay does not extend the stuck-job deadline.

The default-off path retains the route's existing immediate-refund response for unsuccessful submissions. Other providers, Chat, and composite orchestration do not adopt this contract in this slice. Their accepted-handle write is extracted into a common helper without changing their public responses.

## Bounded fallback and limits

This slice does not implement durable dispatch, a callback inbox, automatic missing-handle recovery, or payload fingerprinting. No schema, credit-price, or ledger-RPC definition changes.

The current `sweep_stuck_jobs` uses a 15-minute DEBITED threshold and runs on a ten-minute database schedule. An unresolved unsubmitted job remains eligible for its existing idempotent refund. With a healthy uncongested sweep this is normally the first eligible sweep after that threshold; batch limits and outages prevent a strict wall-clock guarantee. The existing free-job refund path returns the allowance instead of minting Credits.

An accepted request whose handle never reaches durable storage may remain uncorrelatable by the existing fal webhook. Do not weaken webhook authentication or bind an arbitrary callback by its query-string job ID to solve that gap. Operators must use provider evidence and the persistence event where available. A refund can leave Veyrnox paying for provider work it could not deliver. That cost and the delayed-refund user behavior need acceptance before activation. Never auto-resubmit or charge again to compensate for a late result.

## Rollout and acceptance

Keep the flag false until the proposal is accepted. On staging, test an explicit 422/429 refusal, transport timeout after provider acceptance, missing/malformed handle, failed handle write including lost acknowledgement, replay, free allowance, annotation outage, and eventual stuck-job refund. Use controlled adapters for failure injection; a paid live test needs a bounded approved spend.

Verify the existing database sweep, recovery monitoring, and allowance/refund behavior against staging, then require 24 hours clean reconciliation before production activation under the existing delivery rules. Rollback sets the flag false for new requests; existing uncertain jobs still finish or refund through their recorded state and sweeps. No production deployment or database write is part of this code slice.

Next: atomically commit job/debit/dispatch intent, persist attempt evidence, and recover accepted-but-unrecorded provider handles without another billable submission.

## Local verification

The focused adapter/gateway/regression run passed 37 tests. After restoring dependencies from the committed lockfile, the full suite passed 1,725 tests with one skipped. Lint passed with 74 warnings outside the changed code, and `APP_ENV=production npm run build:worker` completed successfully. Staging sweep/refund acceptance and activation remain outstanding.
