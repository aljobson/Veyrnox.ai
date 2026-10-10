# ADR-0057 — Social Cinema viewer paywall, modelled on ReelShort

- **Status**: Accepted 2026-09-26 (owner: "approved, build phase 1", then "build phase 2"). Phases 1 to 3 built on PR #344. Owner asked for "the same as ReelShort"; this records what that means here and where it cannot be literal. An amendment is proposed in the last section (2026-10-10): a $9.99 monthly Pass as the only plan, a 1,500-minute ceiling and a 30% creator share.
- **Deciders**: Product owner (approver); Finance/Legal for cooling-off wording; Stripe acceptance in writing before build.
- **Related**: [ADR-0013](0013-credit-expiry-policy.md) (Free vs Pack Credits), [ADR-0018](0018-credit-pack-top-ups.md) / [ADR-0031](0031-stripe-replaces-lemonsqueezy.md) (Stripe Managed Payments, refunds, Freeze), [ADR-0019](0019-dispute-webhooks-freeze.md), [ADR-0037](0037-higgsfield-credit-parity.md) (packs unchanged), [ADR-0048](0048-social-cinema-foundation.md) to [ADR-0054](0054-cinema-upload-removal.md) (Cinema), `CONTEXT.md` (Social Cinema viewing). Plan: [docs/cinema/paywall-plan.md](../cinema/paywall-plan.md).

## Context

ReelShort (Crazy Maple Studio) monetises vertical short drama three ways, checked 2026-09-26 against its App Store storefronts and web store:

| | ReelShort | Notes |
|---|---|---|
| Free opening | first episodes of every series free | count varies by title |
| Per-episode unlock | ~60 coins ≈ $0.30–0.57 | coins 0.50–0.95¢ each, packs $4.99–$99.99, unlocks permanent |
| VIP | web $14.99/wk ($11.99 first week), $49.99/mo, $199.99/yr; iOS weekly $19.99 | unlimited viewing, no coins |
| Rewarded ad | one episode per ad view | |

Social Cinema (ADR-0048 to 0054) has profiles, creator onboarding, private SERIES → SEASON → EPISODE drafts with FILM/SHORT/TRAILER roots, and Stream uploads that require signed URLs. Nothing is published, viewable or priced yet; `cinema_content` allows only `DRAFT`/`PRIVATE`.

Two literal readings of "the same" are ruled out:

- **ReelShort's coin prices cannot become credit prices.** A credit is the generation unit; `credit_packs_sticker_floor` (0121) rejects anything under $0.043 per credit and every generation carries provider cost. Coins are 5 to 20 times cheaper because an episode costs its seller nothing to serve again. Unlocks are therefore priced *in credits at the existing pack rates*, which lands in ReelShort's per-episode dollar band anyway.
- **Unlimited generation cannot be sold.** ReelShort's VIP is unlimited *viewing*. Viewing uploaded Cinema content costs only Stream delivery, so unlimited viewing is affordable; unlimited generation is not.

The glossary's **Subscription** already means a recurring credit allotment (planned, not offered). The viewing plan is a different thing and gets its own name so the two never merge.

## Decision

1. **Free Episodes.** SHORT and TRAILER content is always free. The first five episodes of a series, counted from season 1 position 1 in order, are free. Everything after, and every FILM, is locked.
2. **Episode Unlock: 6 credits, permanent.** A locked episode or film costs 6 credits, which is $0.26 to $0.60 at current pack rates against ReelShort's $0.30 to $0.57. An Unlock is a ledger row with reason `unlock:cinema:<content_id>`, written by a new `ledger_unlock` RPC that sits beside `ledger_debit` (which cannot be reused: it creates a `jobs` row, and an Unlock is not a job). It is idempotent on user and content, so a replay returns the same Unlock and never debits twice. Free Credits spend first (ADR-0013), which is fine: an Unlock has no provider cost. Frozen accounts cannot unlock. The price lives in a `cinema_prices` table with CHECK bounds; the app layer never computes it.
3. **Cinema Pass: $14.99 weekly, $49.99 monthly, $199.99 yearly, USD, web.** Unlimited viewing of published Cinema content while active. The weekly plan's first week is $11.99 once per account, enforced server-side from Pass history, never from the client. Sold through Stripe Checkout in subscription mode under Managed Payments; cancellation through the Stripe Customer Portal; the Pass runs to the end of the paid period. A fair-use ceiling of 3,000 delivered minutes per calendar month bounds Stream cost per Pass.
4. **A Cinema Pass never touches the ledger.** It grants no credits and moves no balance, so `reconcile_balances()` and `reconcile_free_credits()` are unaffected. Entitlement is derived on the server from `cinema_passes` state and period end, and from `cinema_unlocks`, through one RPC. Stream playback tokens are minted only for an entitled viewer, bound to the video, with a TTL of at most 15 minutes.
5. **Reversals.** An Unlock is final: digital content supplied at once, like a Top-up after generating. Content taken down by its creator or by moderation reverses every Unlock of it from the last 30 days as `ledger_refund` compensating rows, run by an Operator. A Stripe refund of a Pass invoice ends the Pass at once. A dispute on a Pass invoice ends the Pass and Freezes the account (ADR-0019), because it is the same Chargeback signal.
6. **Viewer spend is recorded per content for creators, but nothing is paid out.** Every Unlock keeps its content id and credits; every Pass play writes an append-only row of seconds watched. A creator revenue share is a separate ADR with its own tax and identity work. Creator terms must say so before any content is published.
7. **Not now.** Rewarded-ad unlocks (no ad network, and CSP is `default-src 'self'`), regional or local-currency prices, iOS and Play channels, and a coin-style bonus ladder for credit packs (packs stay as 0121).

## Considered options

- **Sell unlocks in a new Cinema-only coin.** Matches ReelShort exactly and lets coins be priced at 1¢. Rejected: a second currency means a second ledger, a second reconciliation and a second Free grant faucet, for a product with no customers yet. Credits already exist, already reconcile and already Freeze.
- **Cinema Pass as a credit Subscription.** The glossary's planned Subscription could carry a viewing entitlement. Rejected: it would tie a $14.99 weekly viewing plan to credit allotments and per-period expiry buckets that do not exist yet, and would leak generation cost into an unlimited promise.
- **Pass-only, no unlocks.** Simplest billing. Rejected: ReelShort's revenue is mostly coins, and a per-episode price is the on-ramp that a weekly plan is not.
- **Free episode count per title, set by the creator.** ReelShort varies it. Deferred: a platform constant is enough to launch and can become a bounded creator setting later.

## Consequences

- **Blocked on publication.** `cinema_content.lifecycle_status` and `visibility` CHECK to `DRAFT`/`PRIVATE`. A publication slice with moderation and a public feed is a prerequisite and needs its own ADR; this ADR prices what that one makes viewable.
- **Blocked on written Stripe acceptance** for recurring viewer plans over user-uploaded video under Managed Payments. LemonSqueezy's refusal (ADR-0031) is the reason to ask first; Managed Payments' support for subscription mode is a verification item, not an assumption.
- **Consumer law.** An Unlock needs a Supply Consent equivalent (content supplied immediately, right to cancel ends on play). A Pass is a distance contract with a 14-day cooling-off in the UK and EU; the plan calls for pro-rata refund on cancellation within 14 days rather than a waiver.
- **New webhook events on the existing Stripe route**: `customer.subscription.created`, `updated`, `deleted`, `invoice.paid`, `invoice.payment_failed`, deduped by `webhook_events(source, external_id)` like every other event. The payload's customer is never trusted for identity; the Pass row is looked up by Stripe subscription id and its own `user_id` used.
- **Feature switches.** `CINEMA_SUBSCRIPTIONS_ENABLED` already exists as a master flag in `lib/cinema/features.js` and becomes the Pass switch. `CINEMA_UNLOCKS_ENABLED` is new, a child of the master and profile switches; the reserved `PPV_ENABLED` stays reserved. Both ship off.
- **Phase 1 as built (0142, 2026-09-26).** `cinema_content` now admits `PUBLISHED` and `PUBLIC` in its CHECKs so the publication slice has somewhere to write, but no function writes them and `save_cinema_draft` refuses to edit published rows; drafts stay private. "First five episodes" is implemented as season 1, positions 1 to 5. Playback tokens are RS256 Stream JWTs signed with a key that lives only in Worker secrets (`CINEMA_STREAM_SIGNING_KEY_ID`, `CINEMA_STREAM_SIGNING_JWK`) for `CINEMA_STREAM_CUSTOMER_CODE`, and the player host is not yet in CSP. A viewer page waits for the publication slice: there is no public content read to hang it on. Deliberate: a playback token names the video, not the viewer, because Stream verifies only its own claims; the 15-minute TTL is the whole mitigation for a captured token, the same trade as a presigned R2 URL. `reverse_cinema_unlocks` has no HTTP route yet and is reachable only by an Operator tool that must take the operator's name from a verified identity.
- **Phase 2 as built (0143, 2026-09-26).** Plans live in `cinema_pass_plans`; Checkout runs in subscription mode with inline recurring `price_data`, so no Stripe Price object exists to drift, and the once-only intro is a Coupon with a deterministic id (`veyrnox-pass-intro-<plan>-<amount off>`) created on first use. A Pass is bound to its subscription from the pass id our checkout signed into the subscription metadata; an unsigned subscription can only update a Pass already bound to it. Stripe events are applied in `created` order and a terminal Pass (ended, flagged) is never resurrected. A second subscription paid while one Pass is live is `flagged` and never entitles; the webhook (or the return page) cancels that subscription at Stripe at once so it cannot bill again, retrying with the event if the cancel fails, and an Operator refunds the charge already taken. Top-up disputes keep their old path with no Stripe call; only a dispute no credited Top-up claims has its charge re-read to find a subscription invoice. The return page applies the subscription state itself, so a lost webhook cannot leave a paid Pass pending. Cooling-off: within 14 days of the first charge, cancel cancels at Stripe immediately and refunds the unused share of the latest invoice pro rata, floored; a failed refund still ends the Pass and is logged as an Operator item, never silent. The 3,000-minute ceiling arrives with Phase 3.
- **Phase 3 as built (0144, 2026-09-26).** A Pass Play is a heartbeat of at most 60 seconds, recorded only when the viewer's access to that title is `pass`; free, unlocked and locked viewing record nothing because their cost is already accounted for. A Pass cannot log more seconds than wall-clock time (60 per rolling minute, serialized per Pass), so a scripted client can neither inflate a creator's seconds nor race the ceiling. The ceiling is `cinema_prices.pass_ceiling_minutes` (3,000 per calendar month, UTC); at the ceiling entitlement reports `locked` with reason `pass_ceiling` and the unlock price, so the viewer can still pay per episode, and playback tokens stop. `operator_cinema_earnings` sums live Unlock credits and Pass seconds per title for a month, admin only with the check in the database, read through an admin route behind fresh MFA and Cloudflare Access. No payout: the creator share is a separate ADR. Playback for a Pass holder goes through the same `read_cinema_playback` and 15-minute token as an Unlock. Written Stripe acceptance (precondition P2) is still required before the switch is turned on.
- **Stream cost is the only marginal cost.** At Stream's published delivery rate a Pass viewer who hits the 3,000-minute ceiling costs about $3 a month against $49.99; the yearly plan at $16.67 a month still clears 50% contribution at the ceiling. Verify the rate and the fee schedule before pricing is final.
- **Vocabulary.** `CONTEXT.md` gains Free Episodes, Episode Unlock, Cinema Pass, Pass Play and Unlock Reversal. "VIP", "coins" and "membership" are avoided.
- **Migrations** 0142 (prices, unlocks, entitlement RPC), 0143 (passes, pass events), 0144 (pass plays) take the next free numbers on main; no open PR carries a migration today. Applied only through the `apply-migrations` workflow (ADR-0023).

## Operator HTTP actions (0150, 2026-09-26)

`POST /api/v1/admin/cinema/unlocks/reverse` wraps the existing 30-day Unlock
Reversal RPC for one content row after it leaves publication. It does not change
publication state. Normal withdrawal/suspension continues to reverse a whole
title through ADR-0059. The wrapper records a verified actor, reason, request ID,
UUID idempotency key and the original result atomically; retries return that result.

`POST /api/v1/admin/cinema/pass/refund` refunds a flagged duplicate Pass's initial
invoice in full, including tax. It persists an immutable operation before any
Stripe mutation, cancels and re-reads the subscription, and verifies the
subscription/customer/invoice/PaymentIntent/charge chain and test/live mode.
Amounts and provider IDs never come from the request. A renewal invoice, split
payment, disputed charge, prior manual refund or ambiguous provider response
requires separate Operator review. This route does not handle cooling-off refunds.

Both routes require middleware-verified identity, TOTP within five minutes,
Cloudflare Access and a fresh database check of `users.is_admin`, a present Auth
user, an unfrozen account and any Cinema membership being active. Cinema reviewer
membership alone does not grant financial Operator privileges. Existing unlock
and subscription switches respectively gate the routes; no switch changes here.

The refund operation is unique per Pass, with an idempotency key scoped to the
initiating Operator. Retries use the same Operator, key and body. Stripe uses a
stable key derived from the persisted operation plus operation metadata. Every
retry lists that charge's refunds: an existing matching refund is recovered even
if Stripe has expired its idempotency key. Pending refunds return 202, failed ones
require review, and only a verified successful refund writes an append-only
receipt and ends the flagged Pass. A webhook arriving first cannot lose the
receipt or affect the buyer's other, live Pass. No Pass operation writes credits.

Implementation and recovery contract: [Operator actions](../cinema/operator-actions.md).

## Inactive creators sell nothing (0170, 2026-10-02)

The catalogue already hid a title whose creator's Cinema membership is not
`active`, but the price check behind unlocks, entitlement and Pass plays did
not, so a restricted, suspended or banned creator's title could still be
unlocked by id for Credits. `cinema_unlock_price` now returns no price for such
a title: unlock, entitlement, playback and Pass plays all answer
`content_not_found` before any debit. Viewers who unlocked it earlier regain
access when the creator is reinstated; an Operator can refund them meanwhile
with `reverse_cinema_unlocks`.

## Free viewing needs a ceiling before unlocks open in production (2026-10-09)

Phase 3 records only Pass Plays, on the reasoning that the cost of free,
unlocked and locked viewing is already accounted for. That holds for an Unlock,
which is paid for, and for locked viewing, which plays nothing. It does not
hold for free viewing: SHORT and TRAILER titles and Free Episodes are delivered
by Stream at the same per-minute rate, and no minutes are counted for them.

No viewer is affected today. `CINEMA_UNLOCKS_ENABLED` gates playback as well as
unlocks and is `false` in production, so no playback token is issued there.
`CINEMA_VIEWING_ENABLED` opens the catalogue only.

Decision (owner, 2026-10-09): a monthly ceiling on free viewing minutes per
account is built and switched on before `CINEMA_UNLOCKS_ENABLED` is `true` in
production. It is not built yet. Its value, how minutes are counted and what a
Cinema Pass holder gets past it are decided when it is built; it is
precondition P6 in the [paywall plan](../cinema/paywall-plan.md).

## Proposed: $9.99 monthly Pass only, 1,500-minute ceiling, 30% creator share (2026-10-10)

Status: **Proposed.** Owner, 2026-10-10: "record $9.99, 1,500 minutes and
30%", then "withdraw them" for the weekly and yearly plans. Migration 0244 was
applied to production and staging on 2026-10-10 (owner-approved run). No Pass
is on sale:
`CINEMA_SUBSCRIPTIONS_ENABLED` is `false` in production and unset on staging,
so there is no subscriber to reprice.

| | Decision 3 above | Proposed | Where it lives |
|---|---|---|---|
| Monthly Cinema Pass | $49.99 | $9.99 | `cinema_pass_plans`, row `pass-monthly` (0244) |
| Weekly Pass ($14.99, first week $11.99) and yearly Pass ($199.99) | on sale | withdrawn | `cinema_pass_plans.active` is `false` for both (0244) |
| Pass ceiling, delivered minutes per calendar month | 3,000 | 1,500 | `cinema_prices.pass_ceiling_minutes` (0244) |
| Creator share of Pass revenue | none; a separate ADR | 30% | this section only, no code |

$9.99 is the lowest price `cinema_pass_plans` accepts (the 999 floor in 0143).
The ceiling is one value for every Pass.

The weekly and yearly plans are withdrawn because at $9.99 a month both cost
more for the same time: $9.99 a month is $119.88 a year. A withdrawn plan keeps
its row, since Passes reference it. `list_cinema_pass_plans` stops offering it
and `start_cinema_pass` answers `PLAN_NOT_FOUND` for a new start. The $11.99
first week existed only on the weekly plan, so no intro price is on offer.
Putting a plan back on sale is a new migration.

Why the ceiling halves with the price. These figures are a model, not a
measurement. They use Stream's list rate of $1 per 1,000 minutes delivered
(read 2026-10-09), about $0.80 of payment fees on a $9.99 charge (an
assumption from Stripe's UK list rates; the Managed Payments fee was not read
and comes on top), the owner's working assumption that free viewing equals Pass
viewing minute for minute, and a 30% share taken after payment fees ($2.76).

| Pass minutes in the month | Delivery, free viewing included | Left per Pass |
|---|---|---|
| 100 | $0.20 | about $6.20 |
| 1,000 | $2.00 | about $4.40 |
| 1,500, the proposed ceiling | $3.00 | about $3.40 |
| 3,000, the ceiling today | $6.00 | about $0.40 |

At 3,000 minutes a Pass at its ceiling roughly breaks even. At 1,500 it keeps
about a third of the price. Both hold only while free viewing is bounded,
which is precondition P6.

What this does not decide:

- **How the creator share is paid.** 30% is the intended share. It was modelled
  on Pass revenue after payment fees, split by the Pass seconds per title that
  `operator_cinema_earnings` already sums. Whether it comes before or after
  fees, and payout, tax and creator identity, are still the separate ADR that
  decision 6 requires. Nothing is paid out until that ADR is accepted, and
  creator terms keep saying so (P3).
- **Unlock prices and Free Episodes.** Unchanged.

To move this to Accepted: the Stripe and Managed Payments fees are read from
the fee schedule (the open check under Consequences), and 0244 is applied
through `apply-migrations` (precondition P7). A Pass sold before 0244 keeps its
plan and the price it was sold at, on its own row and at Stripe. From its next
heartbeat it has the 1,500-minute ceiling.

## Free viewing ceiling as built (0245, 2026-10-10)

Owner, 2026-10-10: build it. Built behind `CINEMA_FREE_CEILING_ENABLED`.
Migration 0245 was applied to production (apply-migrations run 38053327460,
after 0244) and to the staging database on 2026-10-10. The switch is `true`
on staging. In production it is `true` since 2026-10-10 (owner), and has no
effect there while `CINEMA_UNLOCKS_ENABLED` is `false`: it is read only after
the unlocks gate. Playback in production still waits for the staging
acceptance of the ceiling and 24 hours of clean reconciliation after 0245.

- **The rule.** An account has `cinema_prices.free_ceiling_minutes` of free
  viewing per calendar month (UTC). The proposed value is 300 and the owner
  confirms it; the CHECK admits 0 to 100,000. The app layer never computes it.
- **What counts.** A Free Play is seconds of a free title (SHORT, TRAILER or a
  Free Episode) recorded for an account in the append-only `cinema_free_plays`.
  Granting playback counts one minute, or what is left of the month, whether
  or not the player reports back; a repeated request counts again. After that
  the player's heartbeat meters the viewing with the Pass Play caps: at most
  60 seconds per heartbeat, and no more than 60 seconds per 55 of wall-clock
  time per account, serialized per account. The window is 55 seconds rather
  than 60 because a steady 30-second heartbeat lands the row from two beats
  ago at 60 seconds plus or minus jitter, and a 60-second window refused
  about a third of honest beats; the price is that a scripted client can log
  about a tenth more than wall-clock. The minute at the grant is a floor, not
  a meter: a client that sends no heartbeat is counted one minute per play
  start while the token it holds lasts up to 15 minutes, and a token already
  issued keeps working until it expires. The player renews its token every 12
  minutes, and a renewal is a play start. Nothing is counted when playback is
  refused or the video is not ready.
- **At the ceiling.** Entitlement for a free title reports `locked` with reason
  `free_ceiling` and 0 credits, playback returns no stream uid so no token is
  signed, and the watch page says the free viewing limit for the month is
  reached. The ceiling is the account's, not the title's. Paid titles answer
  as before.
- **Cinema Pass holders.** Free minutes are used first. Past the free ceiling
  a free title plays under the Pass, is recorded as a Pass Play and counts
  toward the Pass ceiling. With both ceilings reached it is locked. A live
  Unlock of a title that later became free still plays it.
- **With the switch off nothing changes.** `cinema_entitlement`,
  `read_cinema_playback` and `record_cinema_pass_play` keep their bodies. Only
  while the switch is on does the Worker call `cinema_metered_entitlement`,
  `start_cinema_playback` and `record_cinema_play` in their place. If the
  switch is on before 0245 is applied, those calls fail and playback answers
  503, so apply the migration first.
- **Not covered.** The title page still labels a free title "Free" past the
  ceiling; the message is on the watch page. Pass Plays are recorded as
  before: the minute at a play start applies to free viewing only.
- **No money moves.** Nothing in 0245 touches `ledger_entries` or
  `credit_balances`.
- **Personal data.** `cinema_free_plays` records who watched which free title
  and when, for every signed-in viewer, append-only. The erasure path ADR-0008
  leaves open must cover it.

The entitlement endpoint now reports `pass` for a Cinema Pass holder, where it
answered 503 before. No Pass is on sale, so no one sees a difference today.

### Playback metering correction (2026-10-10)

Staging acceptance found that the watch page sent 30-second heartbeats after a
six-second video ended, and renewed tokens while idle. The player now uses the
[official Stream Player API](https://developers.cloudflare.com/stream/viewing-videos/using-the-stream-player/using-the-player-api/)
`playing`, `pause`, `ended`, `waiting`, `seeking` and error events. It records
visible playback wall time, retains fractional seconds, flushes earned seconds
on stop/hide, and caps a delayed browser beat at 60 seconds. Token renewal only
runs during visible playback or when the viewer explicitly presses Play.
The server remains authoritative for entitlement, ceilings and wall-time caps.

The SDK is loaded only on the watch page from Cloudflare's documented
`https://embed.cloudflarestream.com/embed/sdk.latest.js`, with the current
HTML document's CSP nonce, including after client navigation. No wildcard
script or connection host is added to the production CSP. A failed SDK load
shows playback unavailable before requesting a token or spending a play grant.

## Incomplete event ordering repair (0263, 2026-10-10)

S19 is independently reproduced: an active Pass followed by an incomplete
subscription snapshot with the same Stripe created second becomes pending
under 0143. That removes paid access and permits another checkout.

Forward migration 0263 records an incomplete snapshot as stale whenever the
bound Pass is active or past_due, matching the credit-subscription guard in
0186. It preserves every Pass field, including period, customer, cancellation
and last-event timestamp, and retains the immutable event receipt. Initial
pending-to-active transitions, newer renewal/past_due updates, binding checks,
replay idempotency and terminal ended/flagged behavior remain intact. The RPC
remains service-only. No credit, price, viewing ceiling or launch flag changes.

The rollback-only local acceptance script reproduces the original failure,
then checks same-second and later incomplete events against both live states,
initial activation, second-checkout refusal, renewal, duplicate-payment
flagging, terminal states, binding, ledger invariance and function privileges.
Production application still requires the protected main workflow and owner
review; a green local or staging check does not authorize paid activation.
