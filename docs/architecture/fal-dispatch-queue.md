# fal dispatch queue implementation and staging plan

This implements the code boundary in [ADR 0077](../adr/0077-fal-event-driven-dispatch.md). Isolated staging queues, consumer credentials, and the application producer binding are deployed. Bounded consumer and signed-in Create-to-Library tests passed, including request-scoped application publication. Producer, durable-admission, and consumer flags are false after the tests. Existing production activation gates still apply.

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

Production has no queue binding. Staging bindings use the isolated resources below. A dry-run validates the bundle and configuration; it does not establish live queue delivery.

## Staging provisioning evidence — 2026-10-09

Migration `0231_fal_targeted_claim` was applied to staging `yrqzwqywxfesmbvhzjgj` as version `20261009083938`. A nonexistent-job probe returned MISSING; anon/authenticated execute access is false, service-role execute is true. Balance, free-credit and subscription-credit reconciliation each returned zero differences. Production schema was not changed.

Queues were created in account `fb18d9f7052afbea5a5e0eae69948af2` with zero delivery delay and 86,400-second retention. Both had zero producers/consumers immediately after creation. Names and IDs were verified through the control plane; existing queues were untouched. Queue creation used the existing Wrangler OAuth permission `queues:write`. Account subscriptions returned HTTP 403, so the billing plan and available shared allowance remain unverified. No plan change or test message was made. The retention value is supported on both published plans; confirm billing before traffic.

| Staging resource | Verified queue ID |
| --- | --- |
| `veyrnox-fal-dispatch-staging` | `93f44fe046034ccda42a6014ccdaa6f7` |
| `veyrnox-fal-dispatch-staging-dlq` | `25500fbb12af4b558982e08d6b337ab8` |

The application config adds only a staging producer binding. The dedicated staging consumer config uses batch size 1, wait 0, concurrency 2, three retries, thirty-second retry delay and the isolated dead-letter queue. Producer publication and consumer execution remain false; staging schema access is true after applying 0231.

The dedicated staging consumer was deployed disabled as version `56ceb24b-f64a-4cdb-bfe9-3396d12e87ae`. Its queue trigger is registered; no HTTP route or workers.dev endpoint is exposed. Remote settings verified consumer execution false, schema access true, staging database/callback origins, and the exact queue tuning above. Secret list is empty; the queue has one consumer and zero producers, and the dead-letter queue has neither. No runtime secrets or test messages were installed at deployment time. Application and consumer dry-runs passed; the application dry-run retained the repository's existing warnings about omitted staging vars. The shared application was not deployed.

`.github/workflows/fal-dispatch-staging.yml` runs manually on current main in GitHub environment `fal-dispatch-staging`, restricted to the main branch and owner review. It checks required credentials and the staging-only nonexistent-job RPC, validates the bundle, deploys the disabled consumer, and provisions only its two runtime secrets through stdin. It cannot enable publication or consumer spending, and does not deploy the shared staging application. Secret upload creates a deployment; the consumer is deployed disabled before upload. See [Wrangler secret bulk](https://developers.cloudflare.com/workers/wrangler/commands/#secret-bulk) and [GitHub deployment environments](https://docs.github.com/en/rest/deployments/environments).

The protected environment requires `CLOUDFLARE_API_TOKEN` with Worker-script and Queue write access on this account, staging `SUPABASE_SERVICE_ROLE_KEY`, and `FAL_KEY`. The owner subsequently saved these through [environment settings](https://github.com/aljobson/Veyrnox.ai/settings/environments). Values are not exportable. No credential was copied from browser state or deployed code.

The live staging application still has independent `AGENT_VIDEO_ENABLED=true`, `MONTAGE_LIVENESS_ENABLED=true`, and its montage runner URL. Those settings were read and left unchanged. At initial provisioning, application producer deployment and consumer credentials were pending; the later verification below supersedes that snapshot. Failure alerts, Library acceptance, and the clean recovery window remain pending.

## Bounded delivery failure acceptance — 2026-10-09

Two explicit [HTTP publications](https://developers.cloudflare.com/queues/examples/publish-to-a-queue-via-http/) exercised only the isolated staging queue while consumer execution was false and its secret list empty. The fixture reference was `7b4fe9d4-dea2-4f54-b3e0-0644e7d0a5e5`, with no corresponding database job or dispatch row. The bodies contained only version and job ID: version 0 tested malformed-message handling; version 1 tested disabled-consumer retries. Each publication was attempted once; local write markers prevented rerunning an uncertain send. No app admission, provider credential, prompt, credit operation, flag change, or plan change was involved.

| Observed event (UTC) | Result |
| --- | --- |
| 08:50:32.855 / 08:50:33.051 | HTTP publications confirmed |
| 08:50:35.968 | Malformed reference: ignored 1, retried 0, submitted 0 |
| 08:50:36.397 | Valid reference: first delivery, retried 1, submitted 0 |
| 08:51:07.322 / 08:51:37.784 / 08:52:08.433 | Three more deliveries, each retried 1 and submitted 0 |
| 08:52:09.108 | Exact version-1 body observed in the isolated dead-letter queue |

Wrangler tail identified consumer version `56ceb24b-f64a-4cdb-bfe9-3396d12e87ae` on all five invocations. The malformed reference was acknowledged once. The valid reference exhausted the configured initial delivery plus three retries, with observed gaps 30.925, 30.462 and 30.649 seconds. Its dead-letter message ID was `63fb2eb27afabadf92f825165f789cd4`. [Peek](https://developers.cloudflare.com/api/resources/queues/subresources/messages/methods/peek/) observed the body without leasing it. Targeted cleanup used only that fixture's returned ref; no queue-wide purge or financial deletion occurred. Both queue peeks were empty after cleanup.

Post-test reads confirmed zero fixture jobs/dispatch rows, the original single durable dispatch row, and zero balance/free/subscription reconciliation differences. Account Worker settings reported `default_usage_model=standard`; subscription billing and remaining shared allowance are still unverified. This bounded probe made two writes and five observed consumer invocations, not a load or cost measurement.

These are live delivery/ACK/retry/dead-letter checks. They do not validate enabled database claims, provider submission, request-scoped application publication, normal-path p95 latency, or alerts. Every platform invocation had `outcome=ok`, including the four batches whose application metric was `ok=false`. Monitoring must inspect application retry/failure counters and dead-letter arrivals, not only Worker exceptions. Operator alert configuration remains an activation gate.

## Enabled consumer acceptance — 2026-10-09

Owner-approved [protected workflow run 37913389084](https://github.com/aljobson/Veyrnox.ai/actions/runs/37913389084) succeeded on main `a76e63d23d316e3fd43b67e250159870d750f890`. It validated the staging RPC and deployed the disabled consumer with both runtime secrets. The preceding run correctly stopped at its current-main guard when main advanced. Secret names/types were inspected; values were not read or logged.

Before the bounded test, staging had no READY dispatch rows and both queue peeks were empty. The shared application already had its isolated producer binding, but `FAL_DISPATCH_QUEUE_ENABLED`, `FAL_DURABLE_DISPATCH_ENABLED`, and `FAL_SUBMIT_OUTCOME_ENABLED` were false. Its schema flag was true. The shared application was not redeployed during this test.

The dedicated consumer bundle passed a dry-run, then was temporarily enabled as version `2a1578d7-81a4-42ce-983f-bbc7597a81aa`, preserving secrets with `--keep-vars`. An absent-job reference (`a3d23730-d527-438a-85b0-dbc2522a029a`) and the prior STORED fixture reference were each acknowledged: ignored 1, submitted/failed/retried 0, application `ok:true`. This exercised the enabled recovery/claim path without a new provider call.

One private RPC admission used existing fixture user `2bb45f45-414e-4945-bc81-f6e0d8772e1f`, key `fal-queue-stage-20261009-smoke-01`, model `flux-2-pro`, endpoint `fal-ai/flux-2-pro`, and the same teapot prompt as the earlier cron fixture. Publication used the queue HTTP API, with a local write marker preventing accidental replay after an uncertain acknowledgement. Public admission and request-scoped application publication remained disabled.

| Event | UTC time / evidence |
| --- | --- |
| Admission | 09:56:44.305664; job `afcb8e97-8b74-4bb7-95df-738084900cfc` |
| Queue publication confirmed | 09:56:52.304 |
| Consumer invocation | 09:56:53.479; submitted 1, failed/retried/ignored 0, `ok:true` |
| STARTED claim | 09:56:53.778293; attempt `64616d08-f5d5-4b5d-ba98-568775b2b632` |
| ACCEPTED evidence | 09:56:54.042763; provider `01a12018-1e4e-7111-b0f6-a793ff7bb150` |
| Handle projected | 09:56:54.125079 |
| Signed callback processed | 09:57:03.191; fal webhook row created 09:57:01.866445 |
| STORED | 09:57:03.206412; asset `f227357e-2d65-4716-a803-44e4850e120c` |

Publication-confirmation-to-claim was **1.47 seconds**. Admission-to-claim was **9.47 seconds**, including approximately eight seconds of manual publication delay; admission-to-STORED was **18.90 seconds**. The earlier cron fixture waited 201.67 seconds to claim. These are individual observations, not p50/p95/p99 results or proof of authenticated API latency. Consumer wall time was 690 ms and CPU time 4 ms for this invocation; neither establishes sustained capacity.

The registered JPEG has 128,275 bytes and a SHA-256 value. Exactly one job and one ledger debit exist for this key: delta -2, Free delta -2, Subscription delta 0, no refund. Fixture balance moved 8 → 6. Equal admission replay returned the same STORED job and balance 6; changed input returned `IDEMPOTENCY_CONFLICT`. A deliberate duplicate reference was acknowledged at 09:57:39.319 with ignored 1 and submitted/failed/retried 0. The attempt token and provider handle remained unchanged. No provider retry or state reset occurred; live fixture financial evidence is retained.

Both queue peeks were empty after completion. Balance, Free Credit, and Subscription Credit reconciliation each returned zero differences. Recovery status had no unhealthy tasks and zero in every returned queue counter. The catalog's $0.03 provider estimate is not an invoice measurement. Four publications and four consumer invocations do not establish account allowance, load headroom, or operating cost.

Consumer execution was restored to false as version `725b7922-814b-4588-8ec2-f99dd443c6cb`. Remote readback verified schema access true, both runtime secret names retained, queue tuning unchanged, and the shared application's publication/admission flags still false. Cron recovery remains enabled; production was not changed.

Request-scoped producer integration, authenticated gateway and Library behavior, live callback redelivery/fault injection, alerts, provider headroom, load percentiles, billing verification, and the twenty-four-hour clean gate remain outstanding. The earliest recorded clean window runs through 10 October 05:21:47 UTC; this spot check does not certify that window.

## Signed-in producer and Library acceptance — 2026-10-09

The owner approved one prepared Flux.2 image with a two-staging-credit limit. The in-app browser was already signed in to staging; no cookie, token, password, or browser credential was extracted. Before submission, Create showed the teapot prompt, Flux.2 [pro], one image, a two-credit Generate button, and balance 1,000. Library initially reported nine assets.

Built main `84d94a76` with `APP_ENV=staging` and the staging callback host; OpenNext build and application/consumer dry-runs passed. A temporary configuration preserved all 42 deployed plain-text variables, including the independent montage overrides. `--keep-vars` retained runtime secrets. The application deployment `9d637d13-06a4-4f84-8c6f-87112abb1c11` enabled only `FAL_DURABLE_DISPATCH_ENABLED` and `FAL_DISPATCH_QUEUE_ENABLED`; schema access remained true and `FAL_SUBMIT_OUTCOME_ENABLED` remained false. Full binding readback matched the saved snapshot except those two intended flag values. The consumer was temporarily enabled as `55de358b-3fae-4855-a188-07283f638987`.

The prepared Generate button was clicked once. The UI showed Sending, then QUEUED, and balance 998. No private admission or manual queue publication was used for this job. The dedicated consumer tail showed one actual delivery from `veyrnox-fal-dispatch-staging`, submitted 1, failed/retried/ignored 0, application `ok:true`, platform outcome `ok`, wall time 936 ms and CPU time 5 ms. The database linked that submission to the browser-created durable intent.

| Event | UTC time / evidence |
| --- | --- |
| Admission | 11:04:54.598080; job `e6af4903-c0fd-4094-919c-baecf92d4943` |
| Client idempotency key | `vx-6950ca9d-d7a2-46ed-ba7b-d69bdccd61a4` |
| Queue invocation | 11:04:55.769 |
| STARTED claim | 11:04:56.312177; attempt `7c8b01b2-8d03-4e82-941c-07900b220031` |
| ACCEPTED evidence | 11:04:56.574028; provider `01a12056-69b1-7872-b6d8-97db94b63834` |
| Handle projected | 11:04:56.663996 |
| Signed callback processed | 11:05:07.135; webhook row created 11:05:06.300442 |
| STORED | 11:05:07.196267; asset `d037eb2f-f881-446a-8814-c242407bc03e` |

Admission-to-claim was **1.71 seconds** and admission-to-STORED **12.60 seconds**. These are single healthy-path measurements, not load percentiles. Browser navigation to Library initially displayed the optimistic QUEUED item, then fetched the completed record: DONE, AI GENERATED, a rendered teapot image, the two-credit charge, ten assets, and balance 998. Its Schedule link carried the same job UUID. A completion screenshot was retained locally for owner review; no private asset URL was exported.

The JPEG registration has 114,980 bytes and a SHA-256 value. The job has exactly one `debit:generation` ledger entry, delta -2, Free delta 0, Subscription delta 0, no refund. Balance, Free Credit, and Subscription Credit reconciliation each returned zero differences. Recovery status showed no unhealthy tasks and all returned queue counters zero. Both queue peeks were empty.

Producer/admission flags were restored to false first, as application version `f4df0fa1-402a-4543-8e14-7a2312ddb998`; the consumer was then disabled as `f74d192c-03a7-43c9-85ef-b6760287607e`. Full application binding comparison again matched the original snapshot, including independent montage overrides and secret names. Consumer readback retained schema access and both runtime secret names. Cron recovery remained on. Temporary deployment configurations were removed; repository defaults and production were not changed.

This establishes one authenticated browser submission through the real application producer and a visible completed Library image. Exact HTTP response status/body, authenticated replay/conflict responses, forced publication failure, callback redelivery/fault injection, alerts, account billing, load/headroom, and the twenty-four-hour clean gate remain unverified. Local tests and the earlier private-RPC replay check do not substitute for those remaining runtime checks.

## Rollback and investigation

Disable producer publication first, keeping consumer and cron recovery active. A hard consumer pause degrades dispatch latency and must be reported. Pre-claim failures can exhaust delivery retries and reach the dead-letter queue; cron still owns recovery of eligible READY work. Never reset STARTED/UNKNOWN, resubmit from retained accepted evidence, or refund directly from a queue message. Signed callback and existing sweep rules decide completion/refund.

Redacted events include `generation.dispatch_wakeup_failed`, `generation.dispatch_queue_mismatch`, `generation.dispatch_queue_invalid`, `generation.dispatch_claim_invalid`, `generation.dispatch_queue_batch`, and the existing `generation.durable_dispatch_unknown`. Unknown evidence retains a known handle for operator/provider-spend review. Queue alerts and live latency/cost measurements remain deployment acceptance work.
