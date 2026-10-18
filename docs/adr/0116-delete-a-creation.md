# ADR-0116 — Delete one of my creations

**Status:** Proposed 2026-10-18 (owner decision, same day)
**Related:** [ADR-0111](0111-account-deletion.md) (the erase pattern), [ADR-0008](0008-asset-retention.md) (retention and the reaper), [ADR-0083](0083-admin-operations-surface.md) (reports, holds), [ADR-0013](0013-credit-expiry-policy.md), CLAUDE.md "Database" (append-only ledger)

## Context

Apple 1.2 and Google Play's user-generated-content policy expect a person to be able to delete content they generated. Today the only deletion is the whole account (ADR-0111). There is no `DELETE` for a job or its asset; files go only when the 90-day retention reaper expires them.

A job is also the record behind a ledger debit. The ledger is append-only and `credit_balances.balance = SUM(ledger_entries.delta)` must hold, so the job row cannot go.

## Decision

### 1. What "deleted" means

Deleting a creation removes the **generated file** and the **prompt**. It keeps the **job row** (state, model, credits, timestamps) and **every ledger entry**.

- The R2 key of each `assets` row (and any `job_steps.output_r2_key`) is queued in `asset_reap_queue`, the existing reaper (ADR-0008), then the rows are cleared. The object goes within the reaper's cycle.
- `jobs.inputs` becomes `{}`. Copies of the prompt that live elsewhere are cleared with it: `fal_dispatch.payload` becomes `{}`, `job_steps.output_text` becomes null.
- The row gets a tombstone, `jobs.deleted_at`. Nothing else about it changes.
- **No refund, no ledger row, no write to `credit_balances`.** The credits were spent on a generation that happened. `reconcile_balances()`, `reconcile_free_credits()`, `reconcile_top_ups()` and `reconcile_subscription_credits()` are unaffected and tested as such.
- **Irreversible.** There is no restore, no grace period and no admin undo. Once the reaper has run, the bytes are gone.

### 2. What the owner sees afterwards

| Call | Result |
|---|---|
| `GET /api/v1/jobs` (the Library) | The job is not listed. |
| `GET /api/v1/jobs/:id`, `/provenance` | 404 `not_found`, the same as a job that never existed. |
| `GET /api/v1/jobs/:id/asset` | 404; the asset row is gone. |
| `DELETE /api/v1/jobs/:id` again | 200 `{ deleted: true, replayed: true }`. |

Support and admin tools still see the row, with an empty prompt. Re-sending a generation with the same idempotency key still returns that job; it is the same spend.

### 3. What is refused

All refusals change nothing (file, prompt and row stay) and carry a kebab_case code:

| Code | Status | When |
|---|---|---|
| `job_in_progress` | 409 | The job is not settled (`PRICED`, `DEBITED`, `FAILOVER`, `SUBMITTED`, `SUCCEEDED`; the last means the file is still being copied), or its fal request has not closed. Wait for it to finish or fail. |
| `job_on_hold` | 409 | An unreleased `evidence_holds` row, an asset with `held_at`, or an open `content_reports` row names the job. Preserved material is not erased on request (ADR-0083). |
| `account_frozen` | 403 | The account is Frozen. A person cannot delete their way out of a dispute (ADR-0111). |
| `used_by_post` | 409 | A Publish post in `draft`, `scheduled` or `published` uses the file as its media. Remove the post first. A failed or cancelled post no longer needs it. |
| `used_by_cinema` | 409 | A Cinema upload was made from it. Cinema withdrawal is its own path (ADR-0111, roadmap M9). |
| `used_by_library` | 409 | A Film Library master was made from it. |
| `not_found` | 404 | Not the caller's job, no such job, or a chat reply (not a creation; chat has its own delete). Same shape for all three, so nothing leaks. |

**Tenant projects are not a blocker.** A project asset is its own upload (`reserve_project_asset`) and keeps no reference to a job, so deleting a creation cannot break a project. A project that embedded a generated file already holds a separate copy.

Published Publish posts stay refused rather than forced: the post row points at the job, and removing the post is the person's action to take first. This is the only refusal a person can hit in ordinary use; the app should say which post.

### 4. The call

`DELETE /api/v1/jobs/:id`, Bearer-only like every `/api/v1` route, owner only (the verified `x-veyrnox-auth-id`, never a user id from the request). No body.

- 200 `{ deleted: true, replayed: boolean }`
- 400 `invalid_job_id`, 401 `not_authenticated`, 403 `account_frozen`, 404 `not_found`, 409 as above, 429 `rate_limited` with `Retry-After`, 502 `internal`, 503 `not_configured`.
- **Idempotent without a key:** the job id is the key. The row lock inside the RPC serialises two simultaneous deletes; the second sees `deleted_at` and returns `replayed: true`. A replay writes nothing and queues nothing.
- **Rate limit:** the existing per-account job-read quota (600 per 60 s, `consume_job_read_request`). A delete is no more expensive than a read, and the RPC runs it before it touches the job.

One `SECURITY DEFINER` RPC, `delete_user_job(p_auth_id, p_job_id)` (migration 0351), `search_path = ''`, revoked from `PUBLIC`, `anon` and `authenticated`, granted to `service_role` only. `get_user_job` and `list_user_jobs` are re-created to hide a tombstoned job.

### 5. Rollout

No flag. Production vars are at the 77-binding cap, and the route is inert until 0351 is applied: before that the RPC does not exist and the route answers 502 `internal`, with nothing changed. Migration 0351 is applied by the `apply-migrations` workflow with the owner's approval (ADR-0023). It is backward compatible: the previous release never reads `deleted_at`.

## Rejected

- **Soft-hide only (keep the file).** Fails the store rule and the person's expectation: the content still exists.
- **Refund the credits.** The generation happened and cost money at the provider; a refund on delete would let a person generate, keep a copy and be paid back. Owner decision: no refund.
- **Delete the job row.** Blocked by the ledger's references and by the append-only rule, and it would break refunds and disputes.
- **A new table for deletions.** The tombstone and the reap queue already carry everything; an audit table would hold the thing being erased.
- **Force through a published post or a Cinema title.** Silently breaking a live post is worse than a clear refusal.

## Consequences

- Migration 0351: `jobs.deleted_at`, `delete_user_job`, and `get_user_job` / `list_user_jobs` re-created with `deleted_at IS NULL`.
- `scripts/test-job-deletion.mjs` (in `ledger-tests.yml`, against the full replay) proves: ownership, the erasure and the queued keys, money and the four `reconcile_*()` unchanged, replay at every point, each refusal above including a post in every status, the shared rate limit, and service-role-only access.
- `tests/jobDeleteRoute.test.mjs` covers the route: 401 before any outbound call, the status and code for every refusal, 429, and a 502 that leaks nothing.
- No new table references `users`, so the drift guard in `scripts/test-account-deletion.mjs` needs no entry.
- The mobile app (ADR-0106..0109) adds a delete action on a creation and wires it to this call.
