# Free allowance on staging: apply 0205 to 0207, deploy, walk it (2026-10-05)

ADR-0069. Target: Supabase project `veyrnox.ai staging` (`yrqzwqywxfesmbvhzjgj`) and Worker `veyrnox-ai-staging`.
Production is untouched by this runbook. Every step below was checked read-only against staging on 2026-10-05.

## Where staging is now

- Applied migrations stop at **0200**. None of the allowance objects exist (`model_catalog.free_allowance_*`, `jobs.free_allowance`).
- `pg_cron` is installed. `sana-1.5-4.8b` (the cheapest image model, $0.01) and four chat models are active.
- `jobs_credits_check` is named exactly that on staging and production, so `0206` drops the old `credits > 0` rule correctly.
- Needed: **0205, 0206, 0207, in that order.** Not needed here: 0201 (starters are already active), 0202 and 0204 (the two staged video
  rows, which wait on the fal billing check), 0203 (chat delete). Apply them too if you want staging to match production.
- Everything is behind `FREE_ALLOWANCE_ENABLED`, `"false"` in `wrangler.jsonc`. Nothing changes for anyone until step 4.

**Order matters: database first, then deploy with the flag.** With the flag on, the Worker reads `free_allowance_per_day` and calls
`submit_free_job`; deployed before the SQL, every generation on a model would fail on the missing column.

## 1. Apply the three migrations (SQL editor, in this order)

Open https://supabase.com/dashboard/project/yrqzwqywxfesmbvhzjgj/sql/new and check the project name at the top left reads
`veyrnox.ai staging`. For each file, paste and Run. Expect "Success. No rows returned" each time.

```bash
cd ~/Documents/GitHub/Veyrnox.ai && git checkout main && git pull
pbcopy < packages/db/schema/supabase/0205_model_free_allowance.sql
```

Then the same for `0206_free_allowance_jobs.sql`, then `0207_reconcile_includes_free_allowance.sql`.

- 0205 adds two catalog columns (all rows get 0, so nothing is offered), the claims table and four service-role functions.
- 0206 adds `jobs.free_allowance`, relaxes the credits rule for such a job, adds `submit_free_job`, and replaces `ledger_refund`
  (the 0183 body plus the zero-credit branch). It is the one that touches the money path, so read its header first.
- 0207 reschedules the 03:17 `veyrnox-reconcile-balances` job with a sixth check.

## 2. Check it (read-only; Claude can run this too)

```sql
-- the new objects, and nothing offered yet
select count(*) filter (where free_allowance_per_day > 0) as offering from public.model_catalog;          -- 0
select count(*) from information_schema.columns where table_name = 'jobs' and column_name = 'free_allowance'; -- 1
select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'jobs_credits_or_free_check';     -- credits > 0 OR free_allowance
-- the functions are service-role only
select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('free_allowance_take','free_allowance_return','free_allowance_left','reconcile_free_allowance','submit_free_job');  -- all false
-- the healthy baselines
select * from public.reconcile_free_allowance();   -- zero rows
select * from public.reconcile_balances();         -- zero rows
-- the nightly job now includes the new check
select command ilike '%reconcile_free_allowance%' as has_check from cron.job where jobname = 'veyrnox-reconcile-balances';  -- true
```

## 3. Choose what to offer (SQL editor)

The table refuses a model that breaks the ADR's bounds (per-generation price, at most $0.05 a job, at most $1.00 a day of free
spend per model), so a typo fails loudly. Suggested start: one image model and one chat model, 3 a day each.

```sql
update public.model_catalog set free_allowance_per_day = 3, free_allowance_daily_budget = 100 where id = 'sana-1.5-4.8b';        -- $1.00 a day at most
update public.model_catalog set free_allowance_per_day = 3, free_allowance_daily_budget = 100 where id = 'chat-mistral-small';   -- $0.20 a day at most
select id, free_allowance_per_day, free_allowance_daily_budget, provider_cost_per_unit from public.model_catalog where free_allowance_per_day > 0;
select * from public.reconcile_free_allowance();   -- still zero rows (the total across models is far under $5 a day)
```

Chat covers a **plain reply only**: choosing Thinking, Web search or images makes that reply paid, by design (ADR-0069 addendum).

## 4. Build and deploy with the flag on

`wrangler deploy` ships whatever `.open-next` holds, so build a staging bundle first (see the staging builds lesson in
`chat-handoff-2026-10-05.md`), then deploy with the flag set for this deploy only:

```bash
cd ~/Documents/GitHub/Veyrnox.ai && git checkout main && git pull
APP_ENV=staging SUPABASE_URL=https://yrqzwqywxfesmbvhzjgj.supabase.co \
NEXT_PUBLIC_SUPABASE_URL=https://yrqzwqywxfesmbvhzjgj.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging publishable key from wrangler.jsonc> \
PUBLIC_HOST=https://veyrnox-ai-staging.al-jobson.workers.dev npm run build:worker
npx wrangler deploy --env staging --var FREE_ALLOWANCE_ENABLED:true
```

Rollback if anything looks wrong: `npx wrangler rollback <version-id> --env staging` (copy the id of the current version first with
`npx wrangler deployments list --env staging`). To turn the feature off without a rollback, redeploy without `--var`.

## 5. Walk it (needs a staging account that has its signup grant, so its email is confirmed)

Studio, `/app/create`:
- The `sana-1.5-4.8b` row shows `FREE · 3 left` in place of its credit price. The cost card reads `−0 cr` with `FREE · 3 LEFT TODAY`.
- Note the balance. Generate one image. It runs; the **balance does not change**; the row now says 2 left.
- Set IMAGES to 4 (`FREE · 2 OF 4`): the total reads the price of the 2 that are not free. Send it: balance drops by that, not by 4.
- With none left the row shows its credit price again, no banner, and a generation costs 1 Credit.
- `/app/library`: the free jobs say **FREE** (not `−1`); a paid one still shows `−1`.

Chat, `/app/chat` (`localStorage.veyrnox_chat = '1'`):
- `chat-mistral-small`: the button reads `Send free (3 left today)`. Send a plain message: the reply streams, the footer says Free, balance unchanged.
- Turn on Web search: the button goes back to a paid price (3 Credits) and the free count is untouched.
- Press Stop before any text appears: nothing is charged, and the free count goes back up by one.

Credits page, `/app/credits`: the usage meters count only paid generations, so free jobs add nothing.

## 6. Check it in the database (read-only; Claude can run this too)

```sql
-- free jobs: credits 0, flagged, and no ledger row
select j.id, j.model_id, j.credits, j.free_allowance, j.state, (select count(*) from public.ledger_entries l where l.job_id = j.id) as ledger_rows
from public.jobs j where j.free_allowance order by j.created_at desc limit 20;      -- ledger_rows 0 on every row
select state, count(*) from public.model_free_allowance_claims where day = (now() at time zone 'utc')::date group by state;
select * from public.reconcile_free_allowance();   -- zero rows
select * from public.reconcile_balances();         -- zero rows
select * from public.reconcile_free_credits();     -- zero rows
```

A free job that failed or was stopped has claim state `RETURNED` and job state `REFUNDED`; a finished one has `TAKEN` and `STORED`.

## 7. Clean up, and what comes after

- Set the allowance back to 0 when you are done testing:
  `update public.model_catalog set free_allowance_per_day = 0, free_allowance_daily_budget = 0 where free_allowance_per_day > 0;`
- Remove the `apply_migration` allow rule from `.claude/settings.local.json` if you added one; it covers every Supabase project.
- **Production** is a separate decision after this passes: `0204` (after the fal billing check) to `0207` through the
  `apply-migrations` workflow with your approval, then `FREE_ALLOWANCE_ENABLED` and the per-model values. The $5-a-day total
  across models is checked nightly by the sixth reconcile check; raise it only by a new decision after a week of real numbers.
