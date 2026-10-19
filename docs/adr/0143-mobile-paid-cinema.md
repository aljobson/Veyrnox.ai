# ADR-0143 — Mobile: paid Cinema through in-app purchase (M12)

**Status:** Accepted with open checks, 2026-10-19 (all owner answers recorded below; the in-store setup has not been started). **Docs only: no code, no flag, no migration.**
**Related:** [ADR-0057](0057-cinema-viewer-paywall.md) (Pass, unlocks, and its "Proposed: $9.99 monthly Pass only" amendment), [ADR-0064](0064-core-subscriptions.md) (credit subscriptions), [ADR-0108](0108-mobile-store-billing.md) (store billing, credit packs), [ADR-0109](0109-mobile-publish-plan-and-store-catalog.md) (store subscriptions for Publish, the pattern this follows), [ADR-0106](0106-mobile-app.md), `docs/mobile/ROADMAP-2026-10-17.md` (decision 4, M12), `docs/mobile/RESEARCH-competitors-2026-10-17.md`

## Questions for the owner

Each had a recommendation. The owner's answers are recorded in the next section; the rest of this ADR assumes them. Nothing below is built.

1. **Is the web Pass amendment accepted?** ADR-0057's "$9.99 monthly Pass only, 1,500-minute ceiling, 30% creator share" is still **Proposed**. The mobile Pass should copy whatever the web decides. *Recommendation: accept it first; this ADR assumes it.*
2. **Store price for the Pass: parity or uplift?** The store keeps 30% (15% under the Small Business Program or after year one on subscriptions; ADR-0108 and ADR-0109). With the ADR-0057 cost model, a Pass at the 1,500-minute ceiling leaves about **$3.43** on web, **$1.89** through the store at 30%, **$2.94** at 15%. Holding $3.43 would need about **$12.99** (30%) or **$10.99** (15%). The web price cannot be linked to (roadmap decision 4), so a lower web price is invisible in the app. *Recommendation: launch at parity, $9.99, because the ceiling binds only heavy viewers; revisit with real minutes data. An uplift is your call, not a default.*
3. **Do per-title unlocks need their own store products?** *Recommendation: no.* An unlock is a spend of 6 credits (`unlock_cinema_content`), and credits are bought through the existing consumable packs (ADR-0108). That is the virtual-currency model the stores accept, it needs no new SKU, and it keeps one balance on every surface. It does mean credits bought on the web are spendable on the phone; please confirm that is acceptable to you and to Apple's multiplatform-service rule (3.1.3(b), not verified here).
4. **Weekly and yearly Passes in the store?** The web amendment withdrew both. ReelShort sells a weekly pass in the store. *Recommendation: monthly only, matching web.*
5. **Credit subscriptions (starter, plus, ultra) in the store?** They are not on sale anywhere in production (`SUBSCRIPTIONS_ENABLED` is false). *Recommendation: not in M12; decide when the web ones launch.*
6. **Introductory offers or a free trial in the store?** Web has none after the weekly plan was withdrawn. *Recommendation: none.*
7. **Creator share on store revenue.** The 30% was modelled on web revenue after payment fees. For a store Pass the base is revenue after the store's commission. This belongs to the separate creator-payout ADR that ADR-0057 decision 6 requires; this ADR only records Pass revenue per channel so that decision can be made. *Please confirm that base.*
8. **Withdrawal and refunds.** ADR-0057 promises a pro-rata refund within 14 days (UK and EU cooling-off). On a store purchase the **store** takes the refund and the right of withdrawal, not us. *Please confirm with Finance or Legal that the in-app wording defers to the store's policy.*
9. **Owner accounts (not visible from the repo):** the in-app products (O4) created in App Store Connect and, later, Play Console; the Paid Apps agreement's tax and banking state; the RevenueCat iOS key (O5); Small Business Program enrolment; and a free production variable slot, since production vars are at the 77 cap (ADR-0108 point 8). *The Apple agreement is recorded as accepted on 2026-10-18; this ADR does not list it again.*

## Owner answers (2026-10-19)

The owner's replies, quoted as relayed in chat, and what each means here. Rows marked **accepted** are the owner's decisions.

| # | Owner's words | State | What it means |
|---|---|---|---|
| 1 | "accept web terms" | **Accepted by owner** | The mobile Pass uses the web terms: $9.99 monthly, 1,500-minute ceiling, 30% creator share (ADR-0057 amendment). |
| 2 | "I am not sure if this is for AI generation or cinema pass" | **Accepted by owner, 2026-10-19: parity** | Parity at $9.99 applies to the **Cinema Pass only**. AI generation keeps the credit packs and Publish keeps its own plan; both are unchanged by this ADR. |
| 3 | "agreed" | **Accepted by owner** | Unlocks are 6-credit spends with no new SKU, and credits are shared across web and phone. **Check still open:** that Apple's multiplatform-service rule (3.1.3(b)) allows spending web-bought credits in the app has not been verified (see the unproven table). |
| 4 | "agree" | **Accepted by owner** | Monthly Pass only in the store. |
| 5 | "agree" | **Accepted by owner** | No credit subscriptions in M12. |
| 6 | "which store (Cinema / AI generation / Publish)??" then "No" | **Accepted by owner, 2026-10-19: no offer** | No introductory offer or free trial, for the **Cinema Pass only** (it says nothing about the other two). |
| 7 | "confirm" | **Accepted by owner** | The creator share is taken on store revenue after the store's commission. The final rule belongs to the separate creator-payout ADR. |
| 8 | "give guidance here", then "correct" | **Accepted by owner, 2026-10-19** | See the refund guidance below. EU and UK withdrawal wording still needs Legal sign-off. |
| 9 | "nothing is stitched yet" | Not started | See the owner checklist below. |

### Refund and withdrawal guidance (question 8, accepted)

- **Store purchases defer to the store's own refund policy.** On Apple that is `reportaproblem.apple.com`; on Google Play it is Play's own refund flow. The app does not process, promise or describe its own refund for a store purchase.
- **The 14-day pro-rata refund promise stays web-only** (ADR-0057). It is not shown anywhere in the phone app.
- **EU and UK right-of-withdrawal wording for a store purchase: needs Legal sign-off.** This ADR does not decide it. The in-app text stays minimal (price, period, renewal and cancellation terms, "manage or request a refund through your Apple ID or Google Play") until Legal has signed off.

### Owner checklist, in order

None of this is visible from the repo and **nothing has been set up yet**. Each step blocks the next.

1. Check the **Paid Apps agreement's** tax and banking state in App Store Connect (the developer agreement itself is recorded as accepted on 2026-10-18; paid products also need tax and banking complete).
2. **Create the Cinema Pass subscription** in App Store Connect: product `ai.veyrnox.cinema.pass.monthly`, its own subscription group, $9.99, auto-renewing monthly, no introductory offer.
3. In **RevenueCat**, add the iOS key (O5), the entitlement `cinema_pass`, and an offering `cinema` with a `$rc_monthly` package pointing at that product.
4. Enrol in the **Small Business Program** (15% instead of 30%; changes the margin in question 2).
5. Free a **production variable slot** (production vars are at the 77 cap) and set the RevenueCat webhook secret in production, before any production flag is turned on.
6. **Play Console later**: create the app, the subscription and its base plan, then the Play product id in the `productId:basePlanId` form.

## Context

- **Web today (ADR-0057).** A Cinema Pass is a Stripe subscription whose entitlement is derived on the server (`cinema_passes`, `read_own_cinema_pass`, `cinema_pass_month_seconds`); it **never touches the ledger**. An episode unlock is 6 credits through `unlock_cinema_content` and a ledger row. Both are behind `CINEMA_SUBSCRIPTIONS_ENABLED` and `CINEMA_UNLOCKS_ENABLED`, which are **false in production and true on staging**.
- **Store billing today (ADR-0108, ADR-0109).** `POST /api/webhook/revenuecat` is the single way in for credit packs (`credit_store_purchase`) and for the Publish Plan (`apply_store_publish_event`), bound to the buyer by a secret per-account customer id (`store_customers`), deduped in `webhook_events`, sandbox events ignored in production. Migrations 0344 and 0346 are applied; `STORE_BILLING_ENABLED` is true on staging only.
- **Rules (from the research file).** Apple 3.1.1 requires in-app purchase for digital content unlocked in the app; roadmap decision 4 is **no web link-out and no web price mention**. Subscriptions must show price, period, auto-renew and cancellation terms, Restore purchases, and links to Terms and Privacy (ADR-0109 point 5). A competitor, ReelShort, sells exactly this shape in the store: weekly passes plus consumable coins.

## Decision

### 1. Which products map to store SKUs

| Product | In the store? | How |
|---|---|---|
| **Cinema Pass, monthly** | **Yes**, one auto-renewing subscription | Product `ai.veyrnox.cinema.pass.monthly` (iOS; Android id after the Play listing, in the `productId:basePlanId` form), own subscription group, RevenueCat entitlement `cinema_pass`, offering `cinema` with package `$rc_monthly`. Price $9.99 (question 2). |
| Cinema Pass, weekly and yearly | No | Withdrawn on web; same here (question 4). |
| **Episode unlock** | **No SKU** | 6 credits through the existing `POST /api/v1/cinema/unlocks`; credits come from the existing packs (question 3). |
| Credit packs | Unchanged | ADR-0108. |
| Credit subscriptions | **Not in M12** | Question 5. |

### 2. How a store purchase becomes a Pass on the server

Same webhook, same evidence (RevenueCat's signed event), same secret customer id. New server work, in the next free migration number (checked against main and open PRs when written):

1. `cinema_passes` gains the store's identity (channel and the store's original transaction id, unique), the way `social_publish_subscriptions` did in 0346. A store row uses the key `store:<original_transaction_id>` for the existing idempotency column. `cinema_passes` already has a `flagged` status for a duplicate Pass (ADR-0057's operator refund). A **store Pass is refused or flagged while a Stripe Pass is active, and the reverse** (ADR-0109 point 4; the exact guard is to be written and tested in the migration, not assumed), and the app says which source the Pass is on, in words and without a link.
2. A new `SECURITY DEFINER` function (`SET search_path = ''`, revoked from `PUBLIC`, `anon`, `authenticated`, granted to `service_role`, schema-qualified) `apply_store_cinema_pass_event`, mirroring `apply_store_publish_event` and the transitions of `apply_cinema_pass_event`: `INITIAL_PURCHASE` and `RENEWAL` activate and set the period end; `CANCELLATION` for "will not renew" sets cancel-at-period-end; `BILLING_ISSUE` marks past due; `EXPIRATION` ends with `subscription_ended`; a refund ends the Pass at once with `refunded` (and a store dispute path if the store reports one). Product ids map to plans through a small product table, as in 0346.
3. **Idempotency and ordering.** The webhook dedupes on the event id (`webhook_events`, source `billing:revenuecat`); the store's original transaction id is unique; an event older than the row's `last_event_at` changes nothing; an out-of-order or incomplete event follows the ADR-0057 ordering repair (0263). A replay is a no-op.
4. **No ledger writes, no clawback.** A Pass moves no credits, so a refund only ends the entitlement; `reconcile_balances()` and `reconcile_free_credits()` are unaffected. **Credits spent on unlocks are final** (ADR-0057 decision 5). If a credit **pack** is later refunded after its credits were spent on unlocks, the existing ADR-0108 point 6 rules apply unchanged (clawback capped at the Pack bucket, a shortfall handled as today, Freeze on abuse).
5. **The entitlement stays server-side.** Playback tokens are minted only for an entitled viewer (existing); the 1,500-minute ceiling and the Pass-play accounting apply to store Passes unchanged. The app **never treats the store SDK's customer info as the entitlement**: after a purchase it reads `GET /api/v1/cinema/entitlement`.
6. Flags: `STORE_BILLING_ENABLED` and `CINEMA_SUBSCRIPTIONS_ENABLED` must both be on; sandbox events are ignored in production (`STORE_BILLING_ALLOW_SANDBOX` is staging only). No new flag.

### 3. What the app shows

- **Before purchase.** A locked episode shows "Unlock for 6 credits" and, where a Pass is on offer, "Watch with Cinema Pass". The Pass screen shows the price, the period, auto-renew and how to cancel ("manage it in your Apple ID or Google Play subscriptions"), **Restore purchases**, and Terms and Privacy. It states the fair-use ceiling plainly ("up to 1,500 minutes a month"), not "unlimited", so the claim is true. It never mentions, links to or compares with the web store (decision 4). If credits are short, it goes to the existing Credits screen.
- **If the Pass is already active elsewhere** (web): "Your Cinema Pass is active. Manage it where you bought it." No link.
- **After purchase.** The store sheet closes; the app polls the server entitlement for up to about a minute and shows "Cinema Pass active until <date>". If the webhook is late it says the purchase is processing and will appear shortly (RevenueCat retries for about 80 minutes; ADR-0108), and offers Restore. An unlock answers at once and the balance refreshes.
- **Refunds.** The app makes no refund promise for a store purchase and defers to the store (see the refund guidance above, pending the owner). The 14-day pro-rata promise is web-only.
- **Restore purchases.** The Account button already exists. Restore re-binds through the secret customer id (`GET /api/v1/store-purchases/customer`); the server entitlement is what the app reads afterwards. A refund or an expiry is shown as "Your Pass ended on <date>".

### 4. Not proved, and what each needs

| Unproven | Needs |
|---|---|
| That a store purchase reaches `cinema_passes` and unlocks playback | The new migration and function on staging, a RevenueCat project with the Cinema product, sandbox accounts |
| RevenueCat event details for subscriptions: `PRODUCT_CHANGE` carrying `new_product_id`, the `cancel_reason` that marks a refund, `expiration_at_ms`, `original_transaction_id`, the exact store spellings (already listed as unverified in ADR-0108 and ADR-0109) | Sandbox runs on both stores |
| The Play product id and base plan form | The Play listing and a Play Console app |
| The in-app products themselves (O4) | The owner, in App Store Connect and Play Console |
| Apple review of a subscription for user-uploaded video | A TestFlight external review; the 1.2 items (report, block, age gate, contact) are already built |
| Production enablement | A free production variable slot (cap 77) and the webhook secret in production |
| The real margin | Stripe's and the store's real fee schedule (ADR-0057 notes the Stripe Managed Payments fee was not read), and real minutes viewed |
| That spending **web-bought credits** on the phone is allowed under Apple's multiplatform-service rule (3.1.3(b)) | Reading the current App Review Guidelines text and, if unclear, a question to App Review at TestFlight |
| Legal wording for EU and UK withdrawal rights on a store purchase | Legal sign-off |
| Android | A Play listing and a device |

### 5. Build order

Each step is its own PR, mock or Test Store first, and nothing is switched on in production.

1. **Owner:** the checklist above (agreement state, the subscription product, the RevenueCat key, entitlement and offering, Small Business Program, a production slot); Legal sign-off on EU and UK withdrawal wording.
2. **Server:** the migration and `apply_store_cinema_pass_event`, the webhook mapping, the product table seeded for iOS, and acceptance tests on local Postgres in the pattern of 0346 (fresh schema, replay, out-of-order, duplicate source, refund, `reconcile_*` empty). Staging only.
3. **App, read side:** entitlement and locked-title states, and unlock with credits, against the existing routes (works on staging today, no store involved).
4. **App, Pass:** the Pass screen and purchase through the RevenueCat SDK on the Test Store, then the sandbox; polling and the "processing" state.
5. **App, restore, manage and ended states**, translations keys, accessibility pass.
6. **Sandbox end to end on staging**, then TestFlight review, then (owner) the production slot and flags.

## Consequences

- No new money path: the Pass stays off the ledger and credits stay the only currency (ADR-0057 decision 4), so the ledger invariants in CLAUDE.md are untouched.
- Store and Stripe Passes can never both be active on one account; the support runbook for "charged twice" (a store purchase while a web Pass is live) needs the same operator-refund note as ADR-0109.
- A store Pass nets 15 to 30% less than web; the price decision (question 2) is the owner's.

## Verification

None: this is a proposal. It was written from ADR-0057, ADR-0108, ADR-0109, migrations 0143, 0186 and 0346 and `app/api/webhook/revenuecat/route.js` as read on 2026-10-19, and from the research file. The margin figures are the ADR-0057 cost model (Stream at $1 per 1,000 minutes, about $0.80 payment fees on $9.99, 30% creator share) re-run with the store's fee; they are a model, not a measurement.
