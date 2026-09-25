# ADR-0047 — Recovery freshness and dead-letter monitoring

Date: 2026-09-24
Status: Migration 0131 recorded applied; heartbeat activation prepared, not yet verified

Recovery success now has a durable bounded heartbeat: one row per known task,
last attempt, last success and whether its latest result was healthy. Returned
failures/skips and counted failures are failures, not merely thrown errors.
Heartbeat errors do not stop the recovery itself.

A trusted cron snapshots required-task freshness, exhausted/overdue reaping,
stale jobs/Top-up returns and unreviewed payment flags/collisions. The anonymous
reader serves a singleton and refuses stale data. Optional provider tasks are
required only when their catalog model is active. A gated Actions watcher opens
one incident for unhealthy or unreadable state. No credentials enter its public
report and no public call triggers an expensive aggregate.

Separate service-only review receipts allow operators to acknowledge resolved
payment incidents without changing append-only history. This does not perform
or prove a refund; the runbook requires a resolution reference and verification
before acknowledgment. RLS is enabled/forced and privileges explicitly revoked.

Migration, Worker heartbeats and the watcher activate in that order. The
operations runbook defines ownership, thresholds and recovery actions. Local
transactional replay and unit tests exercise privileges, freshness, failed
returns, empty success and heartbeat transport failure. Production paging and
monitoring ownership still require operational verification.

## Prepared activation — 25 September 2026

The audit record links successful migration run 36055715035. The activation
PR sets RECOVERY_HEALTH_ENABLED=true so existing cron task wrappers record
health. It does not enable the Actions watcher or claim successful production
heartbeats. Deploy this change, verify the required tasks and trusted snapshot,
then enable RECOVERY_HEALTH_WATCH_ENABLED using the operations runbook.

Record the deployed commit, first fresh healthy snapshot, watcher run and
operator notification proof in #101/#204. A missing/failed task must be fixed
rather than acknowledged away. Rollback disables the Worker flag; if the
watcher was subsequently enabled, disable that too while explicitly retaining
the monitoring gap in the launch checklist. Leave migration and audit rows intact.
