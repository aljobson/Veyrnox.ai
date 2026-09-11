-- Security audit 2026-09-11, M5: CLAUDE.md requires a nightly reconcile
-- (credit_balances.balance = SUM(ledger_entries.delta), zero rows in prod)
-- and every debit to have a refund path. Nothing ran either: jobs stuck in
-- DEBITED (fal never got the submit, or job_submitted failed after fal
-- accepted) or SUBMITTED (callback never arrived) held credits forever.
--
-- reconcile_balances()  — rows where the materialised balance drifted.
-- sweep_stuck_jobs()    — refunds DEBITED jobs older than p_debited_minutes
--                         and fails+refunds SUBMITTED/FAILOVER jobs older
--                         than p_submitted_minutes, via ledger_refund so
--                         the ledger stays the single writer.
--
-- Both run on pg_cron. Idempotent: CREATE OR REPLACE + cron.unschedule guard.

CREATE OR REPLACE FUNCTION public.reconcile_balances()
RETURNS TABLE (user_id UUID, balance INTEGER, ledger_sum BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT b.user_id, b.balance, COALESCE(l.total, 0) AS ledger_sum
    FROM public.credit_balances b
    LEFT JOIN (
        SELECT user_id, SUM(delta) AS total FROM public.ledger_entries GROUP BY user_id
    ) l ON l.user_id = b.user_id
    WHERE b.balance <> COALESCE(l.total, 0);
$$;

CREATE OR REPLACE FUNCTION public.sweep_stuck_jobs(
    p_debited_minutes INTEGER DEFAULT 15,
    p_submitted_minutes INTEGER DEFAULT 120,
    p_limit INTEGER DEFAULT 200
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job RECORD;
    v_refunded INTEGER := 0;
    v_failed INTEGER := 0;
    v_res JSONB;
BEGIN
    FOR v_job IN
        SELECT id, user_id, credits, state
        FROM public.jobs
        WHERE (state = 'DEBITED' AND updated_at < now() - make_interval(mins => p_debited_minutes))
           OR (state IN ('SUBMITTED', 'FAILOVER') AND updated_at < now() - make_interval(mins => p_submitted_minutes))
        ORDER BY updated_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    LOOP
        IF v_job.state IN ('SUBMITTED', 'FAILOVER') THEN
            UPDATE public.jobs
            SET state = 'FAILED', error_code = 'stuck_timeout', updated_at = now()
            WHERE id = v_job.id;
            v_failed := v_failed + 1;
        END IF;
        v_res := public.ledger_refund(v_job.id, v_job.user_id, v_job.credits,
                                      CASE WHEN v_job.state = 'DEBITED' THEN 'refund:stuck_debited' ELSE 'refund:stuck_submitted' END);
        IF (v_res->>'ok')::boolean AND NOT COALESCE((v_res->>'idempotent')::boolean, false) THEN
            v_refunded := v_refunded + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'failed', v_failed, 'refunded', v_refunded);
END $$;

DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.reconcile_balances()',
        'public.sweep_stuck_jobs(INTEGER, INTEGER, INTEGER)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;

-- Sweeper every 10 minutes; reconcile nightly. A non-empty reconcile result
-- is the alert condition — surface it via `wrangler tail` / a dashboard on
-- cron.job_run_details, or a follow-up that writes rows to an alerts table.
DO $$
BEGIN
    PERFORM cron.unschedule('veyrnox-sweep-stuck-jobs') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'veyrnox-sweep-stuck-jobs');
    PERFORM cron.unschedule('veyrnox-reconcile-balances') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'veyrnox-reconcile-balances');
END $$;

SELECT cron.schedule(
    'veyrnox-sweep-stuck-jobs',
    '*/10 * * * *',
    $$ SELECT public.sweep_stuck_jobs(); $$
);

SELECT cron.schedule(
    'veyrnox-reconcile-balances',
    '17 3 * * *',
    $$ DO $body$ DECLARE n INTEGER; BEGIN SELECT count(*) INTO n FROM public.reconcile_balances(); IF n > 0 THEN RAISE WARNING 'ledger reconcile drift: % users', n; END IF; END $body$; $$
);
