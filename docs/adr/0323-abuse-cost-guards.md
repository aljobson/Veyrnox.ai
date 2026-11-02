# ADR-0323 — Abuse and cost guards: image ceiling, in-flight job cap, spend-policy gaps

Status: implemented for owner review; migration 0434 not applied.
Date: 2026-11-02.

An audit of the API-credit-abuse checklist found most protections already in place
(request-body caps, server-side catalog price, idempotent debits, spend reservation
before the provider call, signed short-lived URLs, sweeps). This ADR records the
gaps closed in PR #1867 and the ones left open.

## Decisions

1. **Image canvas ceiling.** An upload is refused above 16,384 px on a side or
   100 megapixels (`upload_dimensions_too_large`), whatever model it is later used
   with; a model's own `maxPixels` can only be lower. Dimensions come from the file
   header (`lib/uploadSource.js`, checked in `resolveSource`), never from the client.
   An unreadable header passes this check and the model's own limits decide. Copy is
   in all 11 app locales.
2. **In-flight job cap (0434).** One account may hold at most 30 jobs in `DEBITED`
   or `SUBMITTED` created in the last three hours. The generation limiter allows 10
   a minute and video jobs live up to two hours, so without a cap one account could
   queue hundreds of supplier jobs, bounded only by balance and the $15/hour spend
   cap. A `BEFORE INSERT` trigger on `jobs` takes a per-user advisory lock, counts,
   and raises `PROVIDER_SPEND_LIMIT:user_inflight:30`; the Worker's existing
   `providerSpendError` returns a retryable 429. It fires before the spend guard, so
   a refusal never takes the global spend lock and charges nothing. A replay returns
   the existing job before any insert and is unaffected. `user_inflight_policy`
   holds the switch (`enabled`) and the number; a missing row means no cap, and the
   spend caps still apply.
3. **Spend policy rows.** `byteplus` and `crun` get provider hour/day caps
   ($10 / $25, as kie) so they no longer rely on the global cap alone.
4. **Reservation pruning.** `provider_spend_reservations` is read by sums inside the
   global lock and was never pruned. `prune_provider_spend_reservations(7)` runs
   daily (pg_cron, 03:17 UTC) and deletes in batches of 50,000. The limits read at
   most the current UTC day, so seven days is ample; fewer than three is refused.
5. **Detection and reading.** SEC-008 raises a medium alert when one account creates
   120 or more jobs in an hour. `provider_spend_utilization()` returns hour/day use
   as percentages of each cap, naming no user, for an out-of-band poller. Nothing
   calls it yet.

## What does not change

Credits, the ledger, `credit_balances`, refunds and every price are untouched. The
per-user spend ceiling stays at $15/hour and $50/day: a heavy legitimate buyer can
reach it, so lowering it is the owner's call with real usage numbers.

## Rollback

The migration only refuses new jobs and never blocks a refund, so a Worker-only
rollback is safe. To stop the cap without a deploy:
`UPDATE public.user_inflight_policy SET enabled = false`.

## Open

- Trial farming: the 7-day trial grants starter credits with no one-per-card or
  per-fingerprint control (`lib/subscriptions/api.js`).
- No master spend switch: the runtime switches of ADR-0319 (migration 0429, not yet
  applied) cover generations and chat only, not Auto Short, server render, voice or
  uploads.
- ElevenLabs, chat search and the video-agent runner reserve no row in
  `provider_spend_provider_policy`.
- Worker minute sweeps (GrsAI, BytePlus, Crun) take no lock and can overlap; the
  cost is duplicate provider reads, not duplicate billing.
- Dashboard settings the repo cannot show: Supabase CAPTCHA and email limits, Stripe
  Radar rules, live versus test key separation.
