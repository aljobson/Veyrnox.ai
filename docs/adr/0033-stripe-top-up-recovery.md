# ADR-0033 — Recovering a paid Top-up when the Stripe webhook never lands

**Status:** Proposed 2026-09-24 — amended 2026-09-24 (see Amendments)
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
| `top_ups_return_order_id_format` CHECK | a **table constraint**, so it blocks a `cs_…` even if both RPC guards are widened. The audit named the two functions and missed this one — and this ADR then described its contents wrongly; see the amendment. |

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

## Amendments

### 2026-09-24 — the return CHECK is a length cap, not a digits cap

The Context table above, and the Consequences entry saying
`top_ups_return_order_id_format` "must be replaced, not just the guards",
described the constraint as requiring digits. **That was wrong.** It survived
from the audit into this ADR because nobody read the current definition, only
0060's original one.

`0097_stripe_money_path_ids.sql` had already replaced it:

```sql
CHECK (return_order_id IS NULL OR return_order_id ~ '^[A-Za-z0-9_]{1,64}$')
```

The character class is right. **The 64-character bound is the blocker**: a
Stripe Checkout Session id runs to roughly 66-72 characters, so it is refused
on length while looking as though it ought to pass — a failure that reads as a
mystery rather than as a validation rule, which is presumably how it escaped
both the audit and this ADR.

**What 0108 does instead of "replacing" it.** It keeps 0097's character class
and raises the bound to 255, making the new constraint a strict *superset* of
what production enforces today. `ADD CONSTRAINT` therefore cannot fail when it
validates the table — the property that matters when a migration runs against
live money data. The `cs_` prefix is asserted in
`record_top_up_return_session`, where a wrong value is a caller error returning
`INVALID_SESSION_ID` rather than a migration that cannot be applied.

So decision 5's "retired, not widened" holds only for the app-layer validators.
A table constraint must keep every existing row legal, so the coarse bound is
widened deliberately and strictness lives in the writer.

**Also found while implementing, and worse than either:** two of the five
places were not validators but predicates that silently never match a Stripe
row. `next_top_up_backfill_batch` requires `return_order_identifier IS NOT
NULL`, so the row is never handed out; `close_top_up_return` matches on
identifier equality, which is NULL and so never true, meaning a completed check
could never close its own return and the row would be retried until the 7-day
window shut. Widening any regex would have left both in place.

### 2026-09-24 — Stripe application recovery and rollout

Stages 2 and 3 replace the live LemonSqueezy handoff, verifier and scheduled
route. Checkout carries the literal `{CHECKOUT_SESSION_ID}` template; the
browser records `{session_id}` through `record_top_up_return_session` and
removes the token from its URL. The route uses Stripe credentials only, and
its former LemonSqueezy order sweep is retired (`sweep: null` in the response).
A Stripe search sweep remains deferred under decision 6.

**Price correction to decision 3:** `amount_subtotal`, not `amount_total`,
is compared with the stored pack price. Managed Payments adds tax on top;
using the total would refuse every taxed purchase. This follows the existing
Stripe webhook and 0097's `credit_top_up` contract. The re-fetched Session must
be paid, have the expected live/test mode, carry both matching Top-up references
and a valid HMAC, and name a valid PaymentIntent. `credit_top_up` compares the
pre-tax amount and USD currency atomically under the row lock. Mismatches are
persisted as operator-refund flags and grant no credits. The Session id is
never used as the credited order id.

Successful and idempotent attempts explicitly close the return by Session id
and a NULL identifier: the queue otherwise sees `cs_… != pi_…` and keeps
reprocessing it. Transport, authentication, signature/configuration failures,
unpaid Sessions, and unusable RPC results stay open for retry and the alarm.
The grace period implemented by 0108 is **24 hours**, superseding decision 4's
one-hour draft. No buyer notification is introduced.

**Rollout:** keep the browser opt-in `localStorage.veyrnox_stripe_top_up_recovery`
unset until 0108 is applied by the owner-approved `apply-migrations` workflow
and reconciliation has stayed clean for 24 hours (CLAUDE.md, Delivery). Then
set it to the string `"true"` for a controlled checkout/recovery test. Wider
release removes the opt-in in a follow-up after that gate is satisfied.
The browser still scrubs the Session token while disabled, and normal webhook
crediting and status polling continue. Deploy the app only alongside this
migration plan; do not apply a migration from an agent session.

The fallback still needs the buyer to return; it does not discover purchases
whose tabs were closed. It also does not recover lost refund/dispute events:
those retain their Stripe webhook delivery paths (ADR-0031). No claim of
complete payment-event reconciliation is made by this recovery.

### Public activation — prepared 2026-09-24, pending the reconciliation gate

The activation change removes only the browser opt-in. Every valid returned
Session is then recorded, including when localStorage is unavailable. Existing
validation, URL scrubbing, server verification, polling and idempotency remain.

**Do not merge the activation change before 2026-09-25 09:04:07 UTC
(10:04:07 BST), and only after reviewing the intervening reconciliation runs.**
0108 applied at 2026-09-24 09:04:07 UTC in
[the owner-approved migration run](https://github.com/aljobson/Veyrnox.ai/actions/runs/35978430332).
A post-deployment check on September 24 around 09:16 UTC reported all four
reconciliation counts at zero, all 83 migrations accounted for, and the public
catalog serving its three packs. This is a baseline, not proof of 24 hours.

Before merge, inspect `reconcile-watch` runs since application, re-run
`node scripts/check-reconcile.mjs` and `node scripts/check-migration-ledger.mjs`,
and confirm production deployment is healthy. An unreadable check does not
count as clean. A failure must be investigated before activation. The separate
controlled checkout/recovery test remains to be performed; no real production
purchase/refund or lost-webhook drill has been performed by this task.

Rollback is to restore the browser opt-in in `TopUpPacks.js`; leave 0108 and
already-recorded returns in place. This stops new automatic handoffs while
verified pending recovery and the reconciliation alarm remain available.

## Open questions

- Whether anything should watch the rows decision 4 deliberately excludes — a
  buyer who paid and then closed the tab before the redirect leaves no
  `returned_at`, so nothing distinguishes them from an abandoned cart without
  asking Stripe. Decision 6's search sweep is the only way to cover that case,
  and it is the reason to revisit it.
- Whether a stale pending Top-up should also notify the buyer. Today they see a
  Top-up that never completes and no explanation.
