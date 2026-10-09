# Allow reserved images while closing new legacy fal admissions

Migration 0240 closes the admission bypass around the capacity pool from
[PR 758](https://github.com/aljobson/Veyrnox.ai/pull/758), using the global
pause from [PR 759](https://github.com/aljobson/Veyrnox.ai/pull/759).
It changes no operator configuration and is stacked after both migrations.

When `fal_capacity_policy.enabled=true`, new fal and Veyrnox composite jobs
can only enter through `admit_fal_dispatch`. That RPC validates the selected
FLUX.2 Pro image model, pins its output size, checks capacity and budget, and
atomically creates its job, debit/free claim, outbox and reservation.
New direct calls to `ledger_debit` or `submit_free_job` for fal or any Veyrnox
composite return `PROVIDER_ADMISSION_PAUSED` before any of those effects.
This includes Auto Short, Clip Editor and Video Agent. The generations route
already maps the refusal to retryable 503. If deployment flags route a request
to the legacy path accidentally, it is rejected rather than spending outside
the enabled pool.

There is no client-controlled reservation flag. The money and free-job bodies
move to private functions with no EXECUTE grant for service_role, authenticated,
anon or PUBLIC. Public debit/free wrappers always pass `reserved=false`.
Only the fully validated durable admission RPC calls those private bodies with
`reserved=true`, then inserts its outbox and reservation in the same transaction.
A failure in either insert rolls back the private debit/free job too.
Private helpers retain the credit bucket ordering, replay, rate limit, account
freeze and allowance rules from 0239. No new public RPC overload is introduced.

| Capacity policy | Global pause | New direct fal/composite | New reserved image |
|---|---|---|---|
| Disabled | Off | Existing legacy behavior | Refused by disabled capacity policy |
| Enabled | Off | Refused before charge | Allowed within configured pool |
| Either | On | Refused before charge | Refused before charge |

Existing-key replay preserves predecessor contracts. Existing jobs, callbacks,
claims, refunds and composite steps can continue draining in every row of this
matrix. Direct non-fal/non-composite providers keep their prior behavior.
An absent control or capacity row fails closed for covered fresh admissions.

## Concurrency and rollout boundary

New covered admissions lock balance, capacity policy, then global admission
control. Legacy calls take a shared capacity lock even while it is disabled,
so enabling the policy waits for already admitted transactions to finish.
Reserved admission already holds the capacity lock exclusively for quota
serialization. This consistent order avoids a control/capacity lock inversion.
Operator updates must remain standalone: change one control row, commit promptly,
and never take later job, balance, model or other policy locks in that transaction.

The new-admission boundary does not cancel earlier jobs or prevent later fal
steps on a previously charged composite. The pool still counts reserved jobs
and unresolved older outbox work, not every historical direct job or composite
step. Before enabling a bounded rollout, pause admission, inventory and resolve
existing fal/composite work, and verify no external producer shares the account.
Unknown or refunded provider work needs terminal evidence; refund alone is not
proof of free provider capacity. Account-wide capacity is not established by
this change alone.

Keep the global pause on while assigning and enabling the capacity policy and
checking deployment configuration. Unpause only after the reviewed staging gates
pass. New reserved images can then enter; legacy fal/composites stay refused.
For rollback, pause globally first. Disabling the capacity policy while globally
unpaused restores legacy admissions and is an explicit operator decision, not a
safe automatic response to an error. Recovery must remain enabled for committed
work. No live migration, policy assignment, dispatch flag or paid sample is
performed by this code change.

Validation covers mixed paid/free admission races, automatic legacy/composite
refusal, replay without upgrading old jobs, global pause and draining claims,
mode activation waiting for an in-flight legacy transaction, unrelated providers,
missing-policy refusal, private function grants and actual service-role denial,
and migration replay preserving operator controls. The existing 17 capacity
cases still verify reservation failure rollback, UNKNOWN retention and caps.

This incremental boundary adapts back pressure and drain behavior from Donne
Martin's [System Design Primer](https://github.com/donnemartin/system-design-primer#back-pressure).
