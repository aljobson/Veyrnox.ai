# ADR-0109 — Mobile: Publish Plan subscriptions and the RevenueCat catalog

**Status:** Proposed 2026-10-17
**Related:** [ADR-0108](0108-mobile-store-billing.md) (consumable packs; this extends it to subscriptions), [ADR-0063](0063-veyrnox-publish-plan-pricing.md) (plan numbers), [ADR-0062](0062-veyrnox-publish-entitlement-model.md) (entitlement model), migrations 0293, 0298, 0341, 0344

## Context

ADR-0108 deliberately left subscriptions out. The Publish Plan (weekly $4.99, monthly $15, annual $126; five accounts, scheduling, 366-day analytics, best-time) is a digital service consumed in the app, so Apple and Google require their own in-app purchase for it inside the apps, as for credits. The web keeps Stripe.

## Decisions

1. **Store prices mirror the web at ordinary price points:** weekly $4.99, monthly **$14.99**, annual **$124.99** (30.5% off twelve months). The store keeps 30% in year one on Apple and 15% on Google and after year one; Publish has small per-user costs, so parity is accepted. A store uplift is an owner option, not a default.
2. **RevenueCat catalog.** Project `proj36a3504f` ("Veyrnox.ai", separate from the wallet project, which is not touched). Apps: iOS (`ai.veyrnox.app`), Android (`ai.veyrnox.app`) and the Test Store. Entitlement `publish`. Offering `credits` (current; packages `$rc_custom_credits_100/270/1200/3000`) and offering `publish` (`$rc_weekly`, `$rc_monthly`, `$rc_annual`). Product ids: `ai.veyrnox.credits.100|270|1200|3000` (consumable, $9.99 / $19.99 / $59.99 / $149.99) and `ai.veyrnox.publish.weekly|monthly|annual` (subscription). Created on the Test Store only on 2026-10-17; the iOS and Android products wait for the store listings and credentials.
3. **Subscription events map onto the existing Publish lifecycle, never onto the ledger.** The webhook (ADR-0108) also handles `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `CANCELLATION` (auto-renew off: `cancel_at_period_end`), `EXPIRATION` (end, `subscription_ended`), `BILLING_ISSUE` (`past_due`) and refund (`refunded`). A migration adds a store source to `social_publish_subscriptions` (channel and the store's original transaction id, unique) and a SECURITY DEFINER function that calls the same transitions as `apply_social_publish_subscription_event`. The buyer is the secret RevenueCat customer id of 0344, so the payload names no account.
4. **One active source per account.** A store subscription is refused while a Stripe one is active, and the reverse. The app says which source the plan is on and where to manage it (the store's settings), and never links to the web.
5. **Paywall.** A RevenueCat paywall on the `publish` offering, shown where a free user hits a Publish limit. It must show the price, the period, the auto-renew and cancellation terms, Restore purchases and links to the terms and privacy policy, which both stores check. Copy and art are ours; the structure may follow common practice.
6. **Rollout.** Same flag as ADR-0108 (`STORE_BILLING_ENABLED`, off when unset) plus the existing `PUBLISH_ENABLED`. Sandbox events are ignored in production. Nothing is live until the store listings, the webhook secret and a free production variable slot exist.

## Not decided here

Introductory offers or trials; a store price uplift; family sharing; regional pricing; the iOS and Android store listings and credentials.

## Verification

Catalog created and read back in RevenueCat on 2026-10-17. Migration, webhook mapping and the paywall are unbuilt and unverified.
