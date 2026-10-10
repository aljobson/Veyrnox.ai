# fal release readiness review — 10 October 2026

Decision: advance from signed provider retry validation to consolidated release readiness. Keep production activation disabled. PR #800 squash-merged as `ecd58c5347ee857de903dfc2f5d277951a0ddabb` after all checks passed; its one-image signed retry evidence is now on main.

This review applies Donne Martin's [System Design Primer queue and back-pressure reasoning](https://github.com/donnemartin/system-design-primer#asynchronism): queue delivery correctness, measured drain and accepted-running capacity are separate constraints. Successful redelivery does not justify raising admission or submission concurrency.

## Evidence reviewed

| Gate | Current evidence | Remaining requirement |
| --- | --- | --- |
| Authenticated normal path | [Ten-image staging timing sample](../architecture/fal-dispatch-timing-sample-2026-10-09.md): all ten STORED and visible in Library, one debit each. Claim delay median 3.561 s, maximum 4.879 s; consumer elapsed median 768.5 ms, maximum 1062 ms. | Ten lightly paced jobs do not establish sustained drain, p95/p99 or READY contention. |
| Signed callback retry | [PR #800 live evidence](fal-signed-provider-retry-evidence.md): one submission, verified deliberate 503 branch, separate verified retry 978 ms later, application 200, one processed inbox event and one stored asset. | Successful terminal redelivery deduplication under live repeated success callbacks, independent object HEAD and this fixture's authenticated Library inspection were not measured. |
| Provider transport uncertainty | [PR #795](https://github.com/aljobson/Veyrnox.ai/pull/795) contains the completed controlled deployed transport exercise. | PR #795 remains open. Its implementation/evidence is not represented as merged release content, and this review does not merge it. |
| Capacity and cost | Existing isolated staging reservation policy is disabled, with two outstanding slots, ten daily jobs and 300000 micro-USD daily budget. The final retry sample retained a 30000 micro-USD reservation and matching $0.03 aggregate billing increase. | Agree the rollout workload/capacity policy and account assignment. Staging observations cannot establish headroom in the separate production fal account. Review other producers and rollback bypasses before claiming an account-wide limit. |
| Current health | [Restored baseline run 38041323437](https://github.com/aljobson/Veyrnox.ai/actions/runs/38041323437): both approximate queue backlogs zero, thirteen recovery counts zero, no unhealthy tasks and five reconciliation drift counts zero. | A point-in-time baseline is not the required 24-hour observation review. |

## Health window correction

[Run 38034710472](https://github.com/aljobson/Veyrnox.ai/actions/runs/38034710472) reported `fal_dispatch_unknown: 2` at 07:31:36 UTC on 10 October, with zero queue backlog and zero reconciliation drift. This was recorded during the controlled transport exercise; it is still a non-clean recovery observation. Do not carry an uninterrupted healthy-window claim across it.

[Run 38034787005](https://github.com/aljobson/Veyrnox.ai/actions/runs/38034787005) subsequently recorded all recovery counts zero, no unhealthy tasks and all five drift counts zero at `07:32:54.875Z`. The later signed callback exercise completed, and full deployment restoration was verified before the clean `09:25:31.080Z` baseline in run 38041323437.

For the next release review, use the conservative post-restoration baseline **10 October 09:25:31 UTC**, with earliest elapsed 24-hour review **11 October 09:25:31 UTC / 10:25:31 London**. This is a review time, not an activation promise. Any subsequent failed/unreadable recovery or reconciliation observation requires assessment and a new justified baseline. Another deliberate fault exercise must be separated from, and followed by, the observation window.

The queried monitor history also has a 62-minute-32-second interval between scheduled run creation at 9 October 23:56:24 UTC and 10 October 00:58:56 UTC. This is a workflow scheduling interval, not proof of a backend outage or an exact snapshot coverage gap; manual observations must be assessed separately. It demonstrates why green run totals and elapsed time alone cannot certify continuous health. Existing monitor artifacts are retained for seven days: preserve counts-only evidence before expiry and assess failures, missing artifacts, freshness and scheduling gaps as required by [the monitoring runbook](fal-queue-health.md).

## Next release sequence

1. Retain the restored disabled configuration while ordinary staging monitoring collects evidence. Review actual counts-only artifacts and queue metrics over the full proposed interval; record gaps explicitly. No new watcher or duplicate notification automation is needed.
2. Review and separately authorize merging the remaining controlled transport PR #795. Recheck its exact head and CI before squash-merge.
3. Obtain read-only evidence for the correct production fal account's balance, quota, existing producers and available running headroom. Do not extract keys or substitute staging account data. Confirm production migration/deployment revisions and disabled flags through the protected workflow records.
4. Agree the intended canary arrival profile, accepted-running cap, daily job/cost allowance and latency target before preparing a further paid sample or activating production. The proposed ten-second claim objective is not an accepted or statistically established SLO. Any new paid test needs its own concrete bounded approval; prior completed budgets are exhausted.
5. After the health-window review and unresolved acceptance/capacity checks pass, prepare a concrete production canary and rollback configuration for owner approval. Admission rollback must retain recovery for committed work. Never reset STARTED/UNKNOWN or resubmit to hide ambiguous acceptance.

No additional provider call, credit purchase, migration or production flag change is part of this review. Merging this document does not authorize those actions.

## Repeatable artifact review

`node scripts/review-staging-health-window.mjs /absolute/evidence/directory` reads retained local artifacts only. Put `inventory.json` in that directory with `since`, `until`, `baseline_run_id` and `runs`; the run entries use the `databaseId`, `createdAt`, `status` and `conclusion` fields returned by `gh run list --workflow fal-queue-watch-staging.yml --limit 1000 --json databaseId,createdAt,status,conclusion`. Ensure this inventory is exhaustive through the interval and includes baseline run 38041323437; check that pagination/limits did not truncate it. Store each run's downloaded `staging-database-health.json` under a directory named for its numeric run ID. Download the artifact for the reviewed attempt, not a different successful attempt masking a failure.

The reviewer requires all thirteen recovery and five reconciliation counters, the exact staging project, task/issue arrays, valid observation timestamps and successful workflow conclusions. Missing or invalid artifacts and unhealthy observations return exit 2. Clean observations spanning less than 24 hours return exit 1. Exit 0 means sufficient clean observed span to begin operator review, not continuous health certification or deployment permission. Every output reports the largest sampling gap and retains an explicit operator-review requirement. Queue metrics, inventory completeness, server scan freshness and gaps still need assessment against the original workflow evidence; this tool does not fetch credentials, refresh snapshots, publish notifications or change configuration.

An initial local review at 09:36:52 UTC used the retained artifacts for runs 38041323437, 38041708728 and 38041894211. All three were clean, spanning only 575.553 seconds of observations; the largest observation/boundary gap was 385.747 seconds. The reviewer correctly returned exit 1 for an incomplete window. Six focused tests cover sparse sampling, failed workflows with clean artifacts, missing evidence, UNKNOWN recovery, invalid project/timestamp/counts, incomplete coverage and unsafe/duplicate inventory IDs.
