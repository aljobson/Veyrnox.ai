# ADR-0069 — A per-model free allowance, as a price waiver rather than free Credits

- **Status**: **Accepted 2026-10-05** (owner: "go with recommendation"). Nothing is built. The answers recorded under "Owner's decisions" are the initial values and are revisited with real spend data.
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

## Owner's decisions (2026-10-05, "go with recommendation")

1. **Which models and how many**: the live text chat models and the cheapest image model, 3 free jobs a day each. Video and audio models are out of scope.
2. **Daily per account**, resetting at 00:00 UTC. Not a one-off lifetime trial.
3. **Open to every confirmed, unfrozen account.** No top-up required first.
4. **Global ceiling**: set per model so total free provider spend is at most **$5 a day** across all models; the migration records the job count that implies for each model. Raised only by a new decision after a week of real numbers.
5. **Banner on every eligible model**, shown while `free_left_today` is above 0 and replaced by a plain "used today" line when it is not.

Build order when this is picked up: the migration and function with their acceptance tests, then the zero-price path in `submit`, then the quote and banner, then reconciliation. `FREE_ALLOWANCE_ENABLED` ships `"false"` in production and is switched on only after staging acceptance.

## Not decided here

Subscription Credits (ADR-0064) and Packs are unaffected. Video models are out of scope until their per-job cost is known.

## Addendum 2026-10-05: how the allowance meets chat

Chat replies are jobs through their own turn code (`lib/chatTurn.js`), not `/api/v1/generations`, so the allowance is wired
into both through one helper (`lib/freeJob.js`). Decision taken while building it: **only a plain reply can be free.** A reply
that chooses Thinking, Web search or images is priced normally, because those extras are real extra provider cost that the
allowance's per-job cost bound ($0.05) was not set against. A plain reply is the row's base price, which is what the allowance
waives. The check is `price == the row's base credits`, so a new option cannot slip into a free reply. Everything else in this
ADR is unchanged: the flag, the caps, the refund returning the allowance, and eligibility.

## Addendum 2026-10-10: replay and staging history

Migration 0222 filtered on the old zero allowances, so its positive row-count
guards refused a replay even when the intended values were already present.
0262 assigns the same 3/account/day, 100-global chat and 40-global image values
without the old-zero predicates. All original provider, active, modality,
price and cost predicates and exact positive row-count guards remain. Missing
or changed catalog prerequisites still abort atomically. This does not raise
allowances, change prices, enable a flag or mint Credits. Staging records
0262 as an explicit forward repair; the old file and history remain intact.

## Hourly reconciliation coverage (0264, 2026-10-10)

Track A8 / S20 adds the free-allowance drift count to the counts-only public
snapshot and hourly watcher. Migration 0264 measures all seven existing
reconciliation functions before publishing the replacement snapshot, retains
the 45-minute freshness bound, forced RLS and service-only refresh, and
changes no allowance, reward, credit or launch policy.

The checker distinguishes an unapplied migration from missing measurements:
0264-absent fields remain explicitly unmeasured only while its actual receipt
is absent. Once applied, missing or malformed new counts fail closed. Local
SQL fixtures seed allowance overuse and an unmatched referral grant; the actual
watcher exits 1 for either, 0 for measured zeroes and 2 for invalid evidence.
New health-window reviews require all seven measurements; older five-count
artifacts remain historical evidence and cannot prove the expanded coverage.
Production application uses the protected main workflow and owner review.

## Amendment: client maximum charge (PR A, 2026-11-04)

`POST /api/v1/generations` accepts optional `max_charge_credits`: a non-negative
integer limiting the **net debit for this one request**. Zero is valid. Invalid
values return 400 `max_charge_credits_invalid`. When `MAX_CHARGE_ENABLED` is exactly
`"true"` and a valid `max_charge_credits` is supplied, the net ceiling takes
precedence over `confirmed_credits` equality, while its type validation and the
legacy equality check without an enabled ceiling remain unchanged. Omitting the
new field preserves the existing admission behavior.
When `MAX_CHARGE_ENABLED` is on and a request carries `max_charge_credits`, the
exact `confirmed_credits` check is skipped, so a client sending both loses its
gross-price guard and the ceiling is its only price protection.

Enforcement requires `MAX_CHARGE_ENABLED` to be exactly `"true"`. It ships
`"false"` in `wrangler.jsonc`; absent also means off. While off, the field is
validated but otherwise ignored: no ceiling checks or additional job lookups.
Mobile continues sending its existing gross `confirmed_credits` alongside the
net ceiling; web continues sending only the ceiling. The server decides whether
to enforce it, including for durable models. The rules below apply when enabled.

After attempting the allowance, every non-durable debit (including the video
agent and reference jobs) checks the ceiling. A taken allowance costs zero. An
excess returns 409 `price_changed` with `expected_credits` and
`max_charge_credits`, without creating a job or debiting. A verified existing job
for the authenticated `(user_id, idempotency_key)` is exempt: the usual debit RPC
returns its normal replay response without a new debit.

`takeFreeJobDetailed` distinguishes `taken`, `refused`, `none`, and `ambiguous`.
Every `ok: false` reply is retained for the existing refusal handling, including
unlisted codes. Only an explicit `{ ok: true, taken: false }` establishes no allowance admission.
A thrown non-refusal error, malformed result, or unreadable 2xx body is ambiguous.
On a would-be ceiling breach, an existing owned job permits normal replay;
absence or a failed lookup returns 503 `admission_unknown`, with no debit and no
claim that the request was rejected. `takeFreeJob` retains its previous return
values for chat callers.

The legacy seven-argument `admit_fal_dispatch` reads and debits its own catalog
price. A Worker comparison cannot constrain that transaction. Until PR B, **every
new capped durable admission is refused**, at any ceiling, with 503
`admission_unavailable`, without calling admission SQL. A verified existing job
uses the legacy admission RPC, retaining its payload-identity validation. Failed
existence checks return `admission_unknown`. Uncapped requests are unchanged.

Web and mobile retain original indexes, inputs, keys and accepted results for a
batch. Retries skip accepted items. Price and allowance updates do not change
request identity. An allowance is allocated by position among unresolved items,
not the original index. Unknown items reconcile with the same key at the quoted paid ceiling and
reserve no new allowance. That ceiling is included in the displayed remaining
maximum; a replay itself never adds a debit. A higher server price still follows
the confirmation flow. No automatic retry
is performed. Explicitly starting another batch or editing inputs drops the old
continuation and quote.

A `price_changed` response first triggers a fresh allowance read (failure means
zero available), then freezes one snapshot using `expected_credits`. That same
snapshot drives the displayed remaining total, the confirmation control, and
each outgoing ceiling. This overrides the cached public catalog and stale free
allowance. Editing inputs discards the override. `admission_unknown` copy makes
no non-acceptance claim; `admission_unavailable` explicitly means no charge.

### Release sequencing and verification limits

PR B must provide a distinct capped RPC with the ceiling check inside the locked
SQL transaction. It is a separate migration work order, not part of PR A. **Do not
turn `MAX_CHARGE_ENABLED` on while `FAL_DURABLE_DISPATCH_ENABLED` is true in
production until PR B (capped durable admission) exists.** Clients send the field
for all models; the default-off server gate preserves legacy admission until
that sequencing condition is met. The checked-in production
`wrangler.jsonc` omits the two enabling flags; `falDispatchEnabled` requires both
`FAL_DISPATCH_SCHEMA_ENABLED` and `FAL_DURABLE_DISPATCH_ENABLED` to be `true`.
The implementation session could not verify deployed flags: the read-only
Wrangler check had an expired token and could not reach the authentication server.
Production rollout is therefore unverified and must not infer live settings
from the local defaults. This work order does not deploy or change live flags. Adding the requested
standalone default-off switch increases configured public variables to 67; the
local budget test now allows 67 (117 bindings at the recorded 50-secret footprint).

The live catalog feeds the same unit price to these clients and `priceFor`.
Cached prices can nevertheless differ for **any model**. Concrete local drift:
`kling-2.6-pro-kie` has a bundled fallback of 16 while migration 0433 sets 18;
`kling-3.0-i2v-kie` changes from 26 to 29 in the same migration. A cached pre-change
catalog can show either old price. Clip Editor models (`record.edit`) price
resolved edit units server-side and are excluded from these Create pickers.
No live price inventory was available in this implementation session.
