# ADR-0069 — A per-model free allowance, as a price waiver rather than free Credits

- **Status**: **Proposed 2026-10-05**. Nothing is built. Needs the owner's answers to the questions at the end.
- **Related**: ADR-0013 (Free Credits), ADR-0067 (chat replies are jobs), ADR-0026 (Turnstile on sign-up), CLAUDE.md "Money & billing", "Database"

## Context

Syntx shows a banner on some models ("free generations left") and a free tier with a few uses per model per day (public UI
and front-end code: a quote returns `show_warning` and `free_remaining_generations`). It is a try-before-you-buy hook.

Veyrnox.ai has one free source today: the 10-Credit sign-up grant, which is Free Credits (ADR-0013) and expires after 90 days.
The ledger rules fix what a free allowance can **not** be:

- Credits are only minted by `signup_grant` / `ledger_grant` and the other listed RPCs. A daily "free Credits" top-up would be a
  new grant path and would break the rule that only `grant:signup` credits are Free Credits (`free_balance`, `reconcile_free_credits()`).
- A ledger row is never edited or deleted, and `balance = SUM(delta)`.

## Decision (proposed)

A free allowance is **a waiver of the price of one job, not a grant of Credits.**

1. A model may carry `free_allowance_per_day` (integer, default 0 = none) in `model_catalog`. The catalog stays normative for price.
2. When an account has allowance left for that model today (UTC), the quote shows `0 Credits, free (N left today)` and the job is
   created with `credits = 0` and `free_allowance = true`. **No `ledger_entries` row is written for a zero-price job**, so the
   balance invariant, `free_balance` and all three reconcile functions are untouched.
3. Usage is counted in a new table, `model_free_allowance_usage (user_id, model_id, day, used)`, with RLS enabled and forced, written
   only by a `SECURITY DEFINER` function (`search_path = ''`, explicit revokes, `service_role` only). Taking and returning an allowance
   is idempotent on the job's idempotency key, so a replay costs nothing and takes nothing.
4. A failed, canceled or refunded free job **returns the allowance** in the same transaction that fails it, exactly as a Credit Refund
   returns Credits. A job that completed keeps it spent.
5. Who is eligible: a signed-in account with a **confirmed email**, not Frozen, past Turnstile on sign-up (ADR-0026). Nobody
   anonymous.
6. Bounds on our own spend, because a free job still costs provider money:
   - the per-account daily count above;
   - a **global daily ceiling** per model (`free_allowance_daily_budget`, jobs per day); when it is spent the quote falls back to
     the normal price and no error is shown;
   - only models whose provider cost per job is at or under a stated cap are eligible (set in the migration, checked by a test);
   - one kill switch (`FREE_ALLOWANCE_ENABLED`, `"false"` in production until staging acceptance).
7. Quote and banner: `GET /api/v1/models` gains `free_left_today` per model for the caller. The UI shows the banner only when it
   is greater than 0 and says plainly when it has run out. Nothing is computed in the app layer: the number comes from the function.
8. Reconciliation: a nightly check that `used` equals the count of the day's free jobs not returned, and that no day exceeds the
   per-account or global cap. It joins `veyrnox-reconcile-balances` and must return zero rows.

## Why not the alternatives

| Option | Why not |
|---|---|
| Grant a few Free Credits every day | A second grant path; blurs `grant:signup`; would need its own expiry and refund-to-source rules; harder to bound. |
| A bigger sign-up grant | Already the cost lever; a larger one widens the faucet that Turnstile and email confirmation were added to close. |
| Free tier by model "tier" client-side | The server must decide: the client cannot be trusted with a price. |

## Consequences

- Real provider spend with no revenue: capped per account, per model per day, and by eligibility, then watched through the global
  ceiling. Expected daily exposure = eligible models × `free_allowance_daily_budget` × cost per job. The owner sets those numbers.
- One new table and function (migration `NNNN`, idempotent, with an acceptance test for replay, refund, cap, and the zero-price job
  path, plus a grants test in `scripts/test-default-privileges.mjs`).
- A zero-price job path in `submit` that skips `ledger_debit`. This is the riskiest change: every place that assumes
  `credits > 0` (refund-on-failure, the sweeper, the Library, the statement) must be read again.
- The Terms and pricing copy need one line: free generations are a trial, limited per day, and can be withdrawn.

## Open questions for the owner

1. Which models, and how many free a day each (suggest: text chat models and the cheapest image model, 3 a day)?
2. Daily per account, or a one-off lifetime trial per model?
3. Should the allowance require a paid top-up ever, or stay open to every confirmed account?
4. The global ceiling per model per day, in jobs?
5. Show the banner on every eligible model, or only after the first free use?

## Not decided here

Subscription Credits (ADR-0064) and Packs are unaffected. Video models are out of scope until their per-job cost is known.
