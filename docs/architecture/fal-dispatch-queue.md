# fal dispatch queue implementation and staging plan

This implements the code boundary in [ADR 0077](../adr/0077-fal-event-driven-dispatch.md). Queue resources and secret bindings are not provisioned; producer and consumer flags default false. Existing durable-admission and production activation gates still apply.

## Implemented path

After `admit_fal_dispatch` confirms a job, the generation route calls `publishFalDispatchWakeup`. It uses OpenNext's request-scoped Cloudflare context and attaches a bounded send to `ctx.waitUntil`. The message contains only `{version:1, job_id}`. Equal replay can publish another reference. Missing request context, missing binding, rejection, or timeout logs a redacted event while preserving the committed 202/200 response. A lost admission acknowledgement remains 503 and publishes nothing.

`workers/fal-dispatch-worker.js` is a dedicated consumer with no HTTP dispatch endpoint. It checks the physical queue name, strict message shape, runtime configuration, initial recovery health, and invocation budget before calling service-only `claim_fal_dispatch(job_id)` from migration 0231. Malformed messages are acknowledged without database access. BUSY or uncertain pre-claim work is retried with a thirty-second delay; missing/ineligible/expired work is acknowledged.

Both cron and consumer use `runFalDispatchAttempt`: one fifteen-second fal request, up to two identical evidence writes, and bounded projection/recovery. UNKNOWN or an evidence/projection failure acknowledges the attempted message and stops new spending in that consumer batch. Further references are retried; a redelivery cannot reclaim STARTED. Cron keeps its existing ten-attempt, three-minute budget and five-minute recovery cadence. The consumer handles at most ten valid references per invocation and reserves fifty seconds before claiming, including a second budget check after initial recovery.

The dedicated consumer receives only its database URL, service-role secret, fal key, controlled public callback origin, and flags. It needs no R2 or browser credential. Signed completion and private asset storage stay in the application Worker.

## Cost review inputs

For references under 64 KB, a normal delivery uses three operations. Cloudflare's published pricing includes 10,000 operations/day on Workers Free, or 1,000,000 operations/month on Workers Paid followed by $0.40 per million operations. Retries and dead-letter writes add operations. These are platform prices, not verification of this account's plan or remaining shared allowance. See [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/).

| Illustrative eligible load | Normal queue operations | Incremental paid queue charge with full monthly allowance available |
| --- | --- | --- |
| 5,000 jobs/day, 30 days | `5,000 × 30 × 3 = 450,000/month` | $0 |
| 50,000 jobs/day, 30 days | `50,000 × 30 × 3 = 4,500,000/month` | `(4.5−1) × $0.40 = $1.40/month` |

If other queues already consume the allowance, those examples add up to $0.18 and $1.80 respectively. The initial example's 15,000 operations/day exceeds the published free daily allowance. Consumer Worker requests/CPU, RPC load, duplicate references, retries, dead-letter handling, and provider calls are excluded from these estimates. Confirm the account plan and actual usage before provisioning; no billing upgrade is implicit in this code.

## Staging resource plan

1. Verify the account, permission scope, plan, latest application/consumer revision, staging database identity, and staging migration ledger through 0231. Apply missing staging schema through the migration tool before turning on a consumer. Production DDL stays in the protected workflow.
2. Create distinct staging queue and dead-letter resources, proposed names `veyrnox-fal-dispatch-staging` and `veyrnox-fal-dispatch-staging-dlq`. Verify their identifiers and retention. Do not reuse production queue names, secrets, or databases by accident.
3. Add the producer binding `FAL_DISPATCH_QUEUE` under `env.staging.queues.producers` in the application config. Add the consumer under `env.staging.queues.consumers` in `wrangler.fal-dispatch.jsonc`. Named environment settings must be explicit. Initial candidates: batch size 1, wait 0 seconds, concurrency 2, three retries, delay 30 seconds, and the staging dead-letter queue.
4. Provision consumer `SUPABASE_SERVICE_ROLE_KEY` and `FAL_KEY` through a protected secret workflow; never fetch browser credentials, copy secrets into code, or log their values. Verify that its PUBLIC_HOST points to the existing staging signed callback route. Enable schema access and consumer execution only after verifying the target.
5. Build and dry-run the application and dedicated consumer against the exact staging configurations. Preserve independent live staging overrides before any deployment. Deploy the consumer first; then enable only staging `FAL_DISPATCH_QUEUE_ENABLED` and bounded durable admission. Producer and consumer controls are independent so producer rollback can leave committed work draining.
6. Run controlled failure tests before a bounded live generation. Capture admitted job/attempt IDs, actual queue delivery, claim latency, provider handle, signed completion, ledger effects, and private stored asset. Compare latency with the earlier 201.67-second cron wait. Local fixtures and a bundle dry-run do not establish queue delivery or a p95 target.
7. Verify queue failure alerts, exhausted pre-claim references, queue/cron races, provider headroom, RPC amplification, cost, signed-in Library behavior, callback redelivery, and twenty-four hours clean reconciliation/recovery before wider admission. A consumer concurrency cap limits submission handlers, not accepted fal generations still running.

`wrangler.fal-dispatch.jsonc` deliberately has no queue binding. Its dry-run validates the bundle and environment schema; deploying it as-is does not establish a working queue consumer. There is no automated consumer deployment workflow yet.

## Rollback and investigation

Disable producer publication first, keeping consumer and cron recovery active. A hard consumer pause degrades dispatch latency and must be reported. Pre-claim failures can exhaust delivery retries and reach the dead-letter queue; cron still owns recovery of eligible READY work. Never reset STARTED/UNKNOWN, resubmit from retained accepted evidence, or refund directly from a queue message. Signed callback and existing sweep rules decide completion/refund.

Redacted events include `generation.dispatch_wakeup_failed`, `generation.dispatch_queue_mismatch`, `generation.dispatch_queue_invalid`, `generation.dispatch_claim_invalid`, `generation.dispatch_queue_batch`, and the existing `generation.durable_dispatch_unknown`. Unknown evidence retains a known handle for operator/provider-spend review. Queue alerts and live latency/cost measurements remain deployment acceptance work.
