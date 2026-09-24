-- The hourly watcher and the nightly reconcile learn about unpaid failures
-- (audit 2026-09-23; the sweep and the invariant itself are in 0099).
--
-- Split from 0099 so the sweep can be tested on its own chain: this file
-- touches reconcile_status, whose body references every other reconcile
-- function, and the pg_cron entry.
--
-- Idempotent: DROP ... IF EXISTS then CREATE, and the cron entry is
-- unscheduled by name before it is rescheduled.

-- ── the hourly watcher sees it ───────────────────────────────────────────
-- The return type gains a column, so the old function is dropped first.
-- Counts only, like 0072: how many, never whose.
DROP FUNCTION IF EXISTS public.reconcile_status();

CREATE OR REPLACE FUNCTION public.reconcile_status()
RETURNS TABLE (balance_drift INTEGER, free_credit_drift INTEGER, top_up_drift INTEGER, failed_refund_drift INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        (SELECT count(*) FROM public.reconcile_balances())::INTEGER,
        (SELECT count(*) FROM public.reconcile_free_credits())::INTEGER,
        (SELECT count(*) FROM public.reconcile_top_ups())::INTEGER,
        (SELECT count(*) FROM public.reconcile_failed_refunds())::INTEGER;
$$;

REVOKE ALL ON FUNCTION public.reconcile_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_status() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_status() TO anon, service_role;

-- ── the nightly reconcile fails on it ────────────────────────────────────
-- Same job name and schedule as 0037/0065; the body gains the fourth check.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN;
    END IF;

    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'veyrnox-reconcile-balances';

    PERFORM cron.schedule(
        'veyrnox-reconcile-balances',
        '17 3 * * *',
        $cmd$ DO $body$ DECLARE n INTEGER; f INTEGER; t INTEGER; u INTEGER; BEGIN SELECT count(*) INTO n FROM public.reconcile_balances(); SELECT count(*) INTO f FROM public.reconcile_free_credits(); SELECT count(*) INTO t FROM public.reconcile_top_ups(); SELECT count(*) INTO u FROM public.reconcile_failed_refunds(); IF n > 0 OR f > 0 OR t > 0 OR u > 0 THEN RAISE EXCEPTION 'ledger reconcile drift: % balance, % free-credit users, % top-up problems, % unpaid failures', n, f, t, u; END IF; END $body$; $cmd$
    );
END $$;
