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

## Cinema uploads (0138 / ADR-0053)

After migration 0138 and isolated Stream checks, enable
`CINEMA_UPLOAD_RECOVERY_ENABLED` separately from creator-facing flags. Keep it
on when disabling new uploads. Configure Stream account/token/webhook secret
and the existing database bindings; no credentials belong in Actions.

- `cinema_poll_overdue`: known uploading/processing media has gone forty
  minutes without a completed check. Inspect the recovery switch, cron,
  credentials and `cinema.upload_recovery` counters. The claim timestamp alone
  does not renew health. A disabled/missing worker therefore cannot hide work.
- `cinema_poll_failed`: the most recent completed attempt failed. Check scoped
  token permissions, Stream availability and database failures. A 404 is an
  unresolved provider error, not proof that it is safe to release capacity.
- `cinema_provisioning_stuck`: a reservation is over five minutes old without a
  recorded provider UID. Inspect provider records using the opaque reservation
  name and approved operator access. Do not automatically retry provisioning.
- `cinema_processing_stuck`: unresolved encoding older than three hours since
  reservation. Inspect provider status; repeated pending checks do not clear
  this count. Long processing is not an automatic deletion decision.
- `cinema_cleanup_required`: an error or an upload whose grant expired over
  fifteen minutes ago. Keep its reservation counted. Provider-first deletion
  and replacement are still pending implementation; do not erase metadata or
  claim privacy erasure is complete without confirming provider cleanup.

The existing snapshot/incident workflow reports counts only. It refreshes on
its existing cadence and has no paging SLA. Confirm a fresh clean snapshot
after resolving the underlying condition. This is status recovery, not a
provider deletion or account-erasure workflow.
