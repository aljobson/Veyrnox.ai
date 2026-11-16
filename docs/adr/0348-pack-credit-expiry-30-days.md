# ADR-0348: Purchased Pack Credits expire 30 days after purchase (DRAFT)

**Scope (owner, 2026-11-16): only the three credit packs, 156 / 392 / 1,177 credits at $9.99 / $24.99 / $74.99. Check-in, Subscription and Free signup credits are unchanged; the retired 209 / 523 / 1,571 packs are out of scope.** Whether this applies to new purchases only or also to unspent credits already held stays open (Question 1; recommendation: new purchases only).

Status: **Draft — proposed 2026-11-16, not accepted.** The owner has chosen the 30-day length in chat; the open questions below are not decided. Nothing in this ADR is built, applied, or shown to customers. Plan and work order: [`docs/operations/pack-credit-expiry-plan.md`](../operations/pack-credit-expiry-plan.md).

Amends [ADR-0013](0013-credit-expiry-policy.md) (option 2: "purchased never expire"), [ADR-0018](0018-credit-pack-top-ups.md) and [ADR-0312](0312-packs-at-subscription-rate.md) ("Pack Credits never expire"). Builds on the bucket pattern of [ADR-0064](0064-core-subscriptions.md) (migrations 0183/0184). Daily check-in is [ADR-0257](0257-daily-checkin.md).

## Context

One-off packs (156 / 392 / 1,177 credits at $9.99 / $24.99 / $74.99 on web, App Store and Google Play) never expire today. Every public statement says so: Terms, Refund Policy, the pricing page, the credits paywall and both store descriptions ("Credits never expire"). Subscription Credits already expire at the cycle end and Free Credits 90 days after the grant. The owner wants purchased credits to expire 30 days after purchase.

Money-spine constraints that bind the design (CLAUDE.md): the ledger is append-only; every balance change goes through a named RPC; `credit_balances.balance = SUM(ledger_entries.delta)`; each sweep has a reconciliation function that returns zero rows; every state-changing RPC is idempotent; new objects revoke explicitly.

## Decision (proposed)

1. **A fourth balance bucket, "Expiring Pack Credits".** `credit_balances.pack_expiring_balance` and `pack_expires_at`; `ledger_entries.pack_expiring_delta`. It mirrors `subscription_balance` / `subscription_expires_at` (0183). Credits that were bought before the switch, and every other pack-like grant, stay in ordinary non-expiring Pack Credits (`balance - free - subscription - pack_expiring`).
2. **Only a paid top-up mints them.** `credit_top_up` (web, and the store path in 0344 which calls it) grants through `ledger_grant` with a new `p_expiring` argument, or a thin `ledger_grant_expiring`, only when the DB switch `pack_expiry_config.enabled` is true. Grants for referrals, check-in, admin, Cinema and anything else are unchanged unless Question 2 or 5 says otherwise.
3. **Expiry date.** `pack_expires_at = purchase time + 30 days`. A second purchase while credits remain moves the single date to the newer purchase's date (decision "extend", favourable to the customer, simplest to explain: "credits expire 30 days after your latest pack"). The strict alternative, a lot per purchase, is costed in the plan and rejected for v1 only on complexity; the owner can overrule (Question 6).
4. **Spend order.** Subscription, then Free, then Expiring Pack, then ordinary Pack. Expiring credits go before non-expiring ones so a buyer is not penalised for holding both. A refund returns to the bucket the debit took it from, and credits past their date are expired again in the same call (the 0183 rule), so a refund never revives expired credits.
5. **Sweep.** `expire_pack_credits()` hourly on pg_cron, one `expire:pack` row per user for the unspent remainder, idempotent under the row lock like `expire_subscription_credits` (0184). `reconcile_pack_expiry()` joins the nightly reconcile and `reconcile_status()`; it must return zero rows.
6. **Refunds, clawbacks, disputes.** `apply_top_up_refund`, `apply_dispute_event` and `admin_credit_clawback_guarded` take back from Expiring Pack first, then ordinary Pack, and cap at what is left. Expired credits are not clawed back; a refund after expiry returns money with no credit movement and the existing shortfall rules apply. Frozen-account behaviour is unchanged.
7. **Consent and notice.** Web checkout shows the expiry date and requires a second explicit acknowledgement; `consent_version` moves to `supply-consent-v2` for the combined wording. Stores: product descriptions change before sale. Old consent versions are refused once the rule is live.
8. **Ships off.** DB switch `pack_expiry_config.enabled` ships `false`. Customer-visible copy is gated by the request-time runtime flag `packExpiry` in `APP_RUNTIME_FLAGS` (the Worker is at its binding cap, so no new `*_ENABLED` var). Flip order is stores, then copy and consent, then the DB switch.

## Open questions (owner decisions; none assumed)

| # | Question | Recommendation |
|---|---|---|
| 1 | New purchases only, or also credits people hold today? | **New purchases only.** Existing buyers were told credits never expire; a retroactive rule is the highest consumer-law and refund risk. |
| 2 | Check-in credits (ADR-0257) | **Decided by the owner: unchanged.** Out of scope. |
| 3 | Is 30 days the right length? | **Longer (6 to 12 months) is safer** for UK/EU unfair-terms and refund exposure. The owner asked for 30 days; the plan builds the length as a config value so it can change before launch without a migration. |
| 4 | **Apple rule.** App Store Review Guideline 3.1.1 says credits bought with in-app purchase may not expire. Do iOS packs expire? | **Verify the current guideline text before any work.** If it holds, iOS packs cannot expire: the rule applies to web and Google Play only, or the iOS packs are repriced, or the idea is dropped. This can decide the whole feature. |
| 5 | Referral rewards | **Unchanged** (only the three packs expire). |
| 6 | One date for the bucket (extend) or a lot per purchase? | **One date, extended by the newest purchase.** Lots roughly double the SQL and every refund path. |

## Consequences

- Migration cost: schema + RPCs (about 0554), sweep + reconcile + status (about 0555), config + cron (about 0556); take the next free numbers on `main` after checking open PRs.
- Every "never expire" string must change in all 11 languages, the legal pages, the store listings and the generated product knowledge before the switch. Stale copy after the flip is a misrepresentation.
- Reconciliation gains one more equation; a dead sweep is caught two days late, as with 0184.
- Rollback: set `pack_expiry_config.enabled = false`. Credits already in the bucket keep their dates and still expire (the customer was told); a separate owner decision is needed to release them into ordinary Pack Credits, written as a compensating migration, never an UPDATE of ledger rows.
- Revenue: breakage helps margin only if people let credits lapse. It will also raise refund requests and support load around day 25 to 30. Plan reminder emails (not in this ADR).
