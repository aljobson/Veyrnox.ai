# ADR-0108 — Mobile billing: in-app purchase for Credit Packs

**Status:** Proposed 2026-10-17
**Related:** [ADR-0106](0106-mobile-app.md) (slice M3), [ADR-0031](0031-stripe-replaces-lemonsqueezy.md), CLAUDE.md "Money & billing", "Provider webhooks", "Database"

## Context

The web sells Credit Packs through Stripe Checkout (`/api/v1/top-ups`, verified webhook `/api/webhook/stripe`, `credit_top_up`, `apply_top_up_refund`). Inside an iOS or Android app, credits are digital goods consumed in the app, so Apple and Google require their own in-app purchase. Stripe checkout cannot be used there.

The schema already expects more than one channel: `credit_packs.sales_channel` is checked `IN ('web')`, and the price floor is written against the web fee.

## Decision

1. **Consumable Credit Packs only.** One purchase, one grant, through the store's own purchase sheet. Subscriptions (ADR-0064) are out of scope. Web purchases keep working and credits are one balance on every surface.
2. **RevenueCat is the store integration; the server never trusts the client or the webhook body.** The app uses the RevenueCat SDK to start purchases. Our server grants credits only after fetching the transaction from RevenueCat's REST API with our secret key (the same re-fetch pattern as the Stripe session). Their webhook has no signature, only a shared header, so it is a trigger, never evidence. Rejected alternative: verifying Apple's signed notifications and Google's Pub/Sub notifications ourselves. It meets the signature rule directly but means two certificate-chain and service-account implementations on the Worker, where `jose` is banned, for a first release. Revisit if RevenueCat's fee or availability becomes a problem.
3. **A purchase is bound to its buyer by the store, not by a client-set id.** RevenueCat's `app_user_id` is chosen by the app, so on its own anyone could buy under someone else's id and later refund it to claw credits back from that person. Each purchase therefore carries a store-native account token derived server-side from the Supabase auth id (Apple `appAccountToken`, Google `obfuscatedExternalAccountId`). The sync step credits a transaction only when its token matches the authenticated caller.
4. **Grants reuse the existing money spine.** New migration: `credit_packs.sales_channel` allows `'ios'` and `'android'` with a store product id column, and the sticker-floor check is rewritten per channel for the store fee (30%, or 15% under the Small Business Program, plus tax rules). A verified store transaction creates a `top_ups` row keyed by `store:<transaction_id>` and goes through `credit_top_up` (idempotent, append-only ledger, free-credit bookkeeping unchanged). Never a raw ledger insert. The Supply Consent wording stays; the store sheet shows the price.
5. **Sync paths.** `POST /api/v1/store-purchases/sync` (Bearer, no client-supplied amounts) pulls the caller's transactions from RevenueCat and grants any new ones. `POST /api/webhook/revenuecat` (shared-header check, then the same sync for the named subscriber, re-fetching first) covers purchases finished while the app was closed. Both are replay-safe because the grant is keyed by transaction id. Restore purchases is a button on the account screen.
6. **Refunds.** Apple REFUND and Google voided-purchase events go through the same clawback rules as `apply_top_up_refund` (capped at `balance - free_balance - subscription_balance`, an account-action log entry, and the frozen-account rules from CLAUDE.md). Apple CONSUMPTION_REQUEST must be answered inside its window; the answer is built from the ledger (how much of the pack is spent).
7. **No steering.** The app does not mention, link to or price-compare the web store. Whether a US or EU link-out is allowed and worth it is a legal and commercial decision for the owner, and the default here is none.
8. **Rollout.** Server flag `STORE_BILLING_ENABLED` ships `"false"`. Purchases run in the store sandbox first. `reconcile_top_ups()` must return zero rows with store rows included before the flag turns on in production.

## Risks that this repo cannot see

- **Store review of an AI generation app.** Apple 1.2 (user-generated content: filtering, reporting, blocking) and Google's AI-generated-content policy need in-app reporting and moderation. The web already has reports and an AUP; the app must expose them before review. LemonSqueezy refused us on AI media (ADR-0031); Apple and Google can too, and only review will say. Submit an early TestFlight external review before building the sync and refund code.
- **Margin.** A store pack at the same price nets 15 to 30% less than web. Prices or credit counts per store pack must be set so the floor holds; this is a pricing decision.
- **Three-way drift** between store, RevenueCat and our ledger. The reconcile job needs a store-side check (transactions without a grant, grants without a transaction).

## Owner prerequisites

Apple Developer Program with the Paid Apps agreement, tax and banking; Google Play Console merchant account; Small Business Program enrolment; a RevenueCat project with iOS and Android apps and a webhook header secret (`wrangler secret put`); product ids and price points for each pack; the decision in point 7.

## Verification

None yet. Plan: store sandbox purchases, a refund, a replay of the same transaction (no second grant), a purchase under a mismatched account token (refused), and `reconcile_top_ups()` after each.
