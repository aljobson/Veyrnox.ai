# Plan: Pack Credits expire 12 months after purchase

Status: **plan only, revised 2026-11-16.** No code, migration, store edit or production change is made by this document. Decision record: [ADR-0348 (draft)](../adr/0348-pack-credit-expiry-12-months.md). Prices are not touched (ADR-0312, 0540/0541).

**Owner decisions so far:** the term is **12 months on all platforms** (web, iOS, Google Play); scope is **only the three packs** 156 / 392 / 1,177 credits at $9.99 / $24.99 / $74.99; check-in, Subscription and Free signup credits are unchanged; the retired 209 / 523 / 1,571 packs are out of scope. **Still open:** new purchases only versus also unspent credits already held (D1; recommendation: **new purchases only**).

The term moved from 30 days to 12 months because Apple allows expiring credits only through its expiring consumables program (Guideline 3.1.1; program page read 2026-11-16). Facts below come from `main` at `4f23a804e`; re-check migration and ADR counters when work starts (0554 is already used on a branch; ADR 0348 is this one).

## 1. Apple's requirements and how each is met

| Apple requirement | Plan |
|---|---|
| Credits only for generative AI services; non-AI consumables cannot expire | Veyrnox credits spend on generation and chat. Apple decides on the form (owner step O1). |
| Account Holder requests the entitlement on Apple's form | **Owner step O1.** Cannot be done by code or by a session. |
| New in-app products; existing ones cannot be converted | New products `ai.veyrnox.credits.12m.156/.392/.1177` (keeps the `ai.veyrnox.credits.` prefix that `packages/adapters/revenuecat.js:58,104` requires). Owner creates them in App Store Connect, Play Console and RevenueCat (O2). |
| Term at least 12 months, unless local law shortens | `expires_at = purchased_at + 12 months`, stored as `pack_expiry_config.months`. |
| Term next to price or buy button; paywall says what credits are for | Web `TopUpPacks.js`, mobile pack cards and paywall: "Expires 12 months after purchase" plus a line "Credits pay for image, video, voice, music and chat generation". |
| Show balance as number or percentage | Balance already a number; add next-expiry date from `read_user_credits`. |
| Soonest-expiring spent first | Lots (section 3). |
| Subscription credits spent before the expiring ones | Existing order already does this (section 4). |
| Reminder emails 30 and 7 days before expiry | Section 8. |

## 2. Owner steps (cannot be done in code)

- **O1.** Account Holder submits Apple's expiring consumables request form.
- **O2.** Create the three new products at the same prices in App Store Connect and Play Console, add them to RevenueCat and the current offering; set descriptions to the expiry wording (nothing may say "Credits never expire" for them).
- **O3.** Lawyer check (section 10).
- **O4.** Say in chat when to flip each production switch (section 11).

## 3. Decisions

| # | Decision | State | Recommendation |
|---|---|---|---|
| D1 | New purchases only, or also credits held today | **open** | New purchases only. Existing buyers were told never; old Apple products cannot be converted. |
| D2 | 12 months all platforms | decided | Build as config so a country-specific shorter term is possible if law requires. |
| D3 | Scope: three packs only | decided | Check-in, referral, subscription, signup unchanged. |
| D4 | Product ids `ai.veyrnox.credits.12m.*` | open | Accept; webhook prefix check unchanged. |
| D5 | Reminder emails | required by Apple | Section 8. |

## 4. Data model: lots (re-evaluated; now recommended)

Earlier draft: one bucket with a single date extended by each purchase. Re-evaluated against Apple's "soonest-expiring first" and per-purchase refunds: use **lots**. A shared date cannot say "12 months from this purchase", and a store refund must take back that purchase's credits.

- `public.credit_pack_lots(id uuid pk, user_id, top_up_id uuid unique references top_ups, credits_granted int, credits_remaining int, purchased_at, expires_at, expired_at null)`. RLS enabled and forced, no browser grants, service-role RPCs only.
- `credit_balances.pack_expiring_balance int not null default 0` (sum of live lots' remaining; constraints `>= 0`, `free + subscription + pack_expiring <= balance`).
- `ledger_entries.pack_expiring_delta int not null default 0` with the 0183-style CHECKs; reason `expire:pack`.
- Only the new 12-month pack rows (`credit_packs.expires_after_months is not null`, new column) create lots. Legacy Pack Credits are the remainder `balance - free - subscription - pack_expiring` and stay non-expiring. No backfill, no UPDATE of ledger rows.
- Cost: roughly twice the single-bucket design. Estimate 5 to 7 days SQL and acceptance tests, 2 to 3 days web and mobile, plus the owner and store lead time.

## 5. Spend order

**Subscription, then Free, then Expiring Pack lots (earliest `expires_at` first), then ordinary Pack.** Subscription before expiring is Apple's rule and already the order. `ledger_debit` (latest body `0240_fal_reserved_only_admission.sql`, built on 0183) computes spendable from live lots only, so an expired but unswept lot cannot be spent. Each debit writes one ledger row with `pack_expiring_delta` and decrements lots in order inside the balance row lock. `ledger_refund` returns credits to the lots they came from; a lot already past expiry is expired again in the same call, so a refund never revives expired credits. Apply the same to `ledger_unlock` and `reverse_cinema_unlocks`.

## 6. Sweep and reconciliation

- `expire_pack_credits(p_as_of, p_limit)`: pattern of `expire_subscription_credits` (0184:297-339). Finds lots with `credits_remaining > 0 AND expires_at <= p_as_of AND expired_at IS NULL`, locks the user's balance row (`SKIP LOCKED`), re-checks, writes one `expire:pack` ledger row per lot with `pack_expiring_delta = -remaining`, sets `expired_at`. Waits while a generation that took lot credits is unsettled (the 0038 rule). Idempotent: unique on `(lot id, reason)`.
- Hourly `pg_cron` job `veyrnox-expire-pack-credits`, guarded like 0037/0038.
- `reconcile_pack_expiry()` must return zero rows: bucket != sum of live lot remainders != sum of `pack_expiring_delta`; negative; buckets over balance; lot with credits more than 2 days past expiry. Join into `refresh_reconciliation_snapshot()` / `reconcile_status()` (0185 pattern) and the `veyrnox-reconcile-balances` job.

## 7. Refund, clawback, dispute, idempotency

- `apply_top_up_refund` (0257), store refund `apply_store_refund` (0344/0358), `apply_dispute_event` (0059/0098), `admin_credit_clawback_guarded` (0447): take back from the refunded purchase's own lot first, then other expiring lots latest-expiry-first, then ordinary Pack, capped at what remains; never Free or Subscription. Put the loop in one private function so the four paths cannot drift. Expired credits are not clawed back; refund after expiry returns money only, existing shortfall and Freeze rules apply.
- Idempotency: `credit_top_up` already returns early for a `credited` top-up; the lot is created in the same transaction with `top_up_id` unique, so a replay cannot create a second lot or move the date. Sweep and debits keep their existing keys. Test each.

## 8. Reminder emails (30 and 7 days before expiry)

Path: the existing Resend adapter `packages/adapters/resend.js` (`resendConfig`, `isConfigured`, `sendEmail`), the way `lib/violationEmail.js` sends violation notices; add `lib/packExpiryEmail.js` and strings in `lib/i18n/email.mjs` for the 11 languages. A per-minute or hourly sweep reads lots `expires_at` within 30 d or 7 d, writes only an outbox table (`pack_expiry_reminders`, unique `(lot_id, days_before)`), and sends from there. It never calls the ledger and never runs on a purchase path (the ADR-0113 push-sweep rule). Only sent when a balance remains, so a spent lot sends nothing. Needs `RESEND_API_KEY` and the sender address configured (already live for violations); one more production config check, not a new binding. Erase the outbox rows with the account (trigger on `users.deleted_at`).
## 9. Web and mobile, and where text says "never expire"

- **Expiry before checkout.** Web `app/veyrnox/_components/TopUpPacks.js`: under each new pack "Expires `<date>` (12 months from today)"; date computed by `GET /api/v1/top-ups` so client clocks cannot mislead. Stripe line item name (`packages/adapters/stripe.js:84`) gains the term. Mobile credits screen and paywall: same line on each pack card and in confirm. Consent: `app/api/v1/top-ups/route.js` requires `supply-consent-v2` for the new packs (wording adds expiry), `supply-consent-v1` stays for the old.
- **Balance.** `GET /api/v1/balance` / `read_user_credits` add `pack_expiring_credits` and `pack_next_expires_at`; show on web credits page and mobile.
- **Strings (grep 2026-11-16).** `lib/i18n/messages/en.mjs`: `home.faq.9.a`, `pricing.packs.lead`, `pricing.cards.never`, `pricing.packs.valueLead`, `guide.credits.s3.body` and the ten other `lib/i18n/messages/<lang>.mjs`; `lib/i18n/messages/app/<lang>/credits-packs.mjs` (`app.credits.packs.neverExpire`, `app.credits.paywall.firstBody`, `app.credits.paywall.lowBody`), `editor-credits.mjs` (`app.editor.credits.once`, `.expiry`); legal `terms.mjs` `b010`, `refund.mjs` `b007`, `binding.mjs`; mobile `apps/mobile/src/lib/i18n/messages/<lang>/credits.ts`, `billing.ts`, `helpGuides.ts`, `referrals.ts`, and `apps/mobile/src/lib/legal/generated/*.ts` (regenerate); hard-coded `app/veyrnox/_lib/tokens.js:308`, `guides.js:82,86`, `lib/featureTours.js:88`, `lib/productKnowledge.js:210,217,222,243`, `lib/generatedProductInventory.js` (`npm run sync:vey-knowledge`), `CONTEXT.md:18`; pinned by `tests/pricingCards.test.mjs:60`, `apps/mobile/__tests__/paywallPrompt.test.tsx:106`, `tests/fixtures/*english-main.json`; amendment notes (not rewrites) on ADR 0013, 0018, 0312 and `docs/operations/credit-pack-launch-acceptance.md:22`.
- Because only the three new products expire, the old packs keep "never expire" copy until they are retired. Copy is shown per pack, not globally, and the display flag is `packExpiry` in `APP_RUNTIME_FLAGS`. Native review is needed for machine-drafted translations.

## 10. Legal and platform checks (owner)

1. **Apple eligibility** (O1): credits must unlock generative AI only.
2. **Google Play:** unverified. A search on 2026-11-16 found no Google Play text on expiry of consumable credits, only that virtual currency must use Play Billing and be used in the same app. Read the current Payments policy and consumable-product help before the Play product goes on sale; an implementer or the owner should confirm in Play Console policy status.
3. **UK/EU:** a 12-month term for prepaid credits is the common safe market range but is not a legal clearance. Ask a lawyer about the Consumer Rights Act 2015 fairness test and CMA guidance, EU Directive 93/13 and national case law on expiry of prepaid balances, whether "12 months" suffices in every country served, and whether any country needs a shorter term (Apple allows shorter only where law requires).
4. **Cancellation rights:** the Supply Consent waives the 14-day right once credits are used; check that this plus expiry reads fairly, and what refund unspent credits get in the 14 days.
5. **Retroactivity (D1):** changing credits already sold needs notice and probably consent; new purchases only avoids it.
6. **US:** state stored-value and gift-certificate laws; some exclude virtual items.
7. **Tax:** treatment of unredeemed credits ("breakage") and the Stripe `tax_code`.
8. Terms and Refund Policy edits need the notice period the Terms already promise.

## 11. Order of work

1. Owner: D1 and D4; Apple request (O1); lawyer (O3); read Google policy.
2. ADR-0348 accepted with those answers.
3. Build behind switches, nothing visible: migrations (lots, RPCs, sweep, reconcile, `pack_expiry_config` ships `enabled = false`, new `credit_packs` rows ship inactive, reminder outbox); then tests. Apply only through the `apply-migrations` workflow with owner approval. Reconcile clean for 24 h.
4. Copy PR behind `packExpiry`, regenerated legal and knowledge, `supply-consent-v2`, reminder email templates.
5. Owner creates the new store products and listings with the expiry wording (O2), RevenueCat offering; products not on sale yet.
6. Staging: both switches on; Stripe test card, App Store and Play sandbox purchases, an advanced-clock sweep, a refund, both reminders.
7. Production, on the owner's words in chat: activate the new rows and `pack_expiry_config.enabled`, then `packExpiry`; retire the old pack rows from sale when the owner chooses (old transactions still resolve).
8. At 11 months, 29 days: confirm reminder volume; at 12 months confirm the first `expire:pack` rows and reconcile clean.

Rollback: switches off; created lots keep their dates (ADR-0348 Consequences).

## 12. Test plan

- `packages/db/pack-expiry.acceptance.test.ts` (real Postgres, UTC, replay in BEGIN/ROLLBACK): lot per paid purchase only for new rows and only when enabled; replay creates nothing; earliest-lot-first debit across two purchases; Subscription then Free then lots then ordinary; partial spend then sweep; sweep idempotent per lot; refund after expiry does not revive credits; each of the four take-back paths takes the refunded lot first and caps correctly; Frozen account unchanged; `reconcile_pack_expiry()`, `reconcile_balances()`, `reconcile_free_credits()`, `reconcile_subscription_credits()`, `reconcile_top_ups()` all zero rows after every case.
- Privileges: `scripts/test-default-privileges.mjs` allowlist, REVOKE/GRANT per function, `search_path = ''`; new tables classified in `scripts/test-account-deletion.mjs`.
- Web: consent v1 for old packs, v2 for new; expiry date field; `pricingCards.test.mjs` per flag; locale key parity across 11 languages; `sync:vey-knowledge` clean.
- Mobile: paywall and credits screen tests for the term line and balance expiry; `storeBillingCatalog.test.mjs`, `revenuecatWebhook.test.mjs` for the new product ids.
- Email: reminder at 30 d and 7 d once each, none when spent, none after erasure, send failure never changes ledger.
- Manual (staging): purchase on web, iOS sandbox and Android sandbox shows the date; store description matches the app.

## 13. Size

About 4 migrations (~1,200 SQL lines), ~60 string keys x 11 languages plus 2 legal pages, 8 to 10 UI files, reminder sweep and templates, 1 acceptance suite plus web, mobile and email tests. Estimate 8 to 12 working days of build, with Apple, Google, legal and store setup as calendar time outside the code.
