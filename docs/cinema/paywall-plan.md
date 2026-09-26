# Social Cinema paywall — implementation plan

Companion to [ADR-0057](../adr/0057-cinema-viewer-paywall.md). Nothing here is built. Each phase is one PR, lands behind a switch that ships off, and is applied to production only through the `apply-migrations` workflow (ADR-0023). Numbers below are the ADR's; change them there, not here.

## Preconditions (owner and legal, before Phase 1)

| # | Item | Owner | Why it blocks |
|---|---|---|---|
| P1 | Publication slice: **done, ADR-0059, migration 0146** (review queue, public reads, catalogue, title and player pages). | Eng | Nothing is viewable, so nothing is sellable. |
| P2 | Written Stripe acceptance of recurring viewer plans over user-uploaded video under Managed Payments, and confirmation that Managed Payments supports Checkout `mode=subscription` and the Customer Portal. | Owner | ADR-0031: category refusals are not appealable. |
| P3 | Cooling-off and Supply Consent wording for Unlocks and Passes; creator terms stating no revenue share yet. | Legal | Distance-selling rules in UK/EU. |
| P4 | Stream credentials and webhook live (ADR-0052 gates), delivery rate verified against the invoice. | Owner | Pass margin depends on it. |
| P5 | `ledger_debit` inserts a `jobs` row (0059), so an Unlock cannot reuse it. 0142 adds a sibling `ledger_unlock` RPC in the same family: Free-first, Frozen check, `free_delta` bookkeeping, idempotent on `(user_id, content_id)`, joining the RPC-only writer set in `CLAUDE.md`. | Eng | No raw INSERT into `ledger_entries`; reconciliation must stay at zero rows. |

## Phase 1 — Free Episodes and Episode Unlock (migration 0142, switch `CINEMA_UNLOCKS_ENABLED`)

Schema, all forced RLS, no browser grants, explicit REVOKE/GRANT per function:

- `cinema_prices(key TEXT PK, credits INT CHECK 0..50, updated_at)` seeded with `episode_unlock = 6`, `film_unlock = 6`, `free_episodes = 5`. Catalog-style: the only source of these numbers.
- `cinema_unlocks(user_id, content_id, ledger_entry_id, credits, created_at, reversed_at NULL, reversal_entry_id NULL)` UNIQUE `(user_id, content_id)`; RESTRICT on content delete so a takedown must reverse first.
- `unlock_cinema_content(p_auth_id, p_idempotency_key, p_content_id)` SECURITY DEFINER, `SET search_path = ''`: resolves user, requires current Auth identity, requires content `PUBLISHED`/`PUBLIC` and lockable, returns the existing Unlock on replay, otherwise calls the ledger debit with reason `unlock:cinema:<id>` and writes the Unlock in the same transaction. Rate-limited with the existing window pattern (20/min/account).
- `cinema_entitlement(p_auth_id, p_content_id)` returns `{access: free|unlocked|pass|locked, credits}`. Phase 1 never returns `pass`.
- `reverse_cinema_unlocks(p_content_id, p_operator, p_reason)` Operator-only, writes `ledger_refund` rows for Unlocks in the last 30 days and stamps `reversed_at`; audited like `unfreeze_account`. No route in Phase 1: the Operator surface (admin route behind aal2) is a follow-up, and the function refuses an empty operator name.

Gateway (`/api/v1/cinema/*`, existing middleware, identity headers overwritten):

- `POST /api/v1/cinema/unlocks` with UUID `Idempotency-Key`, body `{content_id}`, Supply Consent version recorded. Typed errors: `insufficient_credits`, `account_frozen`, `content_not_lockable`, `cinema_unlocks_disabled`.
- `GET /api/v1/cinema/entitlement?content_id=` no-store.
- Playback: `POST /api/v1/cinema/play` mints a Stream signed token only when entitlement is not `locked`, TTL 15 min, bound to the upload's `stream_uid`.

UI: viewer page shows "Free", "Unlocked" or "Unlock for 6 credits" from the entitlement response; the credits balance and Top-up link reuse `TopUpPacks`. No price is written in app code (`creditPackPrices.test.mjs` pattern extended). **Deferred to the publication slice (P1):** there is no public content read or player page yet, so the page ships with publication; the entitlement response already carries the consent version the button must send.

Status 2026-09-26: migration, RPCs, routes, flag, unit tests and `scripts/test-cinema-unlocks.mjs` (wired into `ledger-tests.yml`) are built on branch `claude/reelshort-app-subscription-66afe0`. `cinema_content` CHECKs admit `PUBLISHED`/`PUBLIC` with no writer. Playback token config: `CINEMA_STREAM_SIGNING_KEY_ID`, `CINEMA_STREAM_SIGNING_JWK` (base64 JSON of the Stream signing key's private JWK, a Worker secret), `CINEMA_STREAM_CUSTOMER_CODE`.

Tests: isolated Postgres replay of 0142; replay-returns-same-Unlock; concurrent unlocks of one content debit once; Free Credits spend first; Frozen denied; takedown reversal never takes balance below zero; `reconcile_balances()` and `reconcile_free_credits()` return zero rows after the suite; gateway tests for validation, flag-off 404, rate limit.

## Phase 2 — Cinema Pass (migration 0143, switch `CINEMA_SUBSCRIPTIONS_ENABLED`)

Status 2026-09-26: built on branch `claude/reelshort-app-subscription-66afe0` (PR #344) as described in ADR-0057 "Phase 2 as built". Differences from the sketch below: no `stripe_price_id` or `stripe_intro_coupon_id` columns (inline recurring `price_data` and a deterministic coupon id instead); statuses are `pending|active|past_due|ended|flagged`; `cinema_pass_events` dedupes on the Stripe event id or the checkout session id; the cooling-off refund is issued by the cancel route, not a webhook. Verified by `scripts/test-cinema-passes.mjs` (wired into `ledger-tests.yml`), `tests/cinemaPassApi.test.mjs`, `tests/stripePass.test.mjs` and `tests/stripePassWebhook.test.mjs`.

Schema:

- `cinema_pass_plans(id, interval CHECK weekly|monthly|yearly, price_usd_cents, intro_price_usd_cents NULL, stripe_price_id, stripe_intro_coupon_id NULL, active)` seeded `weekly 1499 / intro 1199`, `monthly 4999`, `yearly 19999`. Sticker CHECK: `price_usd_cents >= 999`.
- `cinema_passes(id, user_id, plan_id, stripe_subscription_id UNIQUE, stripe_customer_id, status CHECK incomplete|active|past_due|canceled|ended, current_period_end, cancel_at_period_end, intro_applied BOOL, created_at, updated_at)`. One active Pass per user (partial unique index).
- `cinema_pass_events` append-only (trigger like `ledger_entries_append_only`): `(pass_id, stripe_event_id UNIQUE, type, occurred_at, payload_digest)`. No raw payloads stored.
- `start_cinema_pass_checkout(p_auth_id, p_idempotency_key, p_plan_id)` writes a pending Pass and decides intro eligibility (no prior Pass row for this user) before the redirect.
- `apply_cinema_pass_event(p_stripe_subscription_id, p_event_id, p_type, p_status, p_period_end, p_cancel_at_period_end)` service-role only; looks the Pass up by subscription id and uses its `user_id`; older events cannot regress a newer period.
- `cinema_entitlement` gains `pass` when an active Pass has `current_period_end > now()` and the calendar-month play total is under the 3,000-minute ceiling.

Stripe: Checkout `mode=subscription`, `automatic_tax` on (ADR-0031), success URL with `{CHECKOUT_SESSION_ID}` like Top-ups (ADR-0033), Customer Portal link for cancel/change. Webhook route handles `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`; `charge.dispute.created` on a Pass invoice ends the Pass and calls `apply_dispute_event` (Freeze). Refund of a Pass invoice ends the Pass. Existing `webhook_events(source, external_id)` dedupe and ±5 min signature window apply unchanged.

Consumer law: cancellation within 14 days of first purchase refunds pro rata through the Stripe API and ends the Pass; the wording comes from P3.

Tests: webhook signature, replay no-op, out-of-order events, dispute Freeze, intro applied once per account across re-subscribes, entitlement flips exactly at `current_period_end`, ledger untouched by every Pass path (assert row count unchanged).

## Phase 3 — Pass plays and creator ledger (migration 0144)

Status 2026-09-26: built on PR #344 as described in ADR-0057 "Phase 3 as built". The heartbeat endpoint is `POST /api/v1/cinema/play/heartbeat`; the Operator read is `GET /api/v1/admin/cinema/earnings?month=YYYY-MM`. Verified by `scripts/test-cinema-pass-plays.mjs` (wired into `ledger-tests.yml`), `tests/cinemaUnlockApi.test.mjs` and `tests/cinemaEarningsApi.test.mjs`.

- `cinema_pass_plays(pass_id, content_id, seconds INT CHECK 1..600, played_at)` append-only, written from the play endpoint's heartbeat with a per-request cap; feeds the monthly ceiling and the future creator share.
- Operator read `operator_cinema_earnings(content_id, month)` summing Unlock credits and Pass seconds. No payout. Creator revenue share is its own ADR.

## Later, explicitly not scheduled

Rewarded-ad unlocks; per-title free-episode counts set by creators; local-currency prices; iOS and Play as Sales Channels; coin-style bonus ladder for credit packs.

## Rollout checklist per phase

1. Migration number re-checked against `main` and open PRs on the day of merge.
2. ADR row in `docs/adr/README.md` updated; `CONTEXT.md` terms present.
3. Switch off in `wrangler.jsonc`; deploy; apply migration through the workflow; run the reconcile cron once clean.
4. Switch on for the owner's account only, then for all.
