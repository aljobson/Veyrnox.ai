# Deployed controlled callback recovery exercise — 9 October 2026

The separate `workers/staging-fal-callback-worker.js` invokes the handler extracted in PR #778. It exposes only HTTP 404 and consumes exact, expiring, allowlisted queue references. Public application callbacks retain real fal signature verification. Internal requests use a controlled verifier; this exercise is not evidence of fal signature verification or provider redelivery.

Before invocation the worker pins the staging database, public origin and queue, validates the fixture user/model, checks the job's exact synthetic provider handle and allowed state, and requires a native fixture bucket binding. Production, expired, unlisted and ownership-mismatched work retries before mutation. The copy adapter writes a known 68-byte PNG rather than fetching provider output. RPC calls use real staging `job_succeeded` and `job_stored`; inbox reads/writes are real PostgREST. No global fetch or process environment is changed.

## Observed cases

Consumer version `93cb9e78-238f-4fd1-9266-cd23f934e9a4` ran the two dashboard-published references on the real staging queue. Both emitted `passed:true` with delivery statuses `[500,200,200]`.

| Fixture | Scenario | Observed effect |
| --- | --- | --- |
| `ede5f28b-ea20-4ac2-91e4-3e533d573d83` | Copy adapter fails before write | Two copy adapter calls, one successful bucket write, one registration; retry and terminal duplicate completed. |
| `308621b2-a644-4734-8b46-2c6e79486da4` | Registration commits, acknowledgement is discarded | One copy and one real registration; subsequent delivery completed the inbox without another copy. |

Database readback showed both jobs STORED and exactly one asset and one ledger entry per job. Each asset records 68 bytes and SHA-256 `c7357bda527de8ea320ffa03d4db58668c9ad52ab038efc4d840a59df7dcae02`. The dedicated fixture user `2511e237-a61a-4d88-87ce-c837a7b1e624` used four test credits (10 → 6); no refund is due for these completed fixture jobs. The inactive model remains `deployed-fault-84850a43`. No fal submission occurred.

The private bucket `veyrnox-staging-callback-fixtures` retains only the controlled exercise objects for audit. It is distinct from application media storage. These fixture asset registrations therefore do not establish Library delivery from the application's media bucket. The object keys are `fal/staging-callback-<fixture UUID>/5e1b88b42a1fcad8.png`; no signed asset URL was generated.

## Restoration and repeat protocol

Original consumer version `d623e77d-4356-4de0-8ac6-ab508eb38667` was captured before replacement. Restored version `396c84d5-ab58-400a-b9d7-b4cb381362c5` uses the ordinary consumer, original variables, empty cron schedule and no temporary bucket binding. Readback confirmed exact plaintext-variable and secret-name equality; all `FAL_CALLBACK_*` bindings were removed. The application and production configuration were not changed by this exercise.

For a repeat, capture the live configuration first; provision fresh dedicated ledger-backed jobs and synthetic mappings. Verify the model is inactive and dedicated test ownership before adding their exact IDs to the two-scenario plan. Bind only the private fixture bucket; use the existing consumer credential without retrieving it. Set an expiry within fifteen minutes, capture logs, publish each reference once, and inspect job/inbox/asset/ledger state. A queue redelivery of a STORED fixture acknowledges without running another exercise. Restore the ordinary disabled consumer using the captured complete variable set, preserving secrets, and confirm queues and aggregate health afterward. Retain financial and object evidence; do not reset job states.

The fixture injection proves deployed handler recovery around controlled copy failure and a committed registration acknowledgement loss. It does not force an actual R2 service outage, validate provider-signed early delivery, prove fal retry behavior, exercise the application's media bucket, or measure sustained throughput. Admission failure, provider transport uncertainty, capacity and the clean monitoring window remain distinct rollout gates.

Post-restoration [health run 38001241720](https://github.com/aljobson/Veyrnox.ai/actions/runs/38001241720) passed at `2026-10-09T22:49:20.694Z`: both queues empty, all thirteen recovery counts zero, no unhealthy tasks/issues and all five reconciliation drift counts zero. Both inbox events have processed timestamps. Independent remote object retrieval confirmed both 68-byte files match the recorded SHA-256. The relevant 41-test suite passed; the Worker packaging dry-run succeeded.
