# ADR-0348: Purchased Pack Credits expire 12 months after purchase (DRAFT)

Status: **Draft, proposed 2026-11-16, not accepted.** Nothing here is built, applied, listed in a store or shown to customers. Plan and work order: [`docs/operations/pack-credit-expiry-plan.md`](../operations/pack-credit-expiry-plan.md). This file was first drafted as 30 days; the owner changed the term to **12 months on all platforms** the same day (see Context).

**Scope (owner):** only the three credit packs, 156 / 392 / 1,177 credits at $9.99 / $24.99 / $74.99. Daily check-in credits, Subscription Credits and Free signup credits are unchanged. The retired 209 / 523 / 1,571 packs are out of scope. **Open:** do the new rules apply to new purchases only, or also to unspent credits already held (Question 1; recommendation: new purchases only).

Amends [ADR-0013](0013-credit-expiry-policy.md) ("purchased never expire"), [ADR-0018](0018-credit-pack-top-ups.md) and [ADR-0312](0312-packs-at-subscription-rate.md). Builds on the bucket pattern of [ADR-0064](0064-core-subscriptions.md) (0183/0184). Check-in is [ADR-0257](0257-daily-checkin.md).

## Context

Packs never expire today and every public statement says so. App Store Review Guideline 3.1.1 says credits bought by in-app purchase may not expire, except through Apple's [expiring consumables program](https://developer.apple.com/in-app-purchase/expiring-consumables/) for apps whose credits unlock generative AI. Read from that page on 2026-11-16, the program requires: a minimum term of 12 months unless local law requires otherwise; **new** in-app products (existing ones cannot be converted); the Account Holder to request the entitlement on Apple's form; the expiry term shown next to the price or buy button, with a paywall that explains what the credits are used for; the balance shown as a number or percentage; the balance that expires soonest spent first; reminder emails 30 and 7 days before expiry when a balance remains; and Subscription Credits, which are not expiring consumables, spent before the expiring ones. Non-AI consumables cannot expire. The owner chose one rule on web, iOS and Google Play, so the term is 12 months.

Money-spine constraints (CLAUDE.md): append-only ledger; balances change only through named RPCs; `credit_balances.balance = SUM(ledger_entries.delta)`; each sweep has a reconciliation function returning zero rows; every state-changing RPC is idempotent; new objects revoke explicitly.

## Decision (proposed)

1. **Per-purchase lots, not one shared date.** Each paid pack purchase creates a lot: `credit_pack_lots(id, user_id, top_up_id UNIQUE, credits_granted, credits_remaining, expires_at = purchased_at + 12 months)`. `credit_balances.pack_expiring_balance` is the materialised sum of `credits_remaining`; `ledger_entries.pack_expiring_delta` carries each row's share, as `subscription_delta` does. Reason: Apple requires the soonest-expiring balance to be spent first, a store refund must take back exactly that purchase's credits, and the customer is promised "12 months from purchase", which a shared date cannot state per purchase. The first draft preferred one extended date for simplicity; with lots required by the spend rule, that advantage is gone.
2. **Spend order.** Subscription, then Free, then Expiring Pack lots earliest expiry first, then ordinary (legacy and non-purchased) Pack. Subscription before expiring Pack is the Apple rule. Free before expiring Pack keeps ADR-0064's order.
3. **Only a paid pack purchase mints a lot,** through `credit_top_up` (web, and the store path of 0344 which calls it), and only for the new 12-month pack rows, when `pack_expiry_config.enabled` is true. Check-in, referrals, admin, Cinema and signup grants are unchanged.
4. **New products and rows.** New web pack rows and new Apple, Google Play and RevenueCat products, same sizes and prices, with the product id keeping the `ai.veyrnox.credits.` prefix the webhook requires (proposed `ai.veyrnox.credits.12m.156/392/1177`). Existing 156 / 392 / 1,177 rows and store products stay, inactive for new sales once the new ones are live, so a refund or delayed event for an old transaction still resolves (the 0421/0541 pattern). Old purchases remain non-expiring. This also answers Question 1 for the store packs: an old Apple product cannot be made to expire.
5. **Sweep and reconciliation.** `expire_pack_credits()` hourly on pg_cron writes one `expire:pack` row per lot per user, row-locked, idempotent (unique on lot id). `reconcile_pack_expiry()` returns zero rows and joins `reconcile_status()` and the nightly reconcile: bucket != sum of lots != sum of `pack_expiring_delta`; negative; sum of buckets over balance; a lot more than 2 days past expiry with credits left.
6. **Refunds, clawbacks, disputes.** `apply_top_up_refund`, store refunds, `apply_dispute_event` and `admin_credit_clawback_guarded` take back from the refunded purchase's own lot first, then other expiring lots latest-first, then ordinary Pack, capped at what is left. Expired credits are not clawed back; a refund after expiry returns money only and existing shortfall and Freeze rules apply.
7. **Notices.** Expiry term next to the price and buy button (web, iOS, Android), a paywall line saying what credits are for, the balance shown as a number with the next expiry date, and consent `supply-consent-v2` at web checkout. Reminder emails 30 and 7 days before each lot expires, through the existing Resend adapter (`packages/adapters/resend.js`, as `lib/violationEmail.js` does), from a sweep that writes only outbox rows and never touches the ledger.
8. **Ships off.** DB switch `pack_expiry_config.enabled` ships false; customer-visible copy sits behind the `packExpiry` key in `APP_RUNTIME_FLAGS` (the Worker is at its binding cap). Stores first, then copy, then the DB switch.
9. **RevenueCat's own virtual-currency expiry is not used.** Its documentation says one-time purchase currency cannot expire; Veyrnox keeps balances in its own ledger and uses RevenueCat only to deliver purchase events.

## Open questions (owner decisions; none assumed)

| # | Question | Recommendation |
|---|---|---|
| 1 | New purchases only, or also unspent credits already held? | **New purchases only.** Existing buyers were told credits never expire, and an old Apple product cannot be converted anyway. |
| 2 | Is 12 months acceptable in every country served? Apple allows shorter only where local law requires it. | Lawyer check (UK/EU) before launch; see plan section 10. |
| 3 | Product ids | Accept `ai.veyrnox.credits.12m.*` so the webhook prefix check is unchanged. |
| 4 | Is Veyrnox eligible, i.e. do its credits unlock only generative AI services? | Likely yes; Apple decides on the request form. Anything non-AI sold as credits would fail the program. |
| 5 | Google Play: any expiry rule? | Unverified. A search found no Google text on expiry (only that virtual currency must use Play Billing and be spent in the same app). Read the current Payments policy before sale. |

## Consequences

- Migrations: schema with lots and RPC changes, sweep and reconcile, config and cron, new pack and store rows, reminder outbox. Take the next free numbers on `main` at build time after checking open PRs (0554 is already used on a branch; 0555 onward is untested).
- Every "never expire" string must change for the three new packs in all 11 languages, legal pages, store listings and generated knowledge; the old packs keep "never expire" until retired.
- Reconciliation gains lot equations; a dead sweep shows two days late, as with 0184.
- Rollback: `enabled = false` and `packExpiry` false. Lots already created keep their dates and still expire. Releasing them is a separate owner decision written as a compensating migration, never an UPDATE of ledger rows.
- Revenue: a 12-month window yields little breakage but is the lowest legal and review risk. Plan for refund and support volume around reminders.
