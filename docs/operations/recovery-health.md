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

## Tasks and counts in the snapshot

`unhealthy_tasks` can name `top_up_backfill`, `upload_sweep` and `asset_reap`
always, and `grsai`, `byteplus`, `auto_short`, `video_agent`, `publish_sweep`,
`fal_dispatch` and `content_scan` only while their work exists (an active
catalog row, a due scheduled post, a `DEBITED` job with a dispatch row, an armed
scan monitor). The snapshot refreshes every fifteen minutes (pg_cron
`veyrnox-recovery-health`). The Worker runs the tasks from the five-minute cron;
`content_scan` also runs from the one-minute cron, and only when
`CONTENT_SCAN_ENABLED` is `true`.

Counts that open the issue when above zero: `reap_exhausted`, `reap_overdue`,
`stale_jobs`, `stale_top_up_returns`, `unreviewed_flagged_orders`,
`unreviewed_order_collisions`, the five `cinema_*` counts below,
`fal_dispatch_unknown` and `fal_dispatch_overdue` (dispatch started but unresolved
for over two minutes, or ready for over ten), and `content_scan_overdue`,
`content_scan_backlogged` and `content_scan_exhausted` (migration 0289: no
successful scan run for twenty minutes, work queued over thirty minutes, or more
than twenty provider-unavailable scans in a day). A `content_scan` finding is
usually the scanner credential or `SOCIAL_HOLD_CHECKS_ENABLED` being off.

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

## Creator-requested video removal (0139 / ADR-0054)

`CINEMA_UPLOAD_REMOVAL_ENABLED` independently controls both removal requests and
the background deletion pass. Enable only after the migration, scoped credentials
and isolated live deletion/capability-revocation checks. Keep it enabled while
pausing new uploads so already-requested removals can drain. The worker deletes
only exact recorded UIDs explicitly queued by an authorized creator.

`cinema_cleanup_required` also counts requested removals waiting over thirty
minutes. Inspect `cinema.upload_removal` counters, provider scope/availability and
database completion. A lost successful provider response may leave a 404 on retry;
this is deliberately unresolved, not automatic proof of deletion. Reconcile through
the approved operational process; do not remove rows or release capacity solely
because a request failed. No new override API is provided.

Confirmed removal preserves a private replay tombstone and the content draft,
permits replacement, and frees active storage capacity. It does not reset the
rolling daily creation limit, erase an account or approve a retention policy.

## Staging fal queue visibility

The database snapshot does not inspect Cloudflare queue backlog or dead-letter
arrivals. Use the [staging fal queue monitor](fal-queue-health.md) alongside
UNKNOWN and overdue dispatch counts. Its scheduled watch explicitly checks the
staging database and retains counts-only evidence; this recovery-health workflow
defaults to production. The protected manual queue diagnostic remains separate.
Cloudflare metrics and scheduled database samples cannot establish uninterrupted
health or independently satisfy the production rollout gates.

## Content scanner prerequisites

An enabled scanner requires a separately approved `OPENAI_API_KEY` on that
Worker, alongside its existing Supabase service-role and R2 credentials.
`npx wrangler secret list --env staging` reports names only and can prove the
binding is present. An Actions secret or a production Worker binding does not
provision the staging Worker. Reuse only a key approved for staging; provision
it with `npx wrangler secret put OPENAI_API_KEY --env staging` through its
interactive input, never a shell argument, committed file or public log.

The 2026-10-16 QA investigation found the staging scan flag enabled and this
binding absent. Queue backlog and all seven reconciliation counts were zero;
the `content_scan` heartbeat failure was a real configuration incident. After
provisioning the approved key, wait for a one-minute scanner tick and the next
database snapshot, then rerun `fal-queue-watch-staging`. Require both a fresh
successful scanner heartbeat and a green snapshot before resolving the issue.
The key's presence alone does not prove provider permission or connectivity.

Keep monitoring armed while fixing an enabled scanner. Disabling its flag or
disarming its database monitor to obtain a green status would hide the missing
dependency. If scanning is deliberately retired, follow the administrator's
audited disarm action in ADR-0083 after recording that product decision.
