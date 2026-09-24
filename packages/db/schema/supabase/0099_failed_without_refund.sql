-- A FAILED job with no refund is money kept for nothing (audit 2026-09-23).
--
-- job_failed does not refund: the Worker calls ledger_refund next. If that
-- one call fails (a transient PostgREST error is enough), the webhook answers
-- 500 and the provider redelivers -- but the step is no longer SUBMITTED, so
-- the orchestrator treats the redelivery as a replay and marks it processed.
-- The refund is never attempted again.
--
-- Nothing found it afterwards: sweep_stuck_jobs (0019) selects DEBITED,
-- SUBMITTED/FAILOVER and SUCCEEDED-without-asset, never FAILED; and
-- reconcile_balances() cannot see it, because the balance still equals the
-- sum of the ledger. This adds both halves -- a sweep that pays it, and a
-- reconcile row that shouts if one is ever left behind.
--
-- Idempotent: CREATE OR REPLACE, and the sweep keeps its 4-argument
-- signature so the cron's bare sweep_stuck_jobs() stays unambiguous.

-- ── the invariant: a settled FAILED job has a positive ledger row ────────
CREATE OR REPLACE FUNCTION public.reconcile_failed_refunds(p_grace_minutes INTEGER DEFAULT 60)
RETURNS TABLE (job_id UUID, user_id UUID, credits INTEGER, failed_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT j.id, j.user_id, j.credits, j.updated_at
    FROM public.jobs j
    WHERE j.state = 'FAILED'
      AND j.credits > 0
      AND j.updated_at < now() - make_interval(mins => p_grace_minutes)
      AND NOT EXISTS (
          SELECT 1 FROM public.ledger_entries le
          WHERE le.job_id = j.id AND le.delta > 0
      )
    ORDER BY j.updated_at;
$$;

REVOKE ALL ON FUNCTION public.reconcile_failed_refunds(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_failed_refunds(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.reconcile_failed_refunds(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_failed_refunds(INTEGER) TO service_role;

-- ── the sweep pays it ────────────────────────────────────────────────────
-- Same four arguments as 0019. A FAILED job needs no state change, only the
-- refund it never got; p_debited_minutes is its grace period, because the
-- refund normally lands in the same request as the failure.
-- Parameter names and order are 0019's exactly: CREATE OR REPLACE cannot
-- rename or reorder them, and the cron's bare call relies on the defaults.
CREATE OR REPLACE FUNCTION public.sweep_stuck_jobs(
    p_debited_minutes INTEGER DEFAULT 15,
    p_submitted_minutes INTEGER DEFAULT 120,
    p_limit INTEGER DEFAULT 200,
    p_succeeded_minutes INTEGER DEFAULT 60
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job RECORD;
    v_refunded INTEGER := 0;
    v_failed INTEGER := 0;
    v_unstored INTEGER := 0;
    v_unpaid INTEGER := 0;
    v_res JSONB;
BEGIN
    FOR v_job IN
        SELECT j.id, j.user_id, j.credits, j.state
        FROM public.jobs j
        WHERE (j.state = 'DEBITED' AND j.updated_at < now() - make_interval(mins => p_debited_minutes))
           OR (j.state IN ('SUBMITTED', 'FAILOVER') AND j.updated_at < now() - make_interval(mins => p_submitted_minutes))
           OR (j.state = 'SUCCEEDED'
               AND j.updated_at < now() - make_interval(mins => p_succeeded_minutes)
               AND NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = j.id))
           -- A failure whose refund never landed. ledger_refund is idempotent
           -- per job, so a race with a late retry pays once either way.
           OR (j.state = 'FAILED'
               AND j.credits > 0
               AND j.updated_at < now() - make_interval(mins => p_debited_minutes)
               AND NOT EXISTS (SELECT 1 FROM public.ledger_entries le
                               WHERE le.job_id = j.id AND le.delta > 0))
        ORDER BY j.updated_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    LOOP
        IF v_job.state IN ('SUBMITTED', 'FAILOVER') THEN
            UPDATE public.jobs
            SET state = 'FAILED', error_code = 'stuck_timeout', updated_at = now()
            WHERE id = v_job.id;
            v_failed := v_failed + 1;
        ELSIF v_job.state = 'SUCCEEDED' THEN
            -- ledger_refund refuses a SUCCEEDED job (code JOB_SUCCEEDED):
            -- the provider did the work, so only a job we have decided we
            -- cannot deliver may be refunded. Record that decision first.
            UPDATE public.jobs
            SET state = 'FAILED', error_code = 'asset_store_failed', updated_at = now()
            WHERE id = v_job.id;
            v_unstored := v_unstored + 1;
        ELSIF v_job.state = 'FAILED' THEN
            v_unpaid := v_unpaid + 1;
        END IF;

        v_res := public.ledger_refund(v_job.id, v_job.user_id, v_job.credits,
                                      CASE v_job.state
                                          WHEN 'DEBITED' THEN 'refund:stuck_debited'
                                          WHEN 'SUCCEEDED' THEN 'refund:asset_store_failed'
                                          WHEN 'FAILED' THEN 'refund:failed_unpaid'
                                          ELSE 'refund:stuck_submitted'
                                      END);
        IF (v_res->>'ok')::boolean AND NOT COALESCE((v_res->>'idempotent')::boolean, false) THEN
            v_refunded := v_refunded + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'failed', v_failed, 'unstored', v_unstored,
                              'unpaid_failures', v_unpaid, 'refunded', v_refunded);
END $$;

REVOKE ALL ON FUNCTION public.sweep_stuck_jobs(INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sweep_stuck_jobs(INTEGER, INTEGER, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.sweep_stuck_jobs(INTEGER, INTEGER, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stuck_jobs(INTEGER, INTEGER, INTEGER, INTEGER) TO service_role;
