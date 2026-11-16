# Plan: Pack Credits expire 30 days after purchase

**Scope (owner, 2026-11-16): the 30-day expiry applies ONLY to the three credit packs, 156 / 392 / 1,177 credits at $9.99 / $24.99 / $74.99. Daily check-in credits, Subscription Credits and Free signup credits are unchanged. The retired 209 / 523 / 1,571 packs are out of scope.** Still open: new purchases only versus also unspent credits already held (D2; recommendation: new purchases only).

Status: **plan only, 2026-11-16.** No code, migration, store edit or production change is made by this document. Decision record: [ADR-0348 (draft)](../adr/0348-pack-credit-expiry-30-days.md). Prices are not touched (see [ADR-0312](../adr/0312-packs-at-subscription-rate.md), 0540/0541).

Facts below were read from `main` at `4f23a804e`. Latest migration is `0553`; latest ADR is `0347`; open PRs are #2352 and #1979, neither numbers a migration. Re-check both counters when work starts: take the next free number on `main`, look at open PRs and `git log --all` first.

## 0. Read this first: two blockers outside the code

1. **Apple rule (verify now).** App Store Review Guideline 3.1.1 has said that credits or in-game currency bought with in-app purchase "may not expire". Read the current text before any build. If it stands, iOS packs (`ai.veyrnox.credits.156/392/1177` on Apple) cannot carry an expiry, so the feature is web + Google Play only, or the owner drops it. Web checkout would then expire credits that the same account's iOS purchase does not, and the paywall must say which. Do not build until this is answered.
2. **Consumer law (owner to check with a lawyer, see section 10).** Credits sold as "never expire" with a 14-day cancellation-waiver consent, now expiring after 30 days, is the exposure. New purchases only (recommended) removes the retroactive part; it does not remove the fairness-of-term question for a short window.

## 1. Decisions needed from the owner

| # | Decision | State | Recommendation |
|---|---|---|---|
| D1 | 30 days | **decided** | Build the length as config (`pack_expiry_config.days`), not a constant. |
| D2 | New purchases only, or also credits held today | open | New purchases only. Existing buyers were told credits never expire. |
| D3 | Check-in credits (ADR-0257) | **decided (owner, via session message): unchanged** | Out of scope. |
| D4 | Window longer than 30 days | open | 6 to 12 months is safer for UK/EU. Build so it can change before launch. |
| D5 | Apple allows expiry? | open, blocker | Verify guideline 3.1.1 first. |
| D6 | Several purchases: one date (extend) or a date per purchase | open | One date, extended to the newest purchase. |
| D7 | Referral rewards | **decided: unchanged** | Out of scope (only the three packs expire). |
| D8 | Reminder emails at day 7 / 3 / 1 | open | Yes; Resend already sends violation notices (memory: transactional email via Resend). Separate PR. |

## 2. Data model: bucket vs lots

Current buckets: Free (`free_balance`, 0037, 90 days), Subscription (`subscription_balance` + `subscription_expires_at` + `subscription_cycle`, 0183/0184), and everything left over is Pack: `balance - free_balance - subscription_balance` (the 0183 constraint `free + subscription <= balance`).

**Option A: third expiring bucket (recommended).**
- `credit_balances.pack_expiring_balance INT NOT NULL DEFAULT 0`, `pack_expires_at TIMESTAMPTZ`; constraints `pack_expiring_balance >= 0`, `free + subscription + pack_expiring <= balance`, `pack_expiring_balance = 0 OR pack_expires_at IS NOT NULL` (copy 0183 lines 65 to 71).
- `ledger_entries.pack_expiring_delta INT NOT NULL DEFAULT 0`, with the 0183-style CHECK that each bucket delta stays within `delta` and a reasons CHECK allowing it only on `grant:topup`, `debit:*`, `refund:*`, `reverse:*`, `expire:pack`, `clawback`.
- Dates: `pack_expires_at = max(existing live date, now() + days)`: a new purchase pushes older expiring credits out (D6 "extend"). It never shortens a customer's date.
- Legacy Pack Credits need no backfill: they are the remainder and keep never expiring (D2). Nothing UPDATEs a ledger row.
- Size: one schema migration (about 200 lines of DDL + `CREATE OR REPLACE` of `ledger_debit`, `ledger_refund`, `ledger_unlock`, `read_user_credits`, `read_user_balance`, `apply_top_up_refund`, `apply_dispute_event`, `admin_credit_clawback_guarded`, `credit_top_up`, store `apply_store_refund`), each rewritten from its latest body: `ledger_debit` from `0240_fal_reserved_only_admission.sql`, refund functions from `0257`/`0058`, clawback from `0447`. Rough estimate: 2 to 3 days build, 1 day review, acceptance tests 1 to 2 days.

**Option B: a lot per purchase** (`credit_pack_lots(top_up_id, credits_granted, credits_remaining, expires_at)`, FIFO by earliest expiry). Exact "30 days after each purchase", and refund maps one top-up to one lot. Costs: every debit writes several lot rows, `ledger_refund` must return to the originating lots, the balance invariant becomes a second sum over lots, and a new reconcile joins lots to ledger. Roughly twice A. Use B only if the owner insists on strict per-purchase dates (D6).

## 3. Spend order and where expiring credits sit

Today (ADR-0064): Subscription, then Free, then Pack. Proposed: **Subscription, Free, Expiring Pack, ordinary Pack.** Expiring credits go before non-expiring so that a customer holding both loses nothing by spending normally. In `ledger_debit` add `v_pack_exp_live := CASE WHEN pack_expires_at > now() THEN pack_expiring_balance ELSE 0 END` beside the 0183 `v_sub_live`, and compute `v_spendable` from live buckets only so an expired-but-unswept balance cannot be spent. Parts: `v_pack_exp_part := LEAST(v_pack_exp_live, p_credits - sub - free)`.

`ledger_refund` returns each part to its own bucket; the part belonging to an already-expired bucket is expired again in the same call (the 0183 rule for ended cycles), so a refund never revives expired credits.

## 4. Sweep and reconciliation

- `public.expire_pack_credits(p_as_of timestamptz default now(), p_limit int default 500)`: copy `expire_subscription_credits` (0184:297-339). Selects users with `pack_expiring_balance > 0 AND pack_expires_at <= p_as_of`, `FOR UPDATE SKIP LOCKED`, re-checks under the lock (a purchase may have moved the date), writes one `expire:pack` ledger row (`delta = -rem`, `pack_expiring_delta = -rem`), zeroes the bucket. Waits while a generation that took expiring credits is unsettled, as `expire_free_credits` does (0038), so a later Credit Refund cannot restore expired credits.
- Idempotency: the row lock plus the zeroed bucket make a replay a no-op; add a partial unique index on `(user_id, reason, pack_expiry_cycle)` if two sweeps could race (the 0037 pattern).
- Cron: hourly `veyrnox-expire-pack-credits`, created with the same guarded `cron.schedule` block as 0037/0038.
- `public.reconcile_pack_expiry()` returning zero rows: bucket != `SUM(pack_expiring_delta)`; bucket < 0; `free + subscription + pack_expiring > balance`; bucket > 0 with null date; bucket > 0 and date more than 2 days past (dead sweep). Join it into `refresh_reconciliation_snapshot()` / `reconcile_status()` (0185 shows the pattern) and the `veyrnox-reconcile-balances` cron.
- `credit_balances.balance = SUM(ledger_entries.delta)` is unchanged: expiry is a negative-delta row.

## 5. Refund, clawback, dispute

All three are service-role RPCs that take back credits; each caps at what the buckets hold.
- `apply_top_up_refund` (latest body 0257, store variant 0344/0358): claw back from Expiring Pack first, then ordinary Pack; never from Free or Subscription. If the refunded credits already expired or were spent, existing shortfall rules (0257, Freeze) apply unchanged. Money is refunded; no credit row is written for credits that no longer exist.
- `apply_dispute_event` (0059/0098): Freeze behaviour unchanged; its take-back uses the same helper.
- `admin_credit_clawback_guarded` (latest 0447): cap becomes `balance - free - subscription` as before; take from Expiring Pack first. Its audit row records the bucket split.
- Put the shared "take back N credits, expiring first" logic in one private function so the three paths cannot drift.
- `reverse_subscription_grant`, `referral_sweep`, `delete_user_job`: not changed; confirm by test.
- Account deletion (ADR-0111): the balance is left as is; classify `pack_expiring_*` columns in `scripts/test-account-deletion.mjs` if a new table is added (Option B only).

## 6. Idempotency

Every new or changed RPC keeps its existing key: `top_ups.id` / `webhook_events(source, external_id)` for grants, `jobs.idempotency_key` for debits, `(user_id, expire:pack, cycle)` for the sweep. A replayed top-up webhook must neither re-grant nor move `pack_expires_at` again (the `credit_top_up` `status = 'credited'` branch already returns early; assert the date is unchanged in the test).

## 7. Flag and rollout switches

- **DB switch** `pack_expiry_config(enabled boolean, days int)`, one row, ships `enabled = false`, same shape as `starter_credit_config` (0422). `credit_top_up` reads it; off means the grant is an ordinary Pack grant exactly as today.
- **Display switch**: request-time `packExpiry` in `APP_RUNTIME_FLAGS` (production) / `PACK_EXPIRY_ENABLED` (staging only). The Worker is at its binding cap (CLAUDE.md, `lib/appRuntime.js`), so no new `wrangler.jsonc` var in production. The flag ships absent/false and drives every piece of new copy, the expiry date line and the consent v2 wording.
- Keep the two in step: the display switch must never be on while the DB switch is off, and the reverse is unsafe. One owner-run checklist flips them in the order in section 11.

## 8. Web, mobile and copy

### 8.1 Where the text says packs never expire (grep, 2026-11-16)

| Surface | Files and keys |
|---|---|
| Web pricing / home / guides | `lib/i18n/messages/en.mjs`: `home.faq.9.a`, `pricing.packs.lead`, `pricing.cards.never`, `pricing.packs.valueLead`, `guide.credits.s3.body`; the same keys in `ar de es fr hi ja ko pt ru zh .mjs` (11 languages) |
| Web app | `lib/i18n/messages/app/<lang>/credits-packs.mjs`: `app.credits.packs.neverExpire`, `app.credits.paywall.firstBody`, `app.credits.paywall.lowBody`; `editor-credits.mjs`: `app.editor.credits.once`, `app.editor.credits.expiry` (11 languages) |
| Legal | `lib/i18n/messages/legal/<lang>/terms.mjs` `b010`; `refund.mjs` `b007`; `binding.mjs` `supply` (consent) ; mobile copies `apps/mobile/src/lib/legal/generated/*.ts` (regenerate, do not hand edit) |
| Hard-coded English | `app/veyrnox/_lib/tokens.js:308`, `app/veyrnox/_lib/guides.js:82,86`, `lib/featureTours.js:88`, `lib/productKnowledge.js:210,217,222,243` and generated `lib/generatedProductInventory.js` (`npm run sync:vey-knowledge`), `CONTEXT.md:18` |
| Mobile | `apps/mobile/src/lib/i18n/messages/<lang>/`: `credits.ts` (`credits.packs.neverExpire`, `credits.paywall.packsNeverExpire`), `billing.ts` (`billing.paywall.vey.hello.credits`), `helpGuides.ts` (`helpGuides.mobile.credits.buying`, `helpGuides.content.credits.s3.body`), `referrals.ts` (check wording) |
| Tests that pin the wording | `tests/pricingCards.test.mjs:60`, `apps/mobile/__tests__/paywallPrompt.test.tsx:106`, `tests/fixtures/app-*-english-main.json`, `app-knowledge-main.json`, `legal-english-main.json`, `public-site-knowledge-main.json` |
| Docs | `docs/adr/0013`, `0018`, `0312` (add an amendment pointing to ADR-0348, do not rewrite), `docs/operations/credit-pack-launch-acceptance.md:22` |
| Stores (outside the repo) | App Store Connect and Play Console product descriptions, section 9 |

Rule: copy changes behind the display flag (`packExpiry`); strings that cannot be flag-driven (legal pages, stores, generated knowledge) change in the same release train, before the DB switch. Machine-drafted translations need native review (as with the 2026-11 site translation). About 11 languages x 14 keys on the web and 11 x 5 on mobile, plus two legal pages.

### 8.2 Expiry date before checkout

- Web `app/veyrnox/_components/TopUpPacks.js`: under the selected pack show "Expires <date>, 30 days from today" using the locale's date formatter; the date is computed server-side by `GET /api/v1/top-ups` (new field `expires_at_preview`) so client clocks cannot mislead. The Stripe line item name (`packages/adapters/stripe.js:84`, "N Veyrnox credits") gains "(expire in 30 days)" behind the flag.
- Web balance: `GET /api/v1/balance` (`read_user_credits`) adds `pack_expiring_credits`, `pack_expires_at`; the credits page shows it like `free_expires_at` today.
- Mobile `apps/mobile/src/screens` credits and paywall: same line on each pack card and in the confirm step. On iOS this is subject to Question D5.
- Consent: `app/api/v1/top-ups/route.js` accepts `supply-consent-v1` today (`SUPPLY_CONSENT_VERSION`). With the flag on it requires `supply-consent-v2`, whose wording adds the expiry; the checkbox in `TopUpPacks.js:277` shows `binding.supply` for the matching version. `public.top_ups` already stores `consent_version` (RPC argument `p_consent_version`); v2 rows prove which wording applied. Old versions stay valid for refund history.
- Reminder emails at day 7/3/1 (D8): a sweep that reads `pack_expires_at` and writes only outbox tables, never a ledger path (the ADR-0113 push rule).

## 9. Stores (owner does these by hand; no listing is edited by this plan)

- **Google Play** `ai.veyrnox.credits.156/392/1177`: description currently "Credits never expire" (to be re-read in Play Console). Change to the expiry wording; check Play's own policy on virtual items before listing.
- **Apple** `ai.veyrnox.credits.156/392/1177`: matching description. Blocked on D5. Apple reads store text and in-app behaviour for consistency in review.
- Both must change **before the packs go on sale** and before the DB switch. Tracked in `docs/mobile/M7-STORE-SUBMISSION-CHECKLIST.md` row O4 and `docs/mobile/STORE-BILLING-PRODUCTION.md`; add a row for the expiry wording. RevenueCat needs no change (the credit count still comes from the product id, `packages/adapters/revenuecat.js`).

## 10. Legal and consumer-law checks for the owner

1. Apple 3.1.1 (section 0). Also check Google Play's policy on expiring paid virtual items.
2. UK Consumer Rights Act 2015 fairness test and CMA guidance on expiry of prepaid balances; EU Directive 93/13 and national case law on short expiry of paid credit (several EU courts have found short expiry of prepaid balances unfair). Ask for an opinion on 30 days versus 6 to 12 months.
3. Cancellation rights: the Supply Consent waives the 14-day right once credits are used. Check that expiring credits plus that waiver reads as one fair bargain, and what refund a customer gets for unspent credits in the 14 days.
4. Retroactivity (D2): a change to credits already sold needs notice and probably consent; new purchases only avoids it.
5. US: state laws on stored value and gift certificates (some exclude virtual items; some do not). Ask for a state list for markets served.
6. Terms and Refund Policy edits (`b010`, `b007`) need the same change notice period the Terms already promise.
7. Tax: Stripe `tax_code` on the pack and whether unredeemed ("breakage") credits change VAT treatment.

## 11. Order of work

1. Owner answers D2, D4, D5, D6 and checks Apple 3.1.1 (D5). Stop here if Apple forbids it for the iOS packs and the owner wants one rule on all channels.
2. Lawyer check (section 10) and ADR-0348 accepted with the owner's answers.
3. Build, all behind the switches, nothing visible: migrations (schema, RPCs, sweep, reconcile, config), then tests (section 12). Apply by the `apply-migrations` workflow only, owner-approved. Reconcile clean for 24 h with the switch off (the CLAUDE.md flag rule).
4. Copy PR: all strings and legal text behind `packExpiry`, regenerated knowledge, mobile legal regenerated, new `supply-consent-v2`.
5. **Owner edits Apple and Play product descriptions** and App Store/Play listings (nothing goes on sale first).
6. Staging: both switches on; run the section 12 manual checks with a Stripe test card and a store sandbox account.
7. Production flip, owner words in chat: `pack_expiry_config.enabled = true`, then `packExpiry` in `APP_RUNTIME_FLAGS` (same release). Watch `reconcile_status()` and sweep output for 24 h.
8. Day 30 after the first purchase: confirm the first `expire:pack` row, reminder emails, support volume.

Rollback: `enabled = false` and `packExpiry` false; existing bucket credits keep their dates (see ADR-0348 Consequences).

## 12. Test plan

- `packages/db/pack-expiry.acceptance.test.ts` (real Postgres, replay inside BEGIN/ROLLBACK, UTC server): top-up grants into the bucket only when the switch is on; second purchase extends the date and never shortens it; replay of the same top-up changes nothing; spend order (Sub, Free, expiring, ordinary); partial spend then sweep; sweep idempotent and one `expire:pack` row; refund of a debit after expiry does not revive credits; `apply_top_up_refund` takes expiring first; dispute and admin clawback caps; Frozen account unchanged; `reconcile_pack_expiry()`, `reconcile_balances()`, `reconcile_free_credits()`, `reconcile_subscription_credits()` and `reconcile_top_ups()` all return zero rows after each scenario.
- Privilege test: `scripts/test-default-privileges.mjs` and a REVOKE/GRANT assertion for every new function; `SECURITY DEFINER` with `search_path = ''`.
- Catalog-update row-count guard applies if any catalog UPDATE is added (CI checks).
- Web: `tests/pricingCards.test.mjs` pin updated per flag state; `tests/topUps` route: consent v1 refused and v2 accepted when on, and v1 accepted when off; `tests/appRuntimeFlags` for `packExpiry`; locale parity test (all 11 files have every new key); `npm run sync:vey-knowledge` clean.
- Mobile: `apps/mobile/__tests__/paywallPrompt.test.tsx`, `creditsScreen.test.tsx`, `pricingScreen.test.tsx` for the expiry line and its absence when the flag is off.
- Store billing: `tests/storeBillingCatalog.test.mjs`, `tests/revenuecatWebhook.test.mjs`: a store pack grants expiring credits and a store refund takes them back first.
- Manual (staging): web purchase with date shown, wait/advance clock, sweep, refund after expiry; iOS and Android sandbox purchase; the store description matches the in-app text.

## 13. Size

About 3 migrations (roughly 900 SQL lines in total), ~60 string keys x 11 languages, 6 to 8 UI files, 1 acceptance suite plus web/mobile tests. Estimate 5 to 8 working days for build and tests, plus legal and store lead time that the code does not control. Option B (lots) adds about 3 days.
