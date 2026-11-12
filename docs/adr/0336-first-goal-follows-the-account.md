# ADR-0336 — The first-goal answer follows the account

**Status:** Proposed 2026-11-12. Extends the first-goal question on Create (web and mobile). Migration 0494. Off until `FIRST_GOAL_SYNC_ENABLED` is exactly `"true"`.

## Context

The Create screens ask once, "What do you want to make first?" (image, video, audio, edit, publish, not sure, or skip). The first slice kept the answer on the device. That is wrong in three ways: a second phone or the web asks again, a second account on one phone or browser is never asked, and a copy of the answer made by one account is read as another's.

## Decision

One row per account, `public.first_goals(user_id, goal)`. `goal` is one word from a fixed list and nothing else: no prompt, file, key or free text. It orders nothing and prices nothing, and never touches credits or the ledger.

- Reached only through `get_first_goal` and `set_first_goal`, both SECURITY DEFINER with an empty search path, executable by `service_role` alone. The table is RLS-forced with every grant revoked; the browser roles hold none.
- `GET`/`PUT /api/v1/first-goal` behind the existing identity gate (middleware-verified `x-veyrnox-auth-id`); `404` while the flag is off; typed errors; `no-store`; validated against the same allowlist the database checks.
- An answer is never lowered. A real goal outranks "not sure", which outranks "skipped", so a stale device that believes nothing was chosen cannot throw away a real choice. Replaying the same word changes nothing. One real goal may replace another.
- Account deletion removes the row in the same transaction (trigger on `users.deleted_at`, as for the Vibe Check). The privacy export gains `first_goal` in the `profile` section through a thin wrapper over the existing function, bounded by the request's `as_of`.
- The admin telemetry allowlist admits the new route with the same one-route wrapper as 0493.

Clients ask the account first. A stored goal on the server wins and is copied to the device; "none yet" means the question is asked even if this device holds another account's answer; only when the server cannot be asked (flag off, offline, signed out) does the device's own copy decide. A new answer is written to the device and sent to the account, best effort.

## Not decided here

- No backfill: answers given under the device-only slice are not uploaded, because the device cannot say which account gave them. Affected people are asked once more.
- The flag is a Worker var that ships absent (off) because the var budget is full; turning it on needs a freed binding and the owner's word.
- Migration 0494 is applied only by the `apply-migrations` workflow after the owner approves the run (ADR-0023). Do not turn the flag on before it has landed and the reconciliation job has run clean.

## Consequences

Web and mobile agree and a second account is asked. The cost is one more table and route on the user-data surface, covered by the deletion, export and grant tests (`scripts/test-first-goal.mjs`, `test-account-deletion.mjs`, `test-privacy-export.mjs`).
