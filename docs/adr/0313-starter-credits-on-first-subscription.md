# ADR-0313: The first 10 credits arrive with the first paid subscription, not at sign-up

Status: proposed 2026-11-01 (owner direction in chat: "the 10 credits comes when they subscribe"). Migration 0422 replays cleanly on a fresh Postgres twice and is not applied anywhere. The switch ships off, so sign-up behaves as today until the owner turns it on. Amends [ADR-0013](0013-credit-expiry-policy.md) (who mints Free Credits, and when) and [ADR-0108](0108-mobile-store-billing.md) amendment 2 (hard paywall).

## Context

The hard paywall (mobile `EXPO_PUBLIC_HARD_PAYWALL_ENABLED`, and the web gate) tells a person to subscribe before they can use the product and quotes "10 credits" as what the subscription brings. The server does the opposite: `handle_auth_user_created` / `handle_auth_user_confirmed` (0010, 0071) call `signup_grant`, which mints 10 Free Credits (`grant:signup`, `free_delta` 10, 90-day expiry sweep, ADR-0013) the moment an address is confirmed. So the apps promise a grant the server has already made.

Three paths already end in one function: a paid Stripe invoice (`grant_credit_subscription_invoice`, 0383), the yearly months 2 to 12 (`grant_due_yearly_cycles`), and an App Store or Play event (`apply_store_generation_event`, 0393) all call `subscription_grant(user, credits, period_end, key)`. A `subscription_grant` that succeeds and is not a replay means a real paid cycle.

## Decision

Move the existing grant; do not add a second one.

1. **One database switch, off by default.** `starter_credit_config.grant_on_first_subscription` (a one-row table, the 0297 pattern) is read by the two auth triggers, which run in Postgres and cannot see a Worker var. Only `set_starter_credits_on_subscription(boolean)` (service_role) changes it. This is the server half of the hard paywall; turn it on together with the app and web gate flags.
2. **Switch off: nothing changes.** Sign-up and email confirmation grant 10 Free Credits as before.
3. **Switch on: sign-up provisions only.** The triggers call `provision_user` (shadow row, zero balance), never `signup_grant`. The user is still provisioned (the generation route does not answer `user_not_provisioned`), but the balance stays 0.
4. **The first fresh `subscription_grant` mints the 10.** `subscription_grant` (0184 body unchanged) now ends by calling `grant_starter_credits(user)` in the same transaction under the same balance lock. A replay of the same key returns before it, so it cannot run twice. `grant_starter_credits` calls `signup_grant`, so the credits are ordinary Free Credits: reason `grant:signup`, `free_delta` 10, spent before Pack credits, expired 90 days after they were granted, covered by `reconcile_free_credits()`, and not granted to an erased email (0347). No ledger row is written by new code; no `ledger_grant` reason is opened.
5. **One per person.** `signup_grant` probes for the user's own `grant:signup` row, so a second subscription, a renewal, a yearly month, a re-subscribe or any replay grants nothing more. The unit is the user, not the subscription.
6. **Accounts that already received the sign-up grant are left alone.** They have a `grant:signup` row, so they get nothing further and nothing is taken back. Their unspent credits expire 90 days after sign-up, as promised when they signed up.
7. **Frozen or deleted accounts are skipped.** The call returns `ACCOUNT_NOT_ELIGIBLE` and the subscription grant proceeds. The first paid cycle after `unfreeze_account` grants then. A Frozen account normally cannot start a subscription; this covers one frozen between start and first payment.
8. **Refunds and disputes do not touch the starter credits.** A full refund or dispute of the first invoice already reverses the subscription bucket (`reverse_subscription_grant`, unchanged) and a dispute freezes the account, which stops spending. The 10 Free Credits stay and expire on their own clock. The worst case is a subscribe, refund, keep-10 loop worth about $0.15 of provider cost per account; a subscribe-and-refund pattern is visible in `credit_subscription_events` and the account can be frozen.
9. **Other grants stay.** The daily check-in (ADR-0257) mints ordinary Pack credits through `ledger_grant`, and the free allowance is a Worker flag. Neither is touched. With the hard paywall on they have no audience before a subscription, so turn them off with the same flip if the intent is no use before subscribing (owner call).

## Amendment 1 (2026-11-01): the subscription starts with a 7-day free trial

Owner: the 10 credits come with the trial. So the grant fires when the trial **starts**, and the first paid charge is no longer the trigger (it stays as a fallback for a plan with no trial: `subscription_grant` still calls `grant_starter_credits`, which is a no-op once the user has the credits).

| Path | Trial start | How it is told apart |
|---|---|---|
| Stripe | `customer.subscription.*` with status `trialing` | `interpretSubscription` keeps `trialing: true` (it still folds the status into `active`); the webhook then calls `grant_trial_starter_credits(sub_id)` once the state is applied. A failed call is retried, not acknowledged. |
| App Store / Play | RevenueCat `INITIAL_PURCHASE` with `period_type` `TRIAL` | `parseStoreEvent` types it `initial_purchase_trial` (generation products only); `apply_store_generation_event` activates the subscription and calls `grant_starter_credits`. A paid intro offer (`INTRO`) is an ordinary purchase. |

- **No plan credits during a trial.** Nothing was paid. The first paid invoice (Stripe) or the `RENEWAL` that ends the trial (store) grants the plan, exactly as before, and grants no second starter credits. Before this amendment a store trial event would have minted a full plan cycle (`initial_purchase`); typing it apart closes that.
- **Cancelled before the first charge.** The subscription ends; the 10 stay and expire 90 days after they were granted (the Free Credit sweep, unchanged). A refund event during the trial has no plan grant to reverse and leaves them.
- **Refund or dispute of the first paid invoice after the trial.** Reverses the plan credits only (a dispute also freezes the account); the 10 stay.
- **Abuse.** One grant per user (the `grant:signup` probe), never per trial, product or re-subscription. The same App Store / Play subscription cannot start a trial for a second account (`SUBSCRIPTION_OWNED_BY_OTHER`), and the stores give a trial once per Apple ID / Google account. Not stopped: a person with a new email, card and store account; each attempt costs about $0.15 of provider spend and passes Turnstile and email confirmation.
- **Frozen, deleted, erased:** nothing is granted; the first cycle after an unfreeze grants.
- **Not done here:** the trial itself. Stripe Checkout needs `subscription_data.trial_period_days: 7` and the store products need a 7-day free-trial offer; until they exist no trial event ever arrives and the first paid invoice grants instead. Neither is created by this change.

Options considered for point 4 and 6:

| | For | Against |
|---|---|---|
| Reuse `signup_grant` (chosen) | One grant per user for free; Free Credit expiry, spending order, reconciler and erased-email guard unchanged; no new ledger shape | The ledger reason still reads `grant:signup`, and the 90 days run from the first subscription |
| New reason via `ledger_grant` | Clear reason in the ledger | Pack credits that never expire, a new per-user uniqueness index, and a second place that mints "starter" credits |
| Claw back the existing sign-up grant on flip | Everyone on the same rule | Takes credits already promised; needs a new reason beside the one-expiry-per-user index |
| Re-grant to existing accounts when they subscribe | Everyone gets 10 at subscribe | Doubles the grant for anyone who has not spent theirs |

## Consequences

- With the switch on, a new account has balance 0 until it pays. Until the apps and web actually gate on it, an unpaid account can sign in but every generation answers insufficient credits. Free allowance and check-in credits are the only other way to a balance.
- The apps keep quoting a fixed 10 (the amount is the 0127 constant inside `signup_grant_base`). Changing the number means a new migration there, not here.
- `subscription_grant` returns `starter_granted` and a `balance_after` that includes the starter credits on that call.
- Replaying migration 0422 is a no-op. A rollback is `set_starter_credits_on_subscription(false)`: sign-up grants again from then on; accounts that subscribed meanwhile keep what they were given.

## Owner steps (nothing here is applied)

1. Review and merge the PR, then approve the `apply-migrations` run for 0422.
2. Turn the apps and web gate on, then call `set_starter_credits_on_subscription(true)` as service_role at the same time. The order that avoids a gap: gate flags first or together, switch last.
3. Create the 7-day trial: `trial_period_days` on the Stripe Checkout subscription and a free-trial offer on each App Store / Play generation product (not part of this change).
4. Check `reconcile_free_credits()`, `reconcile_balances()` and `reconcile_subscription_credits()` return zero rows the next morning.

## Tests

`scripts/test-starter-credits.mjs` (wired into `ledger-tests.yml`, runs inside a rolled-back transaction after re-applying the migration twice): ships off; switch off leaves sign-up and subscribing as before; switch validated, replay-safe and service_role-only; switch on grants nothing at sign-up or confirmation; the first paid invoice grants plan plus 10 once; replay, renewal, direct call and a second subscription add nothing; a full refund of the first invoice keeps the 10; an account that already had the sign-up grant keeps 10 not 20; a Frozen account gets nothing until the first cycle after unfreeze; an erased email gets nothing; the App Store event path grants; a store trial grants the 10 and no plan credits, the paid renewal then grants the plan only, a repeated trial or second product adds nothing, the same store subscription cannot serve a second account, a trial cancelled or refunded keeps the 10 until the 90-day sweep, a Frozen account's trial grants nothing; the Stripe trial grant is replay-safe, skips non-live subscriptions, and a dispute after the trial keeps the 10; switching off restores sign-up grants; all three reconcilers return zero rows throughout.
