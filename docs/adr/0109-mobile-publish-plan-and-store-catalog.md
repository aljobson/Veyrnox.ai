# ADR-0109 — Mobile: Publish Plan subscriptions and the RevenueCat catalog

**Status:** Proposed 2026-10-17
**Related:** [ADR-0108](0108-mobile-store-billing.md) (consumable packs; this extends it to subscriptions), [ADR-0063](0063-veyrnox-publish-plan-pricing.md) (plan numbers), [ADR-0062](0062-veyrnox-publish-entitlement-model.md) (entitlement model), migrations 0293, 0298, 0341, 0344

## Context

ADR-0108 deliberately left subscriptions out. The Publish Plan (weekly $4.99, monthly $15, annual $126; five accounts, scheduling, 366-day analytics, best-time) is a digital service consumed in the app, so Apple and Google require their own in-app purchase for it inside the apps, as for credits. The web keeps Stripe.

## Decisions

1. **Store prices mirror the web at ordinary price points:** weekly $4.99, monthly **$14.99**, annual **$124.99** (30.5% off twelve months). The store keeps 30% in year one on Apple and 15% on Google and after year one; Publish has small per-user costs, so parity is accepted. A store uplift is an owner option, not a default.
2. **RevenueCat catalog.** Project `proj36a3504f` ("Veyrnox.ai", separate from the wallet project, which is not touched). Apps: iOS (`ai.veyrnox.app`), Android (`ai.veyrnox.app`) and the Test Store. Entitlement `publish`. Offering `credits` (packages `$rc_custom_credits_100/270/1200/3000`) and offering `publish` (`$rc_weekly`, `$rc_monthly`, `$rc_annual`). Product ids: `ai.veyrnox.credits.100|270|1200|3000` (consumable, $9.99 / $19.99 / $59.99 / $149.99) and `ai.veyrnox.publish.weekly|monthly|annual` (subscription). This records the Test Store snapshot created on 2026-10-17; ADR-0108 amendment 1 and migration 0394 supersede its pack offering for launch with 100/300/1,000 Credits. The iOS and Android products still wait for the store listings and credentials.
3. **Subscription events map onto the existing Publish lifecycle, never onto the ledger.** The webhook (ADR-0108) also handles `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `CANCELLATION` (auto-renew off: `cancel_at_period_end`), `EXPIRATION` (end, `subscription_ended`), `BILLING_ISSUE` (`past_due`) and refund (`refunded`). A migration adds a store source to `social_publish_subscriptions` (channel and the store's original transaction id, unique) and a SECURITY DEFINER function that calls the same transitions as `apply_social_publish_subscription_event`. The buyer is the secret RevenueCat customer id of 0344, so the payload names no account.
4. **One active source per account.** A store subscription is refused while a Stripe one is active, and the reverse. The app says which source the plan is on and where to manage it (the store's settings), and never links to the web.
5. **Paywall.** A RevenueCat paywall on the `publish` offering, shown where a free user hits a Publish limit. It must show the price, the period, the auto-renew and cancellation terms, Restore purchases and links to the terms and privacy policy, which both stores check. Copy and art are ours; the structure may follow common practice.
6. **Rollout.** Same flag as ADR-0108 (`STORE_BILLING_ENABLED`, off when unset) plus the existing `PUBLISH_ENABLED`. Sandbox events are ignored in production. Nothing is live until the store listings, the webhook secret and a free production variable slot exist.

## Not decided here

Introductory offers or trials; a store price uplift; family sharing; regional pricing; the iOS and Android store listings and credentials.

## Verification

Catalog created and read back in RevenueCat on 2026-10-17.

**Built 2026-10-17 (migration 0346, behind `STORE_BILLING_ENABLED`):** `social_publish_subscriptions` gains the store's identity (channel and original transaction id, unique); `social_publish_store_products` maps product ids to plans (iOS seeded; Android waits for the Play listings); `apply_store_publish_event` applies `activate`, `cancel_at_period_end`, `past_due`, `expire` and `refund` for the account that owns the secret customer id. Event ids are idempotent, an older event than the last one changes nothing, a newer activation reopens an ended row (the store keeps one original transaction id across a re-subscription), and a second live plan is flagged, never entitled. The existing entitlement read, one-live index and web "already active" refusal work unchanged, and the credit ledger is never touched. The webhook maps `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `UNCANCELLATION` to activate, `CANCELLATION` to cancel-at-period-end (or refund when `cancel_reason` is `CUSTOMER_SUPPORT`), `BILLING_ISSUE` to past-due and `EXPIRATION` to expire; a `CANCELLATION` of a credit pack is still a pack refund.

Tested on local Postgres: 11 acceptance tests for 0346 (fresh base schema twice, a full replay, and with every acceptance suite sharing one database as CI does) and 18 webhook tests.

**Not verified, needs the store sandboxes:** that `PRODUCT_CHANGE` carries the new product in `new_product_id` (otherwise the plan does not change), that `cancel_reason` is `CUSTOMER_SUPPORT` for a refund and anything else for "will not renew", that `expiration_at_ms` and `original_transaction_id` are present as read from the docs, the Play product id format (`productId:basePlanId`), and the app side checking the server entitlement before showing the paywall. A store purchase made while a web plan is live is flagged: the person is charged by the store and not entitled until an operator refunds it, so the app must check first.

**Catalog amendment 2026-10-25:** migration 0394 maps the Play identifiers explicitly: each product uses a base-plan id equal to its cadence (`weekly`, `monthly` or `annual`), and RevenueCat sends the combined `productId:basePlanId`. The app parser accepts only matching product/base-plan cadence pairs. This convention is implemented and unit-tested but still needs a signed Play internal-testing purchase and webhook before it is operationally verified.

## Amendment 1 (2026-10-19): the plan says where it is managed

`GET /api/v1/social/plan` gains `entitlement.subscription.source`: `'stripe'` (bought on the web), `'store'` (bought in the iOS or Android app) or `null` (no live plan, so Free). Additive; every existing field and the web page are unchanged, and the web client ignores it.

- **Derived, no migration.** A live plan (`active` or `past_due`) is `'stripe'` when the entitlement read returns a Stripe subscription id, otherwise `'store'`: a Stripe plan always has the id (the cancel and portal routes already rely on it) and 0346 writes the store identity instead. Pending, ended and flagged rows are `null`. The channel (`ios` or `android`) is not exposed; the app already knows which store it runs on, and a store subscriber on the other platform is told to manage it in that store.
- **Which wins.** The one-live index allows one live row per account and the read returns it first, so a store plan and a Stripe plan cannot both show. The second purchase is a `flagged` row and reads `null`.
- **Double billing is not visible here.** The person is charged by both and entitled once; the flagged row is not in this response. The app must call this endpoint before showing its paywall (ADR-0109 decision 5), and an operator refund is the fix. Surfacing a flagged row to the app needs a new field from the RPC and is not done.
- **Mobile reads** `subscription.source`: `'stripe'` -> "Manage on the web" (no in-app link to Stripe); `'store'` -> the store's subscription settings; `null` -> offer the paywall. Never a customer id, receipt or token.

