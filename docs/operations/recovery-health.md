# Recovery health — owner/operator runbook

Owner: repository owner or the on-call operator they designate.

## Activation

Apply owner-approved migration 0131 through apply-migrations. Then deploy
RECOVERY_HEALTH_ENABLED=true in a separate configuration PR. Confirm each
required task has a successful heartbeat and the fifteen-minute snapshot
refresh succeeds. Only then set the repository variable
RECOVERY_HEALTH_WATCH_ENABLED=true and manually dispatch recovery-health.
The workflow runs every thirty minutes; Actions scheduling can be delayed.
Do not describe this as a guaranteed paging SLA. Configure a separate paging
integration if that guarantee is required.

The monitor uses only the public, bounded snapshot RPC. No service key is
stored in Actions. Missing or >45-minute-old snapshots fail closed and open
one recovery-health issue, just like an unhealthy queue. Underlying scans run
only in the trusted fifteen-minute cron, never from an anonymous request.

## Triage

- Unhealthy task: check deployment/runtime configuration and logs for the named
  task. A successful empty run still records success. Failure/skipping and
  >20 minutes without success are unhealthy. Heartbeat write failure must not
  prevent money recovery, but will eventually trip the freshness alarm.
- Exhausted reap entries (attempts >=8) or entries older than one hour: check
  R2 permissions and availability. Confirm the object and queue entry. Retry
  only through the existing reap process after fixing the cause. Do not delete
  queue metadata merely to silence the count.
- Jobs unchanged in an unsettled/failed state for >3 hours: inspect provider
  status and the sweep logs. Apply any needed refund only through the approved
  idempotent refund RPC. Never edit balances or ledger rows.
- Recorded Top-up returns with no backfill check for >8 hours after their
  normal ten-minute eligibility: inspect Stripe and the backfill route. The
  normal exponential interval is capped at six hours. A pending return is not
  proof of payment; never grant credits based on the return alone.
- Flagged paid orders or collisions: inspect the original rows using the
  existing operator RPCs and compare the verified Stripe transaction. Resolve
  any refund/dispute through the provider process and retain the evidence.

After a payment incident has actually been reviewed and resolved, an authorized
operator can call service-only review_recovery_alert(kind, incident_key,
resolution_reference). kind is flagged_order (key = order_id) or
order_collision (key = collision UUID). Use an incident/refund reference, never
payment details. The RPC validates that the incident exists and inserts one
idempotent review receipt. It does not refund money or modify the original
append-only incident record. Do not acknowledge unresolved incidents.

Refresh recovery health through the trusted RPC, confirm the watcher is green,
and only then close the tracking issue. No automatic closure hides unresolved
work. Actual backup/restore readiness, provider account settings, edge rules,
and key-rotation ownership remain separate operational checks.
