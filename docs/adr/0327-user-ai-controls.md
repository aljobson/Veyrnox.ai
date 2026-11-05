# ADR-0327 — Per-user AI kill switch and tunable per-user limit

Status: implemented for owner review; migration 0443 not applied.
Date: 2026-11-05.

Follows ADR-0323, which listed "no per-user control" and a hard-coded limit as open.

## Decisions

1. **Kill switch per account.** `user_ai_controls.ai_disabled`. `check_generation_rate_limit`
   (the entry check that generations and chat turns both call) returns `AI_DISABLED` before it
   counts an attempt or touches any media. The Worker answers 403 `ai_disabled`.
   Refunds, balance reads and everything else about the account are untouched.
2. **Limits tunable without a deploy, lower only.** `user_ai_controls.gen_limit_per_window`
   and a single-row `ai_limit_policy` (global) set a number 1 to 10. The effective limit is
   `LEAST(code constant, user override, global override)`. It can never exceed the Worker's
   constant because the authoritative limit inside `ledger_debit` still uses that constant.
   Raising the ceiling stays a code change.
3. **Operator surface.** `GET/POST /api/v1/admin/users/ai-control`, permission `switches.write`,
   Access assertion and fresh second factor like the other switches. `admin_ai_control_set`
   is idempotent by key and writes `admin_change_log` (area `other`, action `ai_control_set`).
   A global change uses `user_id: null` and cannot set `ai_disabled`.
4. **No row, no change.** Applying the migration alone changes nothing for anyone.

## Not done

- No admin page control yet; use the route. The users page needs a card.
- Per-IP signup counting and a daily cost watch are separate follow-ups.
- Auto Short, server render, voice and uploads do not call this check, so the kill switch
  does not stop them (same gap as ADR-0319).

## Rollback

`DELETE FROM public.user_ai_controls` and `DELETE FROM public.ai_limit_policy` restore the
previous behaviour; a Worker-only rollback is also safe.
