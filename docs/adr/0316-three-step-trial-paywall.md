# ADR-0316: Three-step trial paywall (web and mobile)

Status: proposed 2026-11-01, built behind `SUBSCRIPTION_TRIAL_ENABLED` (staging `"false"`, omitted in production where it means off) on the web and behind the store products on mobile. Nothing is turned on. Builds on [ADR-0314](0314-web-hard-paywall.md) (web gate), [ADR-0108](0108-mobile-store-billing.md) amendment 2 (mobile gate) and [ADR-0313](0313-starter-credits-on-first-subscription.md) amendment 1 (the 10 credits arrive with the trial).

## Context

The owner wants the hard paywall to follow the three-screen free-trial pattern: (1) the trial exists and nothing is due now, (2) a reminder or an easy exit before any charge, (3) the plans, with the same low-commitment wording. The pattern only works if every claim is true, and until now neither the Stripe trial nor a reminder existed.

## Decision

**Web.** With a trial on offer the locked screen is three steps in `HardPaywallSteps.jsx`: trial and credits, reminder, plans (the existing `CreditSubscriptions` panel). With no trial the single screen of ADR-0314 stands, unchanged.

- One switch, `SUBSCRIPTION_TRIAL_ENABLED` (exactly `"true"`), read by `lib/subscriptions/trial.js`. The plans endpoint reports `trial_days` (7 or 0); the paywall, the consent notice and the checkout all follow that one number, so no screen can promise a trial Stripe will not give.
- Checkout sends `subscription_data[trial_period_days]=7` (`packages/adapters/stripeCreditSubscriptions.js`). Stripe still collects a card; nothing is charged until day 8.
- Consent: a trial checkout needs the new version `credit-sub-trial-2026-11-01` (the start route refuses the old versions while a trial is on and returns the one it wants). The trial terms are shown next to the checkbox in all 11 languages: free days, then the price and interval, no payment now, the reminder, cancel before the end to pay nothing. The English binding label of the checkbox is unchanged.
- Reminder: Stripe sends `customer.subscription.trial_will_end` three days before the trial ends. The webhook (now handled for generation plans only) emails the date, the price and the cancel link through Resend, once per subscription (idempotency key `trial-end-<sub>`). A failed send is retried with the event; an unconfigured sender or an unknown address is logged and acknowledged. Email text is English for now (other languages fall back to it).

**Mobile.** The locked screen is three steps only when the chosen store plan carries a free introductory offer (`introPrice.price === 0`, read from RevenueCat); the trial length is the store's. With no store trial the paywall is the single screen it was. Step 2 does not promise a reminder from us: the stores give us no hook for one. It says the person can cancel in their store subscription settings before the trial ends and that nothing is charged until then.

## Owner steps (nothing here is applied)

1. **Stripe**: enable the `customer.subscription.trial_will_end` event on the webhook endpoint (staging first), and confirm Stripe Managed Payments accepts trials on these plans.
2. **Legal**: approve the trial wording and the new consent version; the translated binding text for the checkbox still describes the paid plan only.
3. **Stores**: create a 7-day free-trial introductory offer on the generation subscriptions in App Store Connect and Play Console and attach them in RevenueCat; until then mobile shows the single screen.
4. **Turn on** with ADR-0313's switch, in this order: DB switch `set_starter_credits_on_subscription(true)`, `SUBSCRIPTION_TRIAL_ENABLED` on staging, test a trial end to end (including the reminder email), then production (add the var and raise the binding cap with its own ADR line).
5. **Abuse exposure** is as in ADR-0314: each trial is up to 10 credits, about $0.15 of provider spend, per account.

## Not done

- A reminder for store trials (a scheduled local notification would be the way; it needs notification permission).
- Translating the reminder email and the binding checkbox text.
- Mobile tests and typecheck were not run in this checkout (no installed mobile dependencies); see the build notes.
