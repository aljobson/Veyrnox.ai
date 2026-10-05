# ADR-0071 — Referrals: a Credit reward for a friend who buys, never cash, never on sign-up alone

- **Status**: **Proposed 2026-10-05**. Nothing is built. The owner's answers (recommendations marked) are at the end.
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

## Open questions for the owner (recommendation first)

1. Reward size: **10% of the friend's first Pack**, or a flat number of Credits?
2. Release window: **14 days** after the friend's purchase with no refund or dispute (use the real refund-policy length if it differs).
3. Monthly caps: **20 paid referrals and a Credit ceiling set so the worst month is bounded** (suggest 2,000 Credits) per referrer.
4. Friend bonus: **none in v1**.
5. Referral rewards and Subscription Credits: **Packs only in v1**; add subscriptions only when ADR-0064's webhook exists.
