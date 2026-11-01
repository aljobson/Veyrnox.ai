# ADR-0315: A time-boxed complimentary Publish Plan, for QA

Status: proposed 2026-11-01 (owner direction in chat: unlock Publish for the QA test account, as a migration and ADR rather than a payment). Migration 0423 is drafted and not applied anywhere. Builds on [ADR-0062](0062-veyrnox-publish-entitlement-model.md).

## Context

A Publish Plan becomes active only from a Stripe payment event (`start_social_publish_subscription`, then `apply_social_publish_subscription_event`). There is no sanctioned way to give an account the plan without paying. A QA pass of scheduling, rescheduling, cancelling and analytics on a dedicated test account therefore needs either a real payment or a deliberate, recorded grant.

## Decision

1. **One service-role RPC, `grant_social_publish_comp`** (0423). It is not called by any route, worker or cron; a person with database access runs it once per grant.
2. **It needs a reason.** `p_reason` (20 to 500 characters) is stored in the new `social_publish_subscriptions.comp_reason` and must name the human who decided. For the QA account: "Owner (Al Jobson) approved a 14-day Publish Plan for the QA test account Testuser1, 2026-11-01."
3. **It is short and lapses on its own.** At most 14 days. The row is `active` with `cancel_at_period_end = true`; `read_social_publish_entitlement` counts a subscription as paid only while `current_period_end` is in the future, so the plan stops working at the end date with no job.
4. **It cannot stack.** It refuses an account that already has a live subscription, a Frozen account, an unknown plan and a reused key whose plan, days or reason differ (checked null-safely). A replay with the same arguments returns the original row and its original end date.
5. **It writes an audit event** in the append-only `social_publish_subscription_events` (`publish.admin_comp`, id `evt_comp_<subscription uuid>`, so two accounts can share a key and similar keys never collide), so a comp is always distinguishable from a paid subscription. No Stripe ids are set.
6. **The app can tell it is a comp.** `read_social_publish_entitlement` adds `complimentary` (never the reason); `planSource` reports `complimentary` and the Publish plan panel hides Manage billing and Cancel for it, since there is no Stripe subscription behind it.
7. **No credits or ledger writes.** The RPC touches only the two Publish subscription tables.

## Consequences

- A comp row stays `active` after it lapses, which blocks that account from starting a paid Publish Plan (`SUBSCRIPTION_ALREADY_ACTIVE`). End it by hand first; this is acceptable for a test account.
- Revenue or subscriber counts that read `status = 'active'` or `price_usd_cents` will count a comp. Anything that reports on Publish subscriptions should exclude rows where `comp_reason IS NOT NULL`.
- The RPC applies to production only through the owner-approved `apply-migrations` run; the single call is then made with the owner's approval in chat.

## Amendment 1 (2026-11-01): a lapsed comp no longer blocks or flags a real subscription

QA review found that the lapsed comp row stayed `active`, so a later Stripe start returned `SUBSCRIPTION_ALREADY_ACTIVE` and a later Stripe or store event stored the paid row as `flagged` (the store path after the store had charged). Migration 0424 adds `end_lapsed_social_publish_comps(user_id)`, which ends comp rows whose `current_period_end` has passed, and calls it first in `start_social_publish_subscription`, `apply_social_publish_subscription_event`, `apply_store_publish_event` and `grant_social_publish_comp`, inside the same transaction and under the same lock. A live (unexpired) comp still blocks. Not applied anywhere; no comp has been granted in production.
