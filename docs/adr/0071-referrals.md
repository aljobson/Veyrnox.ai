# ADR-0071 — Referrals: a Credit reward for a friend who buys, never cash, never on sign-up alone

- **Status**: **Accepted 2026-10-05** (owner: "go with recommendation"). Nothing is built. The answers are recorded at the end.
- **Related**: ADR-0013 (Free Credits), ADR-0069 (free allowance), ADR-0026 (Turnstile on sign-up), CLAUDE.md "Money & billing"
  (no grants outside the listed RPCs; a manual or new grant path needs an ADR), "Identity & sessions" (the signup grant follows
  confirmation), and the **hard wall**: nothing here borrows wallet, on-chain or payout language.

## Context

Syntx's profile page shows a referral link, "partner tokens" and "available funds ~ $0.00": a referrer earns **money** when the
people they send spend. We should not copy the payout half. It would make us a payer of cash to individuals (tax, KYC, fraud and
refund exposure), and it invites exactly the abuse our signup gate was built to close: the 10-Credit signup grant is about $0.15 of
provider spend, so any reward that pays on sign-up alone turns a referral link into a money tap.

What we already have: a single grant path with idempotency (`ledger_grant`, `0073`), purchases that carry a refund and dispute
clawback (`apply_top_up_refund`, a Frozen account on dispute), and a price-waiver mechanism that mints no Credits (ADR-0069).

## Decision (proposed)

1. **The reward is Credits, paid to the referrer only after the friend has paid and the money is safe.** Never on sign-up, never
   on confirmation. The trigger is the friend's **first Credit Pack purchase** and the reward is released once that purchase is
   past its refund and dispute window with no refund, no dispute and the friend's account not Frozen.
2. **Size: 10% of the Credits in that first Pack**, rounded down, to the referrer, through `ledger_grant` with the idempotency key
   `referral:<referee user id>` so a replay or a second purchase pays nothing more. Credits are Pack Credits (they never expire and
   are not Free Credits); that is safe because they were bought for real money by someone else first.
3. **The friend gets nothing extra in v1.** They already get the signup grant. A friend bonus is a second money-for-nothing path;
   if wanted later it should be an ADR-0069 allowance bonus (a price waiver, no Credits minted), not a grant.
4. **Attribution is recorded once, at sign-up.** `?ref=<code>` is captured by the client, sent with the sign-up, and written to a new
   `referrals (referee_user_id UNIQUE, referrer_user_id, code, created_at)` row by a service-role function. It cannot be set or
   changed later, and a code is an opaque random string per user (never an email, id or anything guessable).
5. **Abuse bounds** (the part that matters):
   - no self-referral (same account), and no referrer who is Frozen or unconfirmed;
   - the friend must be a new account (no `grant:signup` before the referral row exists) and confirmed;
   - **at most 20 paid referrals per referrer per calendar month** and a cap on total reward Credits per referrer per month;
   - a refund or dispute on the friend's Pack **before release** cancels the reward; **after release** it is clawed back by a
     compensating `reverse:referral` ledger row (never an edit), capped at the referrer's balance like a Top-up clawback, with the
     shortfall noted rather than driving the balance negative;
   - rewards are released by a sweep, not at purchase time, so no request path can mint one.
6. **Tables are service-role only**, RLS enabled and forced, definer functions with `search_path = ''` and explicit revokes. A new
   reconcile check (`reconcile_referrals()`, zero rows when healthy) joins the nightly job: every reward row has a paid Pack, and
   every released reward has its one ledger entry.
7. **Ships behind `REFERRALS_ENABLED`** (`"false"` in production) and on staging first.

## What this deliberately does not do

- No cash, no "available funds", no payouts, no partner tiers. Credits only, spendable only on Veyrnox.ai.
- No reward on a friend's usage, subscription renewals or later purchases in v1 (one reward per friend, ever).
- No public leaderboard and no way for a referrer to see who the friend is beyond a count and the reward status.

## Why this and not the alternatives

| Option | Why not |
|---|---|
| Reward on sign-up | A referral link becomes a faucet; the grant is real provider spend and Turnstile cannot stop one human with many addresses. |
| Reward on first generation | Still spend with no revenue, and trivially scripted. |
| Cash or "funds" like Syntx | Payouts, tax and KYC, and a refund and dispute tail we cannot claw back from a bank. |
| Ongoing revenue share | A liability that grows forever and needs reporting; not worth it for v1. |

## Consequences

- One migration (table, three definer functions, the sweep, the reconcile check, the pg_cron job), acceptance tests for the release
  rules, the clawback, the monthly cap and idempotency, and a script in the replayed-database chain.
- A change to the sign-up client to carry `?ref=` (not a URL leak: it is read from the landing URL and cleared, like the OAuth
  fragment) and a "Refer a friend" panel on the account page showing the link, counts and reward status.
- Terms and the refund policy need a line: referral rewards are Credits, are released after the friend's refund window, and are
  reversed if that purchase is refunded or disputed.

## Owner's decisions (2026-10-05, "go with recommendation")

1. **Reward size**: 10% of the Credits in the friend's first Credit Pack, rounded down.
2. **Release window**: 14 days after the friend's purchase with no refund or dispute (if the real refund-policy length is longer, the longer one wins).
3. **Caps**: at most 20 paid referrals and 2,000 reward Credits per referrer per calendar month.
4. **Friend bonus**: none in v1.
5. **Packs only** in v1; Subscription Credits only when ADR-0064's webhook exists.

Build order when this is picked up: the migration (table, definer functions, the release sweep, `reconcile_referrals()` joined to the nightly
job), acceptance tests for release, clawback, the monthly caps and idempotency, a script in the replayed-database chain, then the sign-up
attribution and the account page panel. `REFERRALS_ENABLED` ships `"false"` in production. Take the next free migration number after the
highest **open PR** (see CLAUDE.md), not just after main.

## Build progress

**Part 1, attribution (migration `0217`, 2026-10-05).** Codes and the referrer link only; no Credits move and no reward exists yet.

- One opaque code per account, 10 characters from a 31-letter alphabet with no I, L, O, 0 or 1, made on first use and never derived from an id or email.
- `referrals.referee_user_id` is the primary key, so an account is attributed once and never changed. The same code again is a successful retry; a different one is refused.
- Attribution is accepted only for a new account: created in the last 48 hours, with no job and no top-up, and never to itself.
- The routes (`GET /api/v1/referrals`, `POST /api/v1/referrals/attach`) answer counts only and never say who the referrer is. An unknown code and a malformed one answer alike.
- Behind `REFERRALS_ENABLED`, `"false"` in production and staging.

**Open for the owner before part 2 can ship the sign-up capture.** A referral link carries the code in `?ref=`, and the sign-up flow leaves the page (email confirmation, OAuth), so the code has to survive in this browser until the first signed-in load. That is a new item for the storage notice and the privacy policy, which today list only the sign-in session, recent job display history and the theme. Two options: keep the code in `sessionStorage` for the tab and disclose it, or do not carry it and attribute only when the friend signs up in the same page load. The first is what makes the feature work; it needs the notice and policy updated in the same change.

**Part 2, rewards (migration `0218`, 2026-10-05).** The first referral migration that moves Credits, and only through `ledger_grant`.

- `referral_sweep()` runs hourly (`veyrnox-referral-sweep`, minute 23). It first qualifies: a friend's first credited Pack makes one pending reward of 10% of that Pack's Credits, rounded down, eligible 14 days after the Pack was credited. A Pack too small to earn a whole Credit earns nothing.
- It then releases what is due. A refund of any amount cancels it (`refunded`); a Freeze tied to that Pack cancels it (`disputed`). A frozen friend or referrer, or a referrer who is not a signed-up account, waits. At most 20 rewards and 2,000 reward Credits per referrer per UTC month, counted under a per-referrer lock; a capped reward stays pending and releases when the month rolls over.
- The grant is `ledger_grant(referrer, credits, 'grant:referral', 'referral-<referee id>')`, so the ledger reason is `grant:referral#referral-<id>` and a replay mints nothing. The Credits are Pack Credits, never Free Credits.
- No request path mints a reward: only the sweep does. Referrals exist only once the flag-gated attach route has run, so with `REFERRALS_ENABLED` off the sweep finds nothing.
- `reconcile_referrals()` returns zero rows when every released reward has its one ledger entry for the right Credits and account, no referral grant exists without a released reward, every reward is 10% of its friend's credited Pack, and no referrer is over either monthly cap. It is the seventh check in the nightly `veyrnox-reconcile-balances` job (the 0207 command, otherwise unchanged).

**Part 3, clawback (migration `0219`, 2026-10-05).** A reward already released is taken back when the friend's Pack is later refunded or disputed, inside `referral_sweep()` and never on a request path.

- A refund claws back the share of the reward matching the share refunded (`reward x refunded / price`, rounded down; a later, larger refund takes the difference). A dispute (a Freeze tied to the Pack) claws back the whole reward.
- One compensating ledger row, reason `reverse:referral`, never an edit. It takes only Pack Credits the referrer still has (`balance - free - subscription`, never below zero), the same cap as a Top-up clawback. What cannot be taken is recorded as `clawback_shortfall` and is not chased; the reward counts as settled either way.
- A clawed-back reward still counts toward the monthly release cap, so a refund cannot be used to recycle the cap.
- `reconcile_referrals()` gains a check that the ledger's `reverse:referral` rows equal the rewards' recorded clawbacks per referrer. `CLAUDE.md` lists `referral_sweep` among the ledger-writing RPCs.

**Part 4, capture and panel (2026-10-05, #590).** `?ref=<code>` is kept in `localStorage` for three days (not `sessionStorage`: the email-confirmation link usually opens in a new tab), the address is tidied, and the code is sent to the attach route once the visitor is signed in; an answer from the server about the code or account is final and clears it. The account page has a "Refer a friend" panel (link, copy button, count). The storage notice, Privacy Policy, Terms and Refund Policy describe it, and a test pins that they do. Returning visitors who already dismissed the storage notice do not see the new wording; re-prompting everyone means changing its stored key and is left to the owner.

Remaining: staging acceptance with `REFERRALS_ENABLED` on (see `docs/product/referrals-staging-runbook-2026-10-05.md`), then production through `apply-migrations` (`0205`, then `0217` to `0219`).

## Hourly reconciliation coverage (0264, 2026-10-10)

Track A8 / S20 adds the referral drift count to the counts-only public
snapshot and hourly watcher. Migration 0264 measures all seven existing
reconciliation functions before publishing the replacement snapshot, retains
the 45-minute freshness bound, forced RLS and service-only refresh, and
changes no allowance, reward, credit or launch policy.

The checker distinguishes an unapplied migration from missing measurements:
0264-absent fields remain explicitly unmeasured only while its actual receipt
is absent. Once applied, missing or malformed new counts fail closed. Local
SQL fixtures seed allowance overuse and an unmatched referral grant; the actual
watcher exits 1 for either, 0 for measured zeroes and 2 for invalid evidence.
New health-window reviews require all seven measurements; older five-count
artifacts remain historical evidence and cannot prove the expanded coverage.
Production application uses the protected main workflow and owner review.
