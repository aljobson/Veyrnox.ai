-- QA audit 2026-09-11: close the last debit-without-outcome hole.
--
-- 0022 sweeps DEBITED (never submitted) and SUBMITTED/FAILOVER (callback
-- never arrived). It does not cover SUCCEEDED: the fal callback verified,
-- the job moved SUBMITTED -> SUCCEEDED, and then the R2 copy failed for
-- good. That job holds the user's credits forever and /api/v1/jobs/:id
-- reports `running` for good, because only STORED means the asset exists.
--
-- The webhook now answers 500 when the R2 copy fails, so fal retries and
-- the unprocessed `webhook_events` row records the delivery. This sweep is
-- the backstop for when the retries are exhausted.
--
-- A SUCCEEDED job with an asset row cannot occur (job_stored writes the
-- row and the state together, 0009), so "no asset after the grace window"
-- means the copy never landed. Such a job is failed with
-- `asset_store_failed` and refunded through ledger_refund, which stays the
-- single writer and is idempotent per job.
--
-- Idempotent: CREATE OR REPLACE, and the new parameter has a default so
-- the existing `SELECT public.sweep_stuck_jobs();` cron entry is unchanged.

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
        END IF;

        v_res := public.ledger_refund(v_job.id, v_job.user_id, v_job.credits,
                                      CASE v_job.state
                                          WHEN 'DEBITED' THEN 'refund:stuck_debited'
                                          WHEN 'SUCCEEDED' THEN 'refund:asset_store_failed'
                                          ELSE 'refund:stuck_submitted'
                                      END);
        IF (v_res->>'ok')::boolean AND NOT COALESCE((v_res->>'idempotent')::boolean, false) THEN
            v_refunded := v_refunded + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'failed', v_failed, 'unstored', v_unstored, 'refunded', v_refunded);
END $$;

-- Every argument has a default, so leaving 0022's 3-argument version in
-- place would make the cron entry's bare `sweep_stuck_jobs()` ambiguous.
-- Drop it: the 4-argument version covers every case it did.
DROP FUNCTION IF EXISTS public.sweep_stuck_jobs(INTEGER, INTEGER, INTEGER);

REVOKE ALL ON FUNCTION public.sweep_stuck_jobs(INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sweep_stuck_jobs(INTEGER, INTEGER, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.sweep_stuck_jobs(INTEGER, INTEGER, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stuck_jobs(INTEGER, INTEGER, INTEGER, INTEGER) TO service_role;
