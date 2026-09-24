-- Make ledger drift visible to something that can shout about it.
--
-- veyrnox-reconcile-balances (0030) RAISEs when reconcile_balances,
-- reconcile_free_credits or reconcile_top_ups return a row. That failure
-- lands in cron.job_run_details and nowhere else: there is no pg_notify, no
-- webhook, no issue. CLAUDE.md calls a zero-row reconciliation the money
-- invariant, and today the only way to learn it broke is to go and look.
--
-- reconcile_status() returns the three counts and nothing else — no user
-- ids, no balances, no amounts, just how many rows are wrong. That lets
-- .github/workflows/reconcile-watch.yml read it hourly with the publishable
-- key and open an issue, the same shape as migration-ledger.yml and
-- fal-catalog-watch.yml, and keeps the service-role key out of Actions
-- (PR #61). Three integers is the smallest thing that can carry the alarm.
--
-- Idempotent: CREATE OR REPLACE, and the grants are safe to re-run.

CREATE OR REPLACE FUNCTION public.reconcile_status()
RETURNS TABLE (balance_drift INTEGER, free_credit_drift INTEGER, top_up_drift INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        (SELECT count(*) FROM public.reconcile_balances())::INTEGER,
        (SELECT count(*) FROM public.reconcile_free_credits())::INTEGER,
        (SELECT count(*) FROM public.reconcile_top_ups())::INTEGER;
$$;

REVOKE ALL ON FUNCTION public.reconcile_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_status() FROM authenticated;
-- anon, deliberately, and only for this counts-only shape: the watcher runs
-- in GitHub Actions with SUPABASE_ANON_KEY so no service-role key has to live
-- there. Same trade already made for catalog_watch() (0030) and
-- applied_migration_names() (0034). If the counts ever stop being counts,
-- revoke this and give the watcher a scoped secret instead.
--
-- AUDIT 2026-09-20, unresolved and deliberately left as-is.
--
-- The revoke condition above is written about the SHAPE of the output ("if
-- the counts ever stop being counts"). The cost of PRODUCING them is the
-- part that scales: each call runs three unbounded aggregates over
-- ledger_entries, from an unauthenticated caller, against the database that
-- also serves every generation. catalog_watch() and applied_migration_names()
-- carry the same anon grant but read small bounded tables, so that trade does
-- not transfer here.
--
-- Not changed in this migration because the watcher has no secret by design
-- (PR #61) and revoking anon would blind ledger monitoring until one is
-- added. The options, for whoever applies this:
--   a) accept it while the ledger is small, and revisit on row count;
--   b) give the watcher a scoped secret and revoke anon here;
--   c) have the hourly cron write a snapshot table with service_role and let
--      anon read only that — cheap, at the cost of up-to-an-hour staleness.
GRANT EXECUTE ON FUNCTION public.reconcile_status() TO anon, service_role;
