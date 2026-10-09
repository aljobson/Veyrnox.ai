# fal dispatch capacity readiness — 2026-10-09

This review applies the queue and back-pressure reasoning in Donne Martin’s
[System Design Primer](https://github.com/donnemartin/system-design-primer)
to the implementation in [ADR 0077](../adr/0077-fal-event-driven-dispatch.md).
Source inspection establishes bounds; it does not establish live throughput.
Production queue activation remains blocked on the evidence below.

## Database and handler budget

`runFalDispatchQueue` performs initial recovery once per invocation. Every
confirmed claim then performs a claim RPC, an evidence RPC, and a recovery RPC.
With staging batch size one, a normal delivery therefore makes four RPCs.
A second identical evidence write raises this to five. A terminal duplicate
reference makes two RPCs (initial recovery and claim), with no provider call.
These counts exclude admission, authentication, callbacks and other sweeps.

For `J` normal deliveries/day, `D` terminal duplicate deliveries/day and `E`
extra evidence writes/day, dispatch calls are `4J + 2D + E`. At 5,000 normal
jobs/day with no duplicates or retries, this is 20,000 calls/day, or 0.231
calls/second averaged over the day. This is an illustrative workload, not
observed demand or database capacity. Initial recovery is amortized only if
batch size changes; the deployed batch size is one.

The DB client defaults to eight seconds per HTTP RPC; submission is bounded
at fifteen seconds. A path using both evidence writes has a configured timeout
budget of `8 + 8 + 15 + 2×8 + 8 = 55 seconds`, excluding execution overhead.
After initial recovery, the consumer reserves fifty seconds before claim;
the remaining timeout budget is 47 seconds. The invocation budget is three
minutes. These are configured deadlines, not measured handler latencies.

At concurrency two, ideal drain is `2/s` jobs/second for measured handler
occupancy `s`. A two-second assumption gives one job/second; a 55-second
stress assumption gives about 0.036 jobs/second (3,142/day). Neither is a
benchmark or a guaranteed drain floor. Failures, retries, scheduling and
provider admission can reduce drain. Measure occupancy before raising caps.

Submission slots do not bound generations already running at fal. At arrival
rate `λ` jobs/second and mean generation duration `g` seconds, mean accepted
running work is approximately `λ×g`. Provider quotas and account-wide atomic
capacity reservations must cover this separately. Queue metrics cannot serve
as the authority for whether a new credit debit is safe.

## Evidence and remaining gates

| Gate | Evidence or work remaining |
| --- | --- |
| Healthy live path | Two bounded queue generations reached STORED; admission-to-claim delays 9.47 and 1.71 seconds. These samples do not establish p95/p99 or sustained drain. Detailed live evidence remains in PR #690. |
| Delivery failure | Malformed ACK, disabled-consumer retry exhaustion/DLQ, duplicate no-resubmit, and terminal BUSY redelivery observed. A terminal row-lock probe is not a concurrent READY claim load test. |
| Alerts | Scheduled queue monitoring and GitHub issue creation, update and deduplication exercised. Normal run 37949816509 and scheduled run 37952664939 passed. Notification delivery to the owner is not established by issue creation alone. |
| Recovery window | Missing staging runner URL caused unhealthy video recovery after the 14:43 UTC deployment. Restored live; real heartbeat succeeded at 15:41:17 UTC. Normal aggregate refresh at 15:45:00 UTC is clean; 15:47:14 UTC read showed all recovery counters and five reconciliation drift counters zero. PR #727 preserves the URL in configuration. A point-in-time read does not prove 24 continuous healthy hours. |
| Measured capacity | Full handler occupancy, DB RPC latency distributions, throughput under eligible READY load, provider quota/headroom, duplicate amplification and cost remain unmeasured. Account billing allowance remains unverified. |
| Admission bound | A proposed ten-second claim p95 and a workload-specific capacity reservation need acceptance before broader admission. Per-user rate limits alone do not bound account-wide accepted work. |

Earliest review of the fresh clean window is after 2026-10-10 16:41 London,
provided no further recovery or reconciliation failure occurs. This is a
review time, not a promised production activation time.

## Bounded measurement protocol

Before spending, record the approved job count, model, total credit/provider
budget, test identity, provider quota and exact deployment revisions. Preserve
existing environment bindings. Keep production unchanged and stage concurrency
two. A successful isolated sample does not authorize a sustained load run.

For every approved job, collect admission, STARTED, accepted and STORED times;
measure full consumer occupancy and each RPC duration separately. Count
attempts, credits, duplicate references, retries, DLQ arrivals and UNKNOWN
outcomes. Never include prompts, credentials or signed asset URLs in telemetry.
Report sample size with every percentile; assess drain and oldest READY age
against the approved arrival profile rather than a guessed user count.

Stop new admission on UNKNOWN/evidence failures, reconciliation drift,
unhealthy recovery, DLQ arrival or growing READY age beyond the accepted bound.
Let existing recovery drain committed work; never reset STARTED or UNKNOWN.
Review the resulting measurements and accepted-running headroom before changing
submission concurrency or broadening admission. Local controlled-adapter tests
can validate failure handling while admission is paused, but cannot substitute
for this live capacity measurement.
