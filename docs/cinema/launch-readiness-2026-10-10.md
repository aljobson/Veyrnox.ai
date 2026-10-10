# Cinema launch readiness — 10 October 2026

Engineering preparation is authorized by the owner: “Proceed with the remaining
Cinema checks and get it ready to go live. I will deal with Stripe.” This is a
readiness record, not authorization to activate paid production before its gates.
Production `CINEMA_UNLOCKS_ENABLED` and `CINEMA_SUBSCRIPTIONS_ENABLED` remain false.

## Verified

- Migrations 0244 and 0245 are applied in production and staging. The only active
  plan is `pass-monthly`, USD 999 cents. Weekly/yearly are inactive; the monthly
  Pass ceiling is 1,500 minutes and the monthly free ceiling is 300 minutes.
- The staging database acceptance in [launch-readiness-acceptance.sql](launch-readiness-acceptance.sql)
  passes: one free play, denial at the 300-minute ceiling, a six-credit Unlock,
  replay returning the same Unlock with exactly one ledger debit, and all five
  live reconciliation functions returning zero rows. Every fixture, including
  ledger entries, rolls back. The script bypasses HTTP/auth/Stream boundaries
  for fixture setup; it does not claim to test those boundaries.
- 131 focused Cinema/CSP Node tests pass, including pause, end, buffering,
  seeking, hidden-tab, fractional-time and delayed-timer metering cases.
- Local Reticle browser checks return `verified: yes` for the free-ceiling and
  Pass-ceiling HTTP 402 messages, six earned seconds on a six-second fixture,
  and no additional heartbeat or renewal after 800,000 ms of idle time. These
  use an isolated synthetic session, mocked gateway replies and media events
  through Cloudflare's actual SDK. Coverage is partial: React local state and
  the cross-origin frame are not directly observed. They complement the real
  staging database/Stream checks; they are not a full live payment journey.
- The signed-in staging browser played the real six-second Stream test video.
  After replay, the database recorded one six-second heartbeat at 15:57:32 UTC;
  at 15:58:12 UTC there were no later heartbeats while the ended player stayed
  visible. The initial 60-second play grant remained, as 0245 requires.
- The staging Worker builds successfully without Reticle wiring and is deployed
  as `6a507698-a9ae-42dc-9da2-cc429a2848ec`. All 37 secret binding names and all 57
  plain variables match the previous deployment. Production switches are unchanged.
- At 15:51 UTC, all five production live reconciliation functions returned zero
  rows. At 15:52 UTC, all five staging functions also returned zero rows.
- Production reconciliation runs after 0245 succeeded at 13:31, 14:31 and 15:30 UTC:
  [13:31](https://github.com/aljobson/Veyrnox.ai/actions/runs/38056011435),
  [14:31](https://github.com/aljobson/Veyrnox.ai/actions/runs/38059934315),
  [15:30](https://github.com/aljobson/Veyrnox.ai/actions/runs/38063918663).
  Successful snapshot refreshes alone are not proof of zero drift: these jobs
  explicitly check all five counts and fail on drift or unavailable evidence.

## Launch gates still open

1. **Reconciliation window:** 0245 was applied in production at 13:08:22 UTC on
   10 October. The earliest end of its 24-hour window is **11 October 2026,
   14:08:22 BST**. Check the intervening `reconcile-watch` runs for failures,
   missing coverage or drift, then re-run `node scripts/check-reconcile.mjs`.
   A clock passing 24 hours alone is not a clean-window verdict.
2. **Owner/provider acceptance:** the owner handles Stripe acceptance and the
   approved supply-consent/cancellation wording. Existing UI wording and tests
   are engineering evidence, not a supplied legal/provider approval document.
3. **Account delivery rate:** the [published Stream rate](https://developers.cloudflare.com/stream/pricing/)
   is USD 1 per 1,000 delivered minutes, plus storage. The account invoice has
   not been verified: the current CLI login has no billing permission (403),
   and the billing dashboard reports temporarily unavailable. Treat the rate
   as provisional for margin planning; buffering/preloading can also be billed.
4. **Production catalogue:** at 15:49 UTC, production had zero published titles
   and zero ready uploads. Publish reviewed launch content with ready, signed
   Stream uploads before selling access. Do not publish the staging test clip.

## Cutover after gates pass

1. Deploy the approved metering fix to production with paid switches still off;
   verify Stream signing configuration and retain the existing binding names.
2. Verify at least one production title and its ready upload, owner acceptance,
   the invoice rate, and the complete reconciliation window. Record evidence here.
3. Enable `CINEMA_UNLOCKS_ENABLED=true` with `CINEMA_FREE_CEILING_ENABLED=true`;
   leave `CINEMA_SUBSCRIPTIONS_ENABLED=false` for the first free/Unlock smoke check.
   This opens free playback as well as credit Unlocks. Keep unrelated flags intact.
4. Enable `CINEMA_SUBSCRIPTIONS_ENABLED=true` only after the owner's Stripe work
   is complete. Re-read that only the USD 9.99 monthly plan is active. Verify
   Checkout, signed webhook processing, return-page entitlement, Customer Portal,
   cancellation/refund behavior and clean reconciliation with an authorized test.
5. Re-read deployed flags and bindings, then capture the signed-in production
   viewer result. A failed/outage/unknown verification is not a launch pass.

Rollback new sales/play-token requests by setting both paid switches false and
deploying. Keep `CINEMA_FREE_CEILING_ENABLED=true`, signing secrets and the Stripe
webhook configured; already purchased Passes still need cancellation, refunds
and event processing. Existing playback tokens expire within 15 minutes.
