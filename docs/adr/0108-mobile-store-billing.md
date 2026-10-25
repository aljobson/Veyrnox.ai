# ADR-0108 — Mobile billing: in-app purchase for Credit Packs

**Status:** Proposed 2026-10-17
**Related:** [ADR-0106](0106-mobile-app.md) (slice M3), [ADR-0031](0031-stripe-replaces-lemonsqueezy.md), CLAUDE.md "Money & billing", "Provider webhooks", "Database"

## Context

The web sells Credit Packs through Stripe Checkout (`/api/v1/top-ups`, verified webhook `/api/webhook/stripe`, `credit_top_up`, `apply_top_up_refund`). Inside an iOS or Android app, credits are digital goods consumed in the app, so Apple and Google require their own in-app purchase. Stripe checkout cannot be used there.

The schema already expects more than one channel: `credit_packs.sales_channel` is checked `IN ('web')`, and the price floor is written against the web fee.

## Decision

1. **Consumable Credit Packs only.** One purchase, one grant, through the store's own purchase sheet. Subscriptions (ADR-0064) are out of scope. Web purchases keep working and credits are one balance on every surface.
2. **RevenueCat is the store integration, and its signed webhook is the evidence.** The app uses the RevenueCat SDK to start purchases. RevenueCat signs every webhook delivery (HMAC-SHA256 over `<t>.<raw body>`, `X-RevenueCat-Webhook-Signature`, 5 minute tolerance, checked with Web Crypto before the body is parsed), which meets the signature rule in CLAUDE.md. *Amended 2026-10-17 after reading RevenueCat's docs: the first draft said the webhook had only a shared header and planned a re-fetch of the transaction. The docs show HMAC signing, and their v1 customer endpoint does not list a store transaction id or a refund state for one-time purchases, so a re-fetch would add nothing we can verify.* Only `NON_RENEWING_PURCHASE` and `CANCELLATION` are acted on. Rejected alternative: verifying Apple's signed notifications and Google's Pub/Sub notifications ourselves (two certificate-chain and service-account implementations on the Worker, where `jose` is banned).
3. **A purchase is bound to its buyer by a secret customer id, not by a client-set one.** RevenueCat's `app_user_id` is chosen by the app, so using the Supabase id would let anyone buy under someone else's id and later refund it to claw credits back from them (or Freeze them on a shortfall). Each account instead gets a random UUID (`store_customers`, migration 0344) returned only to that signed-in caller by `GET /api/v1/store-purchases/customer`; the app passes it to RevenueCat's `logIn`. An event can only name an account whose secret the buyer already holds. *Amended 2026-10-17: this replaces the earlier plan to use Apple `appAccountToken` and Google `obfuscatedExternalAccountId`, which RevenueCat's docs do not expose.*
4. **Grants reuse the existing money spine.** New migration: `credit_packs.sales_channel` allows `'ios'` and `'android'` with a store product id column, and the sticker-floor check is rewritten per channel for the store fee (30%, or 15% under the Small Business Program, plus tax rules). A verified store transaction creates a `top_ups` row keyed by `store:<transaction_id>` and goes through `credit_top_up` (idempotent, append-only ledger, free-credit bookkeeping unchanged). Never a raw ledger insert. The Supply Consent wording stays; the store sheet shows the price.
5. **One path in.** `POST /api/webhook/revenuecat` is the only thing that credits: signature, then event-id dedupe in `webhook_events`, then `credit_store_purchase` keyed by the store transaction. RevenueCat retries a failed delivery for about 80 minutes; beyond that the RevenueCat dashboard's Retry button, or an operator replay, is the recovery. The app shows the new balance by reading `/api/v1/balance` after the purchase sheet closes. Restore purchases is a button on the account screen.
6. **Refunds.** Apple REFUND and Google voided-purchase events go through the same clawback rules as `apply_top_up_refund` (capped at `balance - free_balance - subscription_balance`, an account-action log entry, and the frozen-account rules from CLAUDE.md). Apple CONSUMPTION_REQUEST must be answered inside its window; the answer is built from the ledger (how much of the pack is spent).
7. **No steering.** The app does not mention, link to or price-compare the web store. Whether a US or EU link-out is allowed and worth it is a legal and commercial decision for the owner, and the default here is none.
8. **Rollout.** Server flag `STORE_BILLING_ENABLED` is off when unset: production vars are at the 77-var Cloudflare binding cap, so the flag is not added to `wrangler.jsonc` until something else is consolidated (staging sets it). Turning it on in production needs that slot, migration 0344 applied and the `REVENUECAT_WEBHOOK_SECRET` secret (one more binding). Sandbox purchases are free test purchases, so production ignores them; only staging sets `STORE_BILLING_ALLOW_SANDBOX`. Purchases run in the store sandbox first. `reconcile_top_ups()` must return zero rows with store rows included before the flag turns on in production.

## Risks that this repo cannot see

- **Store review of an AI generation app.** Apple 1.2 (user-generated content: filtering, reporting, blocking) and Google's AI-generated-content policy need in-app reporting and moderation. The web already has reports and an AUP; the app must expose them before review. LemonSqueezy refused us on AI media (ADR-0031); Apple and Google can too, and only review will say. Submit an early TestFlight external review before building the sync and refund code.
- **Margin.** A store pack at the same price nets 15 to 30% less than web. Prices or credit counts per store pack must be set so the floor holds; this is a pricing decision.
- **Three-way drift** between store, RevenueCat and our ledger. The reconcile job needs a store-side check (transactions without a grant, grants without a transaction).

## Owner prerequisites

Apple Developer Program with the Paid Apps agreement, tax and banking; Google Play Console merchant account; Small Business Program enrolment; a RevenueCat project with iOS and Android apps and a webhook header secret (`wrangler secret put`); product ids and price points for each pack; the decision in point 7.

## Verification

Done 2026-10-17 on a local Postgres replayed from every migration: 14 acceptance tests for migration 0344 (credit once, replay, concurrent deliveries, a transaction claimed by a second account, unknown or malformed customer ids, retired packs, full refund and replay, pack shape and fee floor, web checkout unchanged, grants, `reconcile_balances` and `reconcile_top_ups` empty); 12 unit tests for the signature, the event parser and both routes.

**Not verified, needs the store sandboxes:** RevenueCat's exact `store` spelling (`APP_STORE` and `PLAY_STORE` are assumed and an unknown value is ignored, not credited), that a refunded one-time purchase arrives as `CANCELLATION` with the same `transaction_id` as the purchase, and the app side (RevenueCat SDK, purchase sheet). None of it is live while the flag is false.

## Amendment 1 (2026-10-25): the mobile offer follows the live web catalog without a hard gate

The production app does not require a paid plan merely to enter after sign-up. Free Credits remain usable. The app instead mirrors the website's dismissible prompt: once for a new account in its first seven days, once per sign-in below 10 Credits, and once per zero-balance cycle. It does not open on Welcome or the Credits screen, and a store or network failure never blocks the app.

The Credits screen is the single store-billing destination. It shows the four AI Generation families from migration 0393 in monthly and yearly forms, with the localized store price, period, renewal and cancellation terms, subscription-Credit expiry, Restore, Terms and Privacy. An active Generation entitlement from either the store or the web suppresses another purchase. There is still no web checkout link or web/store price comparison.

Migration 0394 makes the active iOS and Android consumable catalog match the deployed web pack sizes: 100, 300 and 1,000 Credits. The USD ledger rows use the nearest ordinary store price points ($9.99, $24.99 and $74.99) to the web's $10, $25 and $75. Old store rows are deactivated, not deleted, so delayed RevenueCat purchases and refunds continue to resolve. It also maps the exact Google Play subscription identifiers RevenueCat sends (`productId:basePlanId`) for every Generation and Publish cadence; the base-plan id matches the cadence. The App Store, Play Console and RevenueCat products remain owner setup and must be proved with a signed sandbox build before submission.
