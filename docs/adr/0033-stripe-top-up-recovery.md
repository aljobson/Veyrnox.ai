# ADR-0033 — Recovering a paid Top-up when the Stripe webhook never lands

**Status:** Proposed 2026-09-24
**Related:** [ADR-0031](0031-stripe-replaces-lemonsqueezy.md) (Stripe replaces
LemonSqueezy — §Consequences names this gap and the intended direction),
[ADR-0018](0018-credit-pack-top-ups.md) (Credit Pack Top-ups — credit/refund
rules kept), [ADR-0023](0023-migrations-applied-by-workflow.md) (migrations
applied by workflow), CLAUDE.md ("Money & billing", "Provider webhooks")

## Context

A Credit Pack purchase is credited by exactly one path: a verified
`checkout.session.completed` webhook calling `credit_top_up`. If that delivery
never succeeds, the money is taken and the credits are not given.

ADR-0031 §Consequences already recorded the gap:

> The return-URL backfill (#94) is LemonSqueezy-shaped: it reads `order_id` and
> `order_identifier` from the query string, which Stripe does not send. The
> backfill path is inert under Stripe until it is rebuilt against the Checkout
> Session id.

The round-3 audit (finding 08) confirmed it is worse than "two guards need
widening" — on Stripe, no part of the recovery runs. Re-checked against
`main @ 684400f`:

| Step | State under Stripe |
|---|---|
| `packages/adapters/stripe.js:110` `success_url` | `?top_up=…&checkout=done` — carries **no Stripe order token** |
| `TopUpPacks.js:43-45` | only POSTs when it finds `order_id` **and** `order_identifier` in the query string, so the POST never fires |
| `POST /api/v1/top-ups/:id/return` | requires `^[0-9]{1,20}$` and a UUID |
| `record_top_up_return` (0064) | same numeric guard |
| `lib/topUpBackfill.js:56` | verifies by re-fetching a **LemonSqueezy JSON:API order** and comparing `order.attributes.identifier`, a field only that provider has |
| `top_ups_return_order_id_format` CHECK (0060) | `return_order_id ~ '^[0-9]{1,20}$'` — a **table constraint**, so a `cs_…` is rejected even if both RPC guards are widened. The audit named the two functions and missed this one. |

Widening the two regexes would achieve nothing, because no data reaches them.

**Nothing reconciles it either.** `reconcile_top_ups()` (0065) has six branches
— `grant_entry_mismatch`, `unlinked_topup_grant`, `credited_without_order`,
`clawback_exceeds_credits`, `clawback_ledger_mismatch`, `frozen_state_mismatch`
— every one of which starts from a `credited` row or a ledger entry. A Top-up
stuck at `pending` with a real charge behind it matches none of them, so the
nightly cron and the hourly watcher both stay green while a customer is out of
pocket.

Stripe retries a failed webhook with backoff for up to three days, so this is
rarer than it was under LemonSqueezy. It is not eliminated: a misconfigured
endpoint, a signing-secret rotation, or a handler that 500s consistently all
outlive the retry window, and all of them fail silently today.

### What Stripe checkout already carries

No new token has to be invented. `createCheckoutSession` already sets, per
`packages/adapters/stripe.js:89-107`:

- `client_reference_id` — our `top_ups.id`
- `metadata[top_up_id]` and `payment_intent_data[metadata][top_up_id]`
- `metadata[top_up_sig]` and `payment_intent_data[metadata][top_up_sig]` — an
  HMAC over the Top-up id under `signingSecret`, which the webhook path already
  verifies (`:185`)

and the adapter can already fetch a session by id (`:197`).

## Decisions

1. **The return handoff is rebuilt on the Checkout Session id**, as ADR-0031
   said it would be. `success_url` gains `&session_id={CHECKOUT_SESSION_ID}`,
   Stripe's documented template variable, which Stripe substitutes on redirect.

2. **There is no second token, and none is needed.** LemonSqueezy needed
   `order_identifier` because its `order_id` was a short sequential integer a
   stranger could guess. A `cs_…` id is unguessable, and `metadata[top_up_sig]`
   is a cryptographic binding to the Top-up that a caller cannot forge. The
   Stripe return body is therefore `{ session_id }` alone.

3. **The backfill verifies against the session, and credits the PaymentIntent.**
   A Top-up is credited only if all of these hold on the re-fetched session:
   `client_reference_id` and `metadata[top_up_id]` equal the row's id,
   `metadata[top_up_sig]` verifies, `payment_status` is `paid`, `amount_total`
   equals the row's `price_usd_cents`, and the currency matches. The credit is
   then written with `order_id = session.payment_intent` (`pi_…`), which keeps
   ADR-0031 decision 5 intact: a dispute names the charge, so the PaymentIntent
   stays the id every event shares.

4. **A `returned_not_credited` branch is added to `reconcile_top_ups()`**:
   status `pending`, `return_order_id` present, and `returned_at` more than an
   hour ago. This is what stops the failure being silent.

   It deliberately does **not** flag every stale pending row. An abandoned
   checkout is also pending forever, and it is the common case, so a bare
   "pending and old" branch would keep the nightly cron permanently red and
   train everyone to ignore it. Gating on `returned_at` is what makes the
   signal clean: the buyer came back from Stripe, so a charge almost certainly
   exists, and we still have not credited it. That means the backfill itself is
   failing or wedged — which is exactly the condition no existing branch covers.

   This is the same predicate `next_top_up_backfill_batch` (0060) already uses
   to choose work, so the reconcile branch is the alarm on a queue that already
   exists rather than a new notion of "stuck".

5. **The LemonSqueezy handoff is retired, not widened.** The
   `order_identifier` parameter, the digits-only `ORDER_ID_RE`, and
   `backfillVerdict`'s JSON:API shape become dead on the live path. They are
   removed rather than loosened, because a validator that accepts both shapes
   accepts neither strictly.

6. **Stripe's Search API is explicitly rejected as the primary recovery.**
   Searching PaymentIntents by `metadata['top_up_id']` would need no browser at
   all, but Stripe documents search indexes as eventually consistent — up to
   about a minute behind — which makes it unreliable for exactly the
   just-happened case a recovery must handle. Decision 4 makes the gap visible;
   a search-based sweep can be added later if the return handoff proves
   insufficient in practice, and it would be an addition, not a replacement.

## Consequences

- **A migration is required, and it creates new functions rather than editing
  two.** `record_top_up_return`'s argument list changes (the
  `p_order_identifier` parameter goes), and a changed signature is a *new*
  function that inherits nothing from the old one's ACL. Per CLAUDE.md it must
  carry `REVOKE ALL … FROM PUBLIC, anon, authenticated` then
  `GRANT EXECUTE … TO service_role`, naming the full signature, and the old
  signature must be dropped explicitly. The same applies to
  `next_top_up_backfill_batch` if its returned columns change.
- **`top_ups_return_order_id_format` must be replaced, not just the guards.**
  0097 widened `order_id` but not `return_order_id`; the recovery path cannot
  store a `cs_…` until this constraint accepts one. `top_up_order_collisions`
  and `top_ups.order_id` already accept `pi_…` after 0097, and the credit still
  writes a `pi_…`, so those need no change.
- The recovery is **best-effort on the browser and guaranteed on the alarm.**
  Decision 4 does not credit anything by itself — it raises an issue for a human
  or a later operator action. Crediting without a verified provider fact would
  breach CLAUDE.md ("credits granted only by a verified webhook").
- Applied by the `apply-migrations` workflow on `main` after owner approval
  (ADR-0023). Until it is applied, the recovery path stays inert and the reconcile
  branch does not exist, which is the state we are in today.
- `order_identifier` columns keep existing rows' data for the LemonSqueezy era;
  they are not dropped in this migration, so the historical audit trail survives.

## Open questions

- Whether anything should watch the rows decision 4 deliberately excludes — a
  buyer who paid and then closed the tab before the redirect leaves no
  `returned_at`, so nothing distinguishes them from an abandoned cart without
  asking Stripe. Decision 6's search sweep is the only way to cover that case,
  and it is the reason to revisit it.
- Whether a stale pending Top-up should also notify the buyer. Today they see a
  Top-up that never completes and no explanation.
