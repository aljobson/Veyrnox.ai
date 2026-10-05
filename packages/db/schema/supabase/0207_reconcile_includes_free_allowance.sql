-- The nightly reconcile also fails on free-allowance drift (ADR-0069).
-- Same job name and schedule as 0184; the body gains reconcile_free_allowance(), which returns zero rows when
-- no account is over its daily cap, no model is over its daily budget, and the total daily free spend across
-- models is at most $5 (0205). It is generated from the 0184 body, so the five existing checks are unchanged.
--
-- Not changed here: the reconciliation_snapshot table and the anon-callable reconcile_status() that the
-- reconcile-watch workflow reads. They have fixed columns and an external watcher, so adding a sixth is its
-- own decision. This job is the in-database alarm: a non-zero count makes it fail in cron.job_run_details.
--
-- Idempotent: the job is unscheduled and rescheduled by name.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN;
    END IF;

    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'veyrnox-reconcile-balances';

    PERFORM cron.schedule(
        'veyrnox-reconcile-balances',
        '17 3 * * *',
        $cmd$ DO $body$ DECLARE n INTEGER; f INTEGER; t INTEGER; u INTEGER; s INTEGER; a INTEGER; BEGIN SELECT count(*) INTO n FROM public.reconcile_balances(); SELECT count(*) INTO f FROM public.reconcile_free_credits(); SELECT count(*) INTO t FROM public.reconcile_top_ups(); SELECT count(*) INTO u FROM public.reconcile_failed_refunds(); SELECT count(*) INTO s FROM public.reconcile_subscription_credits(); SELECT count(*) INTO a FROM public.reconcile_free_allowance(); IF n > 0 OR f > 0 OR t > 0 OR u > 0 OR s > 0 OR a > 0 THEN RAISE EXCEPTION 'ledger reconcile drift: % balance, % free-credit users, % top-up problems, % unpaid failures, % subscription-credit users, % free-allowance problems', n, f, t, u, s, a; END IF; END $body$; $cmd$
    );
END $$;
