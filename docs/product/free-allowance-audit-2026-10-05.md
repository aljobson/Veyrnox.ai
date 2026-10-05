# Free allowance: where a zero-credit job breaks today (audit for ADR-0069 step 2)

Date: 2026-10-05. Read-only audit of `main` after `0205` (data layer, #555). Nothing here is built.

A free-allowance job is created at **0 Credits with no ledger row**. The money spine assumes every job was
debited. These are the places that break or need a decision, in the order they would fail.

## 1. The `jobs` table refuses it

`0001_initial.sql:93`: `credits INTEGER NOT NULL CHECK (credits > 0)`.
**Change**: add `jobs.free_allowance BOOLEAN NOT NULL DEFAULT false` and replace the check with
`CHECK (credits > 0 OR free_allowance)`. A normal job stays strictly positive; only a job that took an allowance may be 0.

## 2. `ledger_refund` rejects a refund of 0, and every failure path calls it

`ledger_refund` returns `INVALID_CREDITS` for `p_credits <= 0` (latest body in `0183`). Callers pass the job's own
`credits` (0 for a free job):

| Caller | What happens today if the refund is rejected |
|---|---|
| `lib/providerCompletion.js:146` (kie, OpenRouter and other provider webhooks) | Returns **HTTP 500** to the provider; it retries forever. |
| `app/api/webhook/fal/route.js:295` | Logs and does not mark processed. |
| `lib/submitRejection.js:32` (submit refused by the provider) | The job is left DEBITED; the sweeper picks it up. |
| `lib/clipEdit.js:144`, `lib/autoShort.js:60`, `lib/chatTurn.js:132` | Same, per step or turn. |
| `sweep_stuck_jobs` (`0018`), `sweep_succeeded_without_asset` (`0019`), the `0099` failed-without-refund sweep | Marks the job FAILED, calls `ledger_refund`, ignores the rejection: the job sits FAILED forever and (for `0018`) is re-picked every run. |

**Decision: one choke point.** Teach `ledger_refund` itself the zero case, so no caller changes: if the job has
`free_allowance = true` and `credits = 0`, accept `p_credits = 0`, call `free_allowance_return(user, job.idempotency_key)`
and return `{ok: true, refunded: 0, allowance_returned: true}`; a replay returns `idempotent: true`. A refund of more than
0 on a free job stays `REFUND_EXCEEDS_DEBIT`. The `JOB_SUCCEEDED` guard and the per-job idempotency check stay as they are.

## 3. Submit needs a parallel path, not a changed `ledger_debit`

`ledger_debit` creates the job and the ledger row together and rejects `p_credits <= 0`. Leave it alone.
**New RPC `submit_free_job`** (service role only): in one transaction take the allowance (`free_allowance_take`), then insert the
`jobs` row (`credits = 0`, `free_allowance = true`, state `DEBITED`, the same `(user_id, idempotency_key)` uniqueness as today),
no `ledger_entries` row, no `credit_balances` change. A replay returns the existing job. It reuses the generation rate limit
the route already calls first (`check_generation_rate_limit`).
`app/api/v1/generations/route.js` (~l.362-380): when the model offers an allowance, try `submit_free_job`; on
`taken: false` fall through to the normal `ledger_debit` at the catalog price. `credits` in the response and in
`refundRejectedSubmit` become 0 on the free path.

## 4. Checks that already cope, and one that does not

- `0099` `failed_without_refund` already filters `j.credits > 0` (lines 29, 78), so a free FAILED job is not flagged. Good.
- `reconcile_balances`, `reconcile_free_credits`, `reconcile_top_ups`, subscription reconcile: all sum `ledger_entries`; a free job
  writes none, so they are unaffected. **No change.**
- `0100` `reconcile_status` failed-refund counts: confirm it also filters on `credits > 0` (not read in this audit).
- New: add `reconcile_free_allowance()` (exists, `0205`) to the `veyrnox-reconcile-balances` cron so any row fails the job.

## 5. Surfaces that read job credits (display only)

- The credits statement (`/api/v1/ledger`) reads `ledger_entries`: a free job does not appear. Decide whether it should
  (suggest a "Free allowance" line later; not needed to ship).
- `list_user_jobs`, the Library and the admin user lookup (`0148`) show `credits`: 0 renders as 0. Library prices need a
  "Free" label rather than "0 cr".
- Usage meters (#542) count `debit:`/`refund:` ledger reasons only: free jobs add nothing, which is correct.

## 6. Quote and banner

`GET /api/v1/models` calls `free_allowance_left` for the caller (exists, `0205`) and returns `free_left_today` per model.
The studio shows `0 Credits, free (N left today)` while it is above 0. The server decides; the client never prices.

## 7. Tests the next PR must carry

Acceptance, on a real Postgres: free job created with no ledger row and an unchanged balance; replay of `submit_free_job`;
failure returns the allowance and a second failure is idempotent; the sweeper on a stuck free job returns the allowance
and clears the job; `JOB_SUCCEEDED` keeps it spent; a paid job still refunds exactly as before; concurrent submits at the
budget edge. Unit: the route falls back to `ledger_debit` when `taken` is false.

## Proposed order

1. `0206`: `jobs.free_allowance` + relaxed check + `ledger_refund` zero branch + `submit_free_job` + tests. Still nothing calls it from the app, so still off.
2. Route change behind `FREE_ALLOWANCE_ENABLED` (`"false"` in production), with the fallback test.
3. Quote and banner, Library "Free" label, cron hookup.
4. Staging acceptance with a real model, then the owner's flip.
