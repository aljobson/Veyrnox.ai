# Controlled staging consumer fault exercise

`workers/staging-fal-fault-worker.js` is a temporary replacement for the isolated staging queue consumer. The ordinary consumer and production configuration do not import it. It has no HTTP dispatch endpoint, and its injected submission adapter makes no provider requests.

The plan requires the exact staging Supabase URL, staging public host, staging queue name, an explicit enabled switch, an expiry within fifteen minutes, and exactly two allowlisted fixture IDs assigned different scenarios. Invalid or unlisted references retry without calling the database or adapter. The fixture endpoint must be `staging-fault/controlled`; fixture catalog models are inactive. Never place real jobs in this plan.

Scenarios:

- `lost_claim_ack`: commit the normal claim RPC, then throw away its acknowledgement. Queue redelivery must see STARTED as ineligible and make zero adapter calls.
- `lost_evidence_ack`: return synthetic acceptance, commit accepted evidence, then discard its first acknowledgement. The second write must replay the identical evidence; recovery projects the saved handle. Duplicate delivery must make zero additional adapter calls.

Before exercising, capture live application and consumer versions and all plaintext variables. Verify empty queues and no unfinished real dispatch work. Keep admission flags disabled and temporarily disable application schema recovery so the normal cron cannot claim fixtures. Preserve secrets without extracting them. Provision a dedicated fixture Auth user, inactive model and two ledger-backed jobs/outbox rows through operator SQL, retaining financial evidence.

Use a temporary consumer configuration pointing to the exercise entry point, the staging queue producer binding `FAL_FAULT_QUEUE`, and a one-minute scheduled wakeup. Configure `FAL_FAULT_JOB_SCENARIOS`, `FAL_FAULT_EXPIRES_AT`, and `FAL_FAULT_EXERCISE_ENABLED`; keep production unchanged. The scheduled handler publishes only the two allowed references. Capture `staging.fal_fault_result` and database job/attempt/evidence state.

After observing duplicate delivery, stop the scheduled producer and controlled consumer. Resolve the no-submit fixture to UNKNOWN using its recorded attempt token; refund both fixtures idempotently and verify terminal state and reconciliation. Restore the original consumer entry point, queue bindings, empty cron schedule and exact pre-exercise plaintext variables. Remove the temporary exercise variables by deploying the captured full variable set rather than preserving extra dashboard variables. Restore application schema recovery only after both fixture jobs are terminal. Keep the inactive model and test financial rows for audit; do not delete ledger evidence. Run the normal staging health workflow after restoration.

This exercise covers deployed queue/consumer/RPC behaviour. It does not exercise signed fal callbacks, provider HTTP transport, real storage copy, admission transaction failure, or sustained load. Those remain distinct rollout gates.

## Deployed evidence — 9 October 2026

Controlled version `2ef314b4-d04b-44ac-8226-4ddc970df687` used the staging database and real Cloudflare queue. The new minute cron had not propagated during this exercise, so the two allowlisted JSON references were sent through the authenticated Cloudflare queue dashboard. No unsigned HTTP dispatch or credential extraction was used.

| Fixture job | Scenario | Observed real queue behaviour |
| --- | --- | --- |
| `58bff10a-17e0-4170-9ea0-0a434c367455` | Lost claim acknowledgement | STARTED persisted; first delivery retried; automatic redelivery was ineligible and acknowledged; zero adapter calls throughout. |
| `251451ac-41ec-4f1f-9590-867233c9c92d` | Lost evidence acknowledgement | One synthetic adapter call; two identical accepted evidence writes; handle projected to SUBMITTED; explicit duplicate acknowledged with zero further adapter calls. |

The fixture model `deployed-fault-84850a43` is inactive and its endpoint is `staging-fault/controlled`. The dedicated fixture user is `2511e237-a61a-4d88-87ce-c837a7b1e624`. Both fixture jobs were refunded through the normal ledger RPC, including repeated refund calls: exactly two refund entries, fixture balance restored from six to ten, customer balance unchanged at 719. The no-submit attempt was conservatively recorded UNKNOWN using its existing attempt token; its job is terminal REFUNDED. Audit evidence is retained.

Restored consumer version `d623e77d-4356-4de0-8ac6-ab508eb38667` uses the original entry point, disabled consumer, original variables, no temporary producer binding and an empty cron schedule. Application schema recovery is restored after fixture terminal verification. Production was unchanged. The relevant local suite passed 33 tests; scoped lint passed after removing the anonymous-export warning.

Restored application version `4f0d13dc-1b27-4930-a15f-fe64633e6811`; its plaintext variables match the captured pre-exercise version exactly. Schema recovery is true; durable admission, queue publication and submit outcome remain false. The consumer's variables also match its pre-exercise version exactly, and the temporary exercise binding/variables are absent.

Post-restoration [staging health run 37990574869](https://github.com/aljobson/Veyrnox.ai/actions/runs/37990574869) passed at `2026-10-09T20:59:23.311Z`: both queue backlogs zero, all thirteen recovery counts zero, no unhealthy tasks or issues, and all five reconciliation drift counts zero.

## Terminal fixture closure — 10 October 2026

The two refunded controlled-adapter fixtures above still occupied the unreserved-work capacity count: one UNKNOWN and one synthetic ACCEPTED. Reviewed deployed logs and the exercise worker establish zero real fal submissions for both. An operator update closed only those two exact REFUNDED jobs, matching fixture user/model, endpoint, previous state, provider-handle expectation and recorded attempt tokens. The update asserted exactly two rows. Both intents are now CLOSED; their tokens, handle, timestamps, job and refund ledger evidence remain retained. No job was reset or recharged. This closure applies to these known synthetic/no-submit fixtures, not unresolved real provider work.
