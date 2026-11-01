# ADR-0313: Web hard paywall

Status: proposed, built behind `HARD_PAYWALL_ENABLED` (staging `"false"`, omitted in production where it means off: production vars are at the 65 binding cap, `tests/workerBindingBudget.test.mjs`); not turned on. Web counterpart of the mobile gate in [ADR-0108](0108-mobile-store-billing.md) amendment 2. Owner, 2026-11-01: "we giving the first 10 credit but they need to subscribe", on both web and mobile.

## Context

Today a new web account can use the product on free credits and sees only a dismissible Credit Pack prompt (`PaywallPrompt`, ADR-0064). The owner wants nobody to use the signed-in product until they hold a paid plan, with the first 10 credits given when they subscribe.

## Decision

With the request-time server var `HARD_PAYWALL_ENABLED` exactly `"true"`, a signed-in person without a live plan sees the paywall and nothing else in the signed-in app (every route under `/app`). A live plan is either of:

- an AI Generation subscription: `GET /api/v1/subscriptions` returns a `credit_subscriptions` row with status `active` or `past_due` (a store plan bought in the mobile app counts, same table);
- a Publish Plan: `GET /api/v1/social/plan` returns a subscription with the same statuses. A failed or closed (503) Publish read only means no Publish plan.

`pending`, `flagged` and ended rows do not open the gate. Existing signed-in users meet the gate too.

The gate is `HardPaywallGate`, wrapped by `app/veyrnox/app/template.js` around the page and the daily check-in (the check-in grants credits, so a locked account never reaches it). It shows the existing `CreditSubscriptions` panel: plans with price and renewal terms, the consent box, Stripe checkout, return recovery, and (for a pending or flagged plan) manage and cancel. Around it: Terms and Privacy links, Sign out, and the existing `DeleteAccountPanel`. The plan is re-read on a finished checkout (`veyrnox:balance-changed`) and when the tab regains focus. States: checking (spinner, nothing else), locked, unknown (the AI Generation read failed: message plus Try again, the sign-out and delete controls stay).

Stays reachable: everything outside `/app` (marketing, `/models`, `/presets`, templates, pricing, legal, sign-in), account deletion, and `/app/admin` (its own Access and second-factor checks; operators must not need a plan). The dismissible `PaywallPrompt` is suppressed while the flag is on, whatever the plan.

No new route, no migration, no RPC. The plan labels are the existing Stripe ones; the paywall copy is `app.hardPaywall.*` in 11 locales, taken from the mobile paywall's translations (machine drafted, native review still owed).

## This gate is UI-level only

It stops the signed-in web app rendering. It does not stop a person calling `/api/v1/*` with their own token, and the sign-up grant still lands at email confirmation. Refusing generation for accounts without a plan, and moving the first 10 credits to the first paid invoice, is a separate server-side change (grant-timing migration). Until it lands, treat the gate as product behaviour, not as spend protection (ADR-0013).

## Consequences

- Flag off is today's behaviour; turning it on is the owner's call and a one-var change. To turn it on, add it to production `vars` as `"true"` and raise the binding cap with its own ADR line; remove it to turn it off.
- A paid person whose plan read fails is not shown plans; they see "we couldn't check your plan" with a retry.
- Crawlers and signed-out visitors reach `/app` pages only through the brief "Checking your plan…" screen while the flag is on.
- Open: Publish checkout is not offered in the gate (AI Generation plans only); a Publish subscriber passes it.

## Free trial (owner, 2026-11-01): decided, not built

The subscription comes with a 7-day free trial, and the trial and the first 10 credits go together: a person who starts the trial gets the 10 credits, and the paywall says so.

The subscription takes effect, and the first charge is made, after the 7 trial days (owner, 2026-11-01). The paywall and the consent say it plainly: free for 7 days with the 10 credits, then the plan price, and cancel any time before day 7 to avoid the charge. Nothing of this is in the gate yet, because the paywall must not offer a trial the server does not give. What it needs, in order:

1. **Server (grant-timing session, behind the same flag, ships off).** Stripe Checkout for the generation plans sends `subscription_data[trial_period_days]=7` (`packages/adapters/stripeCreditSubscriptions.js`). A trial's first invoice is $0, and today `creditInvoice` and `subscription_grant` credit only a paid invoice, so the trial-start must be a new, idempotent grant of the 10 credits keyed by the subscription (through `ledger_grant`/`signup_grant` rules, ADR-0013), and the end of a trial without a first payment must expire them. The cooling-off refund (ADR-0064) and the "ended or replaced cycle" rules need a stated answer for a trial.
2. **Consent.** New consent version strings (`SUBSCRIPTION_CONSENT_VERSION*` in `lib/subscriptions/api.js`) that state the trial, the price charged when it ends, automatic renewal and cancel-anytime, shown before payment. Legal copy is the owner's.
3. **Web copy, last.** The CTA and terms read "Start 7-day free trial, then {price}/month" with the renewal terms beside it, in 11 languages; flag-gated with the server change so a trial is never shown that Stripe will not give.
4. **Owner.** Approve the trial-farming exposure (each trial is up to 10 credits, about $0.15 of provider spend, per account; the sign-up gate and Turnstile apply), and confirm Stripe Managed Payments accepts trials on these plans.
