# Referrals on staging: apply 0217 to 0219, deploy, walk it (2026-10-05)

ADR-0071. Target: Supabase project `veyrnox.ai staging` (`yrqzwqywxfesmbvhzjgj`) and Worker `veyrnox-ai-staging`.
Production is untouched by this runbook. The state below was checked read-only against staging on 2026-10-05.

## Before you start

- **Merge first:** #588 (rewards, `0218`), #589 (clawback, `0219`, retarget it to `main` once #588 has merged) and #590 (the client and the
  policy copy). `0217` (attribution) is already on `main`. Then `git pull` on `main`: the SQL files below must exist locally.
- **Read the two Credit-moving migrations' headers** (`0218`, `0219`) before running them. They are the first referral code that can mint
  and take back Credits, and only through `ledger_grant` and a `reverse:referral` row.

## Where staging is now

- Applied migrations stop at `0212` (the chat set). **No referral objects exist** (`referral_codes`, `referrals`, `referral_rewards`).
- It has what the referral migrations call: `account_actions`, the `top_ups` refund and clawback columns, `ledger_grant`, `credit_top_up`,
  `apply_top_up_refund`, `apply_dispute_event`, `create_pending_top_up`, `pg_cron` and the nightly `veyrnox-reconcile-balances` job.
  It has 3 active credit packs, 8 users and no credited top-ups yet.
- **It does not have `reconcile_free_allowance()`** (migration `0205`). `0218` reschedules the nightly job with seven checks, one of which
  calls it, so a nightly run would fail without it. **Apply `0205` first** (the minimum), or all of `0205` to `0207` as in
  `free-allowance-staging-runbook-2026-10-05.md` if you are testing the free allowance too.
- Heads-up, not yours to fix here: the other session's chat migrations are recorded on staging under the numbers they had then
  (`0209_chat_folders` to `0212_chat_web_engine`), while `main` now has them as `0210` to `0213`. Expect `migration-ledger` to flag that.
- Everything referral is behind `REFERRALS_ENABLED`, `"false"` in `wrangler.jsonc`. Nothing changes for anyone until step 3.

**Order: database first, then deploy with the flag.** With the flag on the Worker calls `referral_code_for` and `attach_referral`;
deployed before the SQL, the account page would show nothing and every attach would fail quietly.

## 1. Apply the migrations (SQL editor, in this order)

Open https://supabase.com/dashboard/project/yrqzwqywxfesmbvhzjgj/sql/new and check the project name at the top left reads
`veyrnox.ai staging`. For each file, paste and Run. Expect "Success. No rows returned".

```bash
cd ~/Documents/GitHub/Veyrnox.ai && git checkout main && git pull
pbcopy < packages/db/schema/supabase/0205_model_free_allowance.sql
```

Then the same for `0217_referral_attribution.sql`, then `0218_referral_rewards.sql`, then `0219_referral_clawback.sql`.

- 0217: two tables and three functions. No Credits move.
- 0218: the rewards table, `referral_sweep()` (hourly, minute 23), `reconcile_referrals()`, and the nightly job with a seventh check.
- 0219: clawback columns and the sweep's third step.

## 2. Check it (read-only; Claude can run this too)

```sql
select count(*) as tables_present from information_schema.tables where table_schema = 'public' and table_name in ('referral_codes','referrals','referral_rewards');  -- 3
-- service-role only
select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('referral_code_for','attach_referral','referral_summary','referral_sweep','reconcile_referrals');   -- all false
-- the jobs
select jobname, schedule from cron.job where jobname in ('veyrnox-referral-sweep','veyrnox-reconcile-balances');  -- minute 23 hourly, and 17 3 * * *
select command ilike '%reconcile_referrals%' as has_check from cron.job where jobname = 'veyrnox-reconcile-balances';  -- true
select * from public.reconcile_referrals();   -- zero rows
select * from public.reconcile_balances();    -- zero rows
```

## 3. Build and deploy with the flag on

```bash
cd ~/Documents/GitHub/Veyrnox.ai && git checkout main && git pull
APP_ENV=staging SUPABASE_URL=https://yrqzwqywxfesmbvhzjgj.supabase.co \
NEXT_PUBLIC_SUPABASE_URL=https://yrqzwqywxfesmbvhzjgj.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging publishable key from wrangler.jsonc> \
PUBLIC_HOST=https://veyrnox-ai-staging.al-jobson.workers.dev npm run build:worker
npx wrangler deploy --env staging --var REFERRALS_ENABLED:true
```

Rollback: `npx wrangler rollback <version-id> --env staging` (get the id first with `npx wrangler deployments list --env staging`).
To switch the feature off without a rollback, redeploy without `--var`.

## 4. Walk it (two staging accounts: A refers, B joins)

You need two real sign-ups, so use two email addresses and expect the Turnstile and the confirmation email. Use a private window for B.

1. **A** signs in and opens `/app/account`. The **Refer a friend** panel shows a link like `https://veyrnox-ai-staging.al-jobson.workers.dev/?ref=XXXXXXXXXX`
   and "0 friends have joined through your link". Copy it.
2. **B**, in a private window, opens A's link. The address bar loses `?ref=...` straight away. In DevTools, Application, Local Storage, the key
   `veyrnox_referral` holds the code. The storage notice mentions it.
3. **B** signs up and confirms the email (the confirm link may open in a new tab; that is why the code lives in local storage, not session storage).
   After the first signed-in page load the key `veyrnox_referral` is gone.
4. Check the link was recorded (read-only):

```sql
select r.created_at, r.referrer_user_id, r.referee_user_id from public.referrals r order by r.created_at desc limit 1;   -- A's id and B's id
```
5. **A** reloads `/app/account`: "1 friend has joined through your link". B never sees A's identity anywhere.
6. Refusals worth trying: B opens the link again after signing up (nothing changes); an old account (made more than 48 hours ago) opens a link
   and signs in (not attributed, the code is cleared).

### The reward (simulating B's first purchase; staging only)

A real purchase needs Stripe on staging. These two statements create and credit a pending Pack for B exactly as the webhook would. They
find B as "the latest referral", so there is nothing to edit.

```sql
with r as (select referee_user_id from public.referrals order by created_at desc limit 1),
     f as (select u.auth_id::text as auth_id from public.users u join r on r.referee_user_id = u.id),
     p as (select id from public.credit_packs where active order by credits limit 1)
select public.create_pending_top_up((select auth_id from f), (select id from p), 'ref-walk-' || gen_random_uuid()::text, '2026-09-13', 10, 600) as result;
```
```sql
select public.credit_top_up(t.id, 'pi_3Qref' || replace(gen_random_uuid()::text, '-', ''), t.price_usd_cents, 'USD', p.variant_id) as result
from public.top_ups t join public.credit_packs p on p.id = t.pack_id
where t.status = 'pending' and t.user_id = (select referee_user_id from public.referrals order by created_at desc limit 1);
```

Both should answer `"ok": true`. Then:

```sql
select public.referral_sweep();   -- {"ok": true, "qualified": 1, "released": 0, ...}: a pending reward, 10% of the pack's credits, 14 days out
select status, credits, eligible_at from public.referral_rewards order by created_at desc limit 1;
```

Skip the 14 days (staging only), and release it:

```sql
update public.referral_rewards set eligible_at = now() - interval '1 minute'
 where referee_user_id = (select referee_user_id from public.referrals order by created_at desc limit 1);
select public.referral_sweep();   -- released: 1
select l.delta, l.free_delta, l.reason from public.ledger_entries l
 where l.user_id = (select referrer_user_id from public.referrals order by created_at desc limit 1) and l.reason like 'grant:referral#%' order by l.created_at desc limit 1;
-- delta = the reward, free_delta = 0, reason = grant:referral#referral-<B's id>
select * from public.reconcile_referrals();   -- zero rows
select * from public.reconcile_balances();    -- zero rows
```

Run `select public.referral_sweep();` again: `released` stays 0 and no second ledger row appears (replay mints nothing). A's balance on
`/app/credits` is up by the reward.

### The clawback (B's pack is then partly refunded)

```sql
select public.apply_top_up_refund(t.order_id, t.price_usd_cents / 2, t.price_usd_cents)
from public.top_ups t where t.status = 'credited' and t.user_id = (select referee_user_id from public.referrals order by created_at desc limit 1);
select public.referral_sweep();   -- clawed_back: half the reward (rounded down)
select l.delta, l.reason from public.ledger_entries l
 where l.user_id = (select referrer_user_id from public.referrals order by created_at desc limit 1) and l.reason = 'reverse:referral';
select clawed_back_credits, clawback_shortfall from public.referral_rewards order by created_at desc limit 1;
select * from public.reconcile_referrals();   -- zero rows
```

Run the sweep again: nothing more is taken. A's balance on `/app/credits` is down by that half.

## 5. Clean up, and what comes after

- Redeploy without `--var REFERRALS_ENABLED:true` to switch the feature off again.
- The test accounts and their ledger rows stay (the ledger refuses deletes by design); label them in the email addresses you used.
- **Production** is a separate decision after this passes: `0217` to `0219` through the `apply-migrations` workflow with your approval,
  then `REFERRALS_ENABLED`. The hourly sweep and the nightly seventh check are in the migrations. Production has had `0205` to `0207`
  applied only if you have run the free allowance there first; `0218` needs `0205` for the same reason as on staging.
