# Deployed staging transport validation — 2026-10-10

PR #791 was squash-merged as `d077d0a1be3c3c6d8c37f1f167f6a46cc2c84c3b` before this exercise. The owner authorized deployed staging transport testing. This exercise used no actual fal network submission or billable provider work and changed no production resource.

The real Cloudflare queue, deployed consumer, JavaScript adapter and staging PostgREST RPCs were used. An injected adapter transport sent the adapter's original POST to a private Worker service binding. The private service read the body and either discarded the reply or interrupted an HTTP 200 JSON body. These are deployed HTTP service-binding faults, not internet TCP resets or proof of fal acceptance/billing. The existing eight localhost HTTP/Postgres cases separately cover actual socket loss and timeout.

## Bounds and versions

Both Workers required the exact staging database, callback origin, queue, two UUID references with distinct scenarios, explicit exercise enablement and an expiry no more than fifteen minutes away. The deployed expiry was `2026-10-10T07:37:49.238Z`. Unlisted messages retry without database access. There was no HTTP dispatch route. The fixture had no public route, workers.dev URL or credentials. Submission substituted an inert credential and used only the private binding; the real FAL_KEY was never sent.

| Resource | Exercise version |
| --- | --- |
| Consumer | `093f4e65-4afb-48bf-b96c-8bf3e1e4cd73` |
| Private fixture | `ff72ddb6-6654-4c9c-878e-db936fc1cb04` |
| Application with schema recovery temporarily disabled | `33a8a3d6-6f73-4a1f-ac90-34f6b9ce67bc` |

Application admission, publication and submit-outcome activation stayed false; the capacity policy stayed disabled with no provider account. The queue retained batch size one, concurrency two, three retries and its existing DLQ. Both Workers had no cron. Application recovery was paused before fixture admission and restored after cleanup.

`scripts/provision-fal-transport-staging.sql` requires an idle disabled baseline. It creates a fresh test identity and a controlled model, makes one two-credit debit and one free-allowance claim, inserts two pinned dispatch payloads and held reservations, then deactivates the model before commit. This is operator fixture DML, not a migration or general admission path. The SQL passed a disposable local rollback check before staging execution.

## Observations

Fixture user: `e88fcbd8-2c05-4e2c-a297-f25d0451714c`; inactive model: `transport-fixture-da464b8b`. Initial balance was ten, then eight after the single debit. Subscription balance was zero.

| Case | Job | Initial consumer result | Explicit duplicate |
| --- | --- | --- | --- |
| Paid: lost reply and lost evidence acknowledgement | `21b9b8a3-0e55-46cf-9ba4-5ca129749a69` | One POST, two identical evidence writes, UNKNOWN, 937 ms | Zero POSTs/writes, ignored ACK, 243 ms |
| Free: interrupted success body | `90714890-8a42-46aa-97c4-b7981319afe3` | One POST, one evidence write, UNKNOWN, 304 ms | Zero POSTs/writes, ignored ACK, 133 ms |

Initial deliveries ran at 07:29:06.896 and 07:29:08.313 UTC; explicit duplicates at 07:29:37.421 and 07:29:38.283 UTC. Tails observed four successful consumer invocations and exactly two private-service receipts. Fixture exceptions are the intended faults. The first evidence acknowledgement was deliberately lost only after the real RPC returned; the consumer repeated the evidence write without repeating submission. Curated counts, IDs, versions and timestamps are retained in [the evidence JSON](fal-deployed-transport-evidence.json).

Database readback after both duplicates showed two DEBITED jobs, two UNKNOWN dispatch rows, null provider IDs, non-null attempt tokens and two unreleased reservations. Balance remained eight; there was still one paid debit and one TAKEN allowance claim, with no refund. The tokens were `a19c03fa-2fe5-4821-aa48-cc030d16ae55` and `58b8cd03-fa20-4731-991f-6fe28462413a` respectively.

## Restoration and final health

The consumer was first rolled back to original version `396c84d5-ab58-400a-b9d7-b4cb381362c5`. Settings inspection still exposed the most recently uploaded exercise configuration, so the ordinary consumer was redeployed from the merged source/configuration. Final version `fbcc0a64-91a3-47d3-ad76-0f123bf8d53b` had the original plaintext variables and binding names/types, consumer execution false, schema true and no service binding or cron. Secrets were preserved without reading their values.

Only these two controlled fixtures were operator-refunded through the normal ledger RPC, twice each to verify idempotency. Paid balance returned to ten with exactly one refund ledger row; the free claim became RETURNED with no credit grant. Because these synthetic POSTs reached only the private fixture and never fal, the exact two dispatch rows were explicitly closed and reservations released as NOT_SUBMITTED. This exceptional fixture closure preserved attempt tokens and timestamps, with guarded row counts; it never reset STARTED/UNKNOWN for resubmission. UNKNOWN evidence from a real provider would not justify this release.

Application schema recovery was restored true as `e02210e0-04cd-46f7-946a-7d9ad9f8d053`; all other bindings were preserved. Its original five-minute cron remained. Full plaintext variable, binding metadata and cron comparisons matched the captured baseline for both application and consumer. The private fixture was deleted after its binding was removed, with a 404 readback. Local tails and the disposable Postgres server were stopped.

Final database readback showed disabled capacity, admission pause false, zero held reservations, zero pending dispatches, and zero drift in balances, free credits, subscription credits, free allowances and referrals. The first monitor [38034710472](https://github.com/aljobson/Veyrnox.ai/actions/runs/38034710472) reported two cached UNKNOWN counts from the deliberate exercise despite completed cleanup. Recovery health was refreshed, then [38034787005](https://github.com/aljobson/Veyrnox.ai/actions/runs/38034787005) passed at 07:32:55 UTC: both approximate queue backlogs zero, all recovery counts zero, no unhealthy tasks, and all five drift counts zero. Oldest queue age was unavailable; no age measurement is claimed. The resulting exercise-only alert issue #794 was closed after the successful health run.

## Validation and remaining scope

Twenty-eight focused unit tests passed, including four new fixture/allowlist/duplicate tests. All eight real HTTP/consumer/Postgres regression cases passed after the adapter gained the optional internal fetch argument; default transport behavior is unchanged. Reticle was skipped because this operator/test change has no browser UI surface.

The deployed controlled uncertainty gate now has measured evidence. Actual provider acceptance uncertainty, provider-signed callback/redelivery, sustained eligible READY load, account-wide quota/headroom and a continuous clean monitoring window remain separate production requirements. These two fault samples are not throughput or percentile evidence and do not authorize production activation.
