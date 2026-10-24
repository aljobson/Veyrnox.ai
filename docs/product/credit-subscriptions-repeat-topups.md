# Credit subscriptions and repeat top-ups

## Outcome

- Keep the existing Stripe-backed weekly and monthly Credit Subscription flow.
- Surface subscriptions from the low-credit paywall only when the public plan catalog is open.
- Treat a zero balance as a separate depletion cycle: show the purchase prompt once for that cycle, reset it after the balance becomes positive, and show it again after a later spend-down.
- Keep one-off packs available on every cycle. Each checkout uses a fresh client idempotency key; the database permits multiple purchases and deduplicates only a replay of the same key.

## Safety boundary

`SUBSCRIPTIONS_ENABLED` remains false in production until the Finance/Legal and remaining live-acceptance requirements in `docs/operations/subscription-approval-pack-2026-10-16.md` are recorded. Staging remains the environment for subscription checkout acceptance. This change must not weaken checkout consent, Stripe redirect validation, rate limits, webhook verification, ledger idempotency, cancellation, expiry, refund or dispute handling.

## Acceptance criteria

1. A signed-in account at zero credits sees a dedicated out-of-credits prompt even if the ordinary low-credit prompt already appeared during the sign-in.
2. Dismissing that prompt does not nag again while the same balance remains at zero.
3. After a successful top-up makes the balance positive, a later return to zero produces a new prompt.
4. One-off packs remain purchasable directly in the prompt and state clearly that another pack can be bought later.
5. When the public subscription catalog is open, the prompt offers a direct path to weekly/monthly plans; when sales are closed or unavailable, it does not advertise a subscription checkout.
6. The production subscription feature flag remains unchanged.
