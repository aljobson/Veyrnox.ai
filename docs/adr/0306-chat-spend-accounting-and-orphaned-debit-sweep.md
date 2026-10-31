# ADR-0306: Chat cancellation accounting and NULL-safe orphaned-debit sweep

Status: accepted (2026-10-31)
Supersedes/relates: ADR-0067 (chat refunds), ADR-0074 (video agent), migrations 0206, 0258, 0329.

## Context

The 2026-10-31 security assessment (`.gstack/security-reports/2026-10-31/`, confirmed by an independent Codex review) found two money-spine accounting defects in the chat and generation paths. Both are "operator cost" issues: the business pays a provider, no user credit is stolen.

1. **F-12 — the daily "stop before first text" cap did not count refunded cancellations, and conflated two different empty endings.** A chat turn stopped before its first character is marked `FAILED` with `error_code = 'user_canceled'` and then refunded. `ledger_refund` (0206) sets `jobs.state = 'REFUNDED'` and leaves `error_code` unchanged. `chat_stops_before_text` (0258) counted only `state = 'FAILED'`, so a successfully-refunded cancellation fell out of the count and the per-day allowance (`STOPS_BEFORE_TEXT_PER_DAY = 20`) never bound. The provider may still bill for the thinking on each one (actual billing on a cancelled/empty request is unverified from source), so the intended per-user bound was absent; the per-account attempt rate limit (~20/60s) and the per-estimate supplier-spend reservation budget (0327, `$10/hr` / `$25/day` for openrouter-chat) still applied independently of refunds and were the remaining bounds. Separately, `finish()` in `lib/chatTurn.js` tagged **every** empty reply `user_canceled`, including a legitimate empty provider completion (a stream that ends with no content and no failure, e.g. an exhausted reasoning budget) that the user did not cause. Simply widening the counter to refunded rows would therefore have throttled users for the provider's own empty completions. This also subsumes finding F-01: once the cap counts refunded genuine stops, it is the durable per-user bound on free-allowance recycling. The supplier-spend reservation (0327) is deliberately **not** released on refund — releasing it would let a refund-and-retry loop re-reserve and defeat that budget.

2. **F-13 — ordinary orphaned debits were excluded from the timeout refund sweep by NULL semantics.** `sweep_stuck_jobs` (0329) holds (does not auto-refund) only a job explicitly marked `error_code = 'provider_outcome_unknown'` that still has a supplier reservation — an ambiguous submit a reconciler must resolve. The exclusion used `j.error_code = 'provider_outcome_unknown'`. For an ordinary orphaned debit `error_code IS NULL`, so that comparison is NULL and `NULL AND EXISTS(reservation)` is NULL whenever a reservation exists, making the whole `DEBITED` branch NULL and the row un-selectable. A Worker that dies after the debit+reservation commit but before submit therefore left a stuck debit that only manual recovery could refund. (The sibling guard in `reconcile_provider_submit_unknown` already used `IS DISTINCT FROM` and was correct.)

## Decision

- **0410** replaces `chat_stops_before_text` to count the durable cancellation outcome in either settled state: `state IN ('FAILED','REFUNDED') AND error_code = 'user_canceled'`.
- **`lib/chatTurn.js`** `finish()` now records an empty reply as `user_canceled` only when the user actually stopped (`stopped`); an empty provider completion gets the new code `empty_completion`. So `user_canceled` marks exactly genuine user stops, which is what the counter keys on — completed turns are `SUCCEEDED`/`STORED`, provider failures and empty completions carry other codes. (Pre-existing `user_canceled` rows written before this change may include some empty completions; they age out of the rolling 1-day window.)
- **0409** replaces `sweep_stuck_jobs`, changing one predicate from `=` to the NULL-safe `IS NOT DISTINCT FROM`. A NULL `error_code` is distinct from the sentinel, so an ordinary orphaned debit is swept and refunded after `p_debited_minutes`; a genuine `provider_outcome_unknown` job with a reservation is still held. No other line changes.

Both are `CREATE OR REPLACE` with the existing signature (ACL preserved, restated for safety), idempotent, and contain no catalog `UPDATE` (no ROW_COUNT assertion needed). Each change only ever refunds **more** or counts **more** — neither can withhold a refund that previously fired or debit a user — so they keep the previous release working and are safe under the Worker-only rollback contract.

## Consequences

- The stop-before-text cap now actually binds at 20/day on genuine user stops (refunded or not), bounding provider spend on recycled free/cancelled chat turns, without throttling users for the provider's own empty completions.
- Orphaned debits become eligible for refund after the 15-minute grace period (`updated_at` older than `p_debited_minutes`) and are returned by a subsequent `sweep_stuck_jobs` run, instead of needing manual recovery.
- Verified by the ledger acceptance suite and the chat/sweep unit tests before merge (money-spine rule). Applied to production only through the `apply-migrations` workflow after owner approval; migration numbers are provisional and re-checked against `main` at apply time.

## Not in this ADR — remaining assessment findings (follow-up, each its own acceptance-tested change)

These were identified in the same assessment but are concurrency/accounting-sensitive and are tracked for separate, acceptance-tested migrations rather than bundled here:

- **F-02** — capped web search runs before admission/budget on idempotency-key replay, and before a Frozen check. Needs an atomic, payload-bound search-effect claim that returns the stored result on replay, plus a Frozen/eligibility check before dispatch.
- **F-04** — video-agent one-in-flight cap is a pre-debit read (`lib/montageGate.js`) with no lock. Needs an atomic guard (a partial unique index on in-flight agent jobs per user, or an advisory-locked capacity check inside the create/debit path); rollout must first confirm no existing in-flight duplicates.
- **F-06** — a dispute/refund consumed before a pending Top-up is credited leaves no clawback/Freeze. Needs the dispute persisted by payment identity and applied atomically when the Top-up credits.
- **F-14** — unknown-submit recovery hard-codes the supplier set to grsai/fal/kie/openrouter and the original unsuffixed reservation key; Crun (now primary) and failover suffixed keys are excluded. Needs recovery/reconciliation keyed on the actual attempted supplier and handle.
- **F-15** — Cinema free-viewing ceiling trusts client heartbeats against a 60s reservation while issuing a 900s token. Needs the full lease reserved up front, or short server-charged leases.
