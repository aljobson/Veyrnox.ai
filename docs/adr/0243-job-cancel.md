# ADR-0243: Cancel a queued generation with a refund (option C)

Status: Proposed; implemented behind an absent-by-default flag.

We choose option C: the owner may cancel only a durable fal intent still on our side. Option D, provider cancellation, is deferred until each provider's cancellation behaviour has been probed on staging. No adapter currently has a cancel call. Legacy DEBITED jobs may already have been accepted by a provider after a lost acknowledgement, so they are never eligible.

`cancel_user_job` locks the owned job, then its dispatch row, then the balance. It requires DEBITED, no provider handle, and a READY dispatch. Claim and recovery use the same lock order; the winning transaction determines whether the request can proceed. A frozen account is refused after re-reading its frozen status under the balance lock used by Freeze. A strike hold gates new work and does not prevent returning credits for work never sent. Deleted users, deleted jobs, chat jobs, missing jobs and other people's jobs answer NOT_FOUND.

The transaction closes the intent, sets `error_code='user_cancelled'` and invokes only `ledger_refund` with `refund:user_cancelled`. The resulting state is REFUNDED; no new enum value, table or column is needed. A non-ok or already-idempotent refund on a fresh cancellation is an invariant failure and rolls the transaction back. Job id is the idempotency key: a repeated cancellation answers `replayed:true` with the original credits, without another refund. Migration 0171 supplies the one-refund-per-job unique backstop.

STORED, FAILED and other REFUNDED jobs are finished. SUBMITTED, SUCCEEDED, FAILOVER, legacy DEBITED and dispatches beyond READY are started and refused. GET is advisory, consumes only the shared read quota and takes no explicit job/outbox/balance locks. Its eligibility matches a fresh POST; an already cancelled job reads `cancellable:false` but POST replays successfully. A claim can win after GET, making POST answer `job_started`.

Refunds preserve source buckets. Subscription credits from an ended or replaced cycle expire again in the refund transaction. A free allowance is returned to its original day, never added to a later day. Copy promises a refund, not an increased spendable balance. Reconciliation for balances, free credits, subscription credits and free allowances must remain at zero. Provider-spend reservations are irreversible (0329) and are not reopened by refunds.

Late results are discarded and the refund stays. Under option C the provider never received the intent: claim now answers INELIGIBLE. If a handle nevertheless arrives, job_submitted refuses BAD_STATE_FOR_SUBMIT, job_succeeded/job_failed refuse the terminal state, and the webhook discards without fetching. A further ledger_refund is idempotent. Neither a new unconfirmed debit nor delivery of unpaid output is justified. Webhook handlers are unchanged. The push enqueue function excludes user_cancelled jobs, preventing a misleading failure push; provider failures still enqueue job_failed.

Both RPCs are SECURITY DEFINER with an empty search_path and service-role-only execution. They share the 0115 per-account read quota (600 requests per 60 seconds). Fresh cancellations are also bounded by admission's 10 per 60 seconds. Routes trust only middleware's verified auth-id header, ignore bodies, return typed errors without database text and set no-store on every response.

JOB_CANCEL_ENABLED is read per request and requires exactly "true". It is omitted from both Wrangler vars blocks because of text-binding budgets; production contains only an explanatory comment. The feature is inert until durable admission is enabled with both FAL_DISPATCH_SCHEMA_ENABLED and FAL_DURABLE_DISPATCH_ENABLED. Production currently omits all fal rollout flags; staging enables only the schema switch. No rollout setting is changed here.

The phone checks eligibility on queued poll attempts, quietly hides unavailable status, and uses server credits for confirmation. Stop waiting is unchanged. Cancellation feedback has its own live region in the no-asset panel. A successful or uncertain POST restarts polling; transport errors, 5xx and malformed success can follow a committed cancellation, so they never claim nothing changed. The authoritative refunded/user_cancelled job read supplies the terminal cancellation message and retains Try again. No analytics, cancel-status cache or phone-side price calculation is introduced.

## Owner decisions

- Turning on durable admission (`FAL_DISPATCH_SCHEMA_ENABLED` plus `FAL_DURABLE_DISPATCH_ENABLED`): without it every job reports `cancellable:false` and the phone shows no Cancel button.
- Setting `JOB_CANCEL_ENABLED`, which first needs a Worker binding slot or another var removed, because both blocks are at their text-binding budget.
- Approving the `apply-migrations` run for the migration.
- The final ADR number and the migration number; the host renumbers both if 0359 is taken (0358 was taken by another open PR when this was shipped) when the PR opens.
- Whether to schedule the staging probe of each provider's cancel call, which option D (asking the provider to cancel) needs before it can be considered.

Follow-ups not done here (test strength, no behaviour change): assert in the acceptance script that a cancel frees its capacity reservation (`release_reason = 'NOT_SUBMITTED'`), count both race outcomes of the cancel/claim loop, and add `reconcile_top_ups` to the final reconcile loop once its row shape is checked against the others.
