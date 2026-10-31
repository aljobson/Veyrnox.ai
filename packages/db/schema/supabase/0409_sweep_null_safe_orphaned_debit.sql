-- 0409_sweep_null_safe_orphaned_debit.sql
--
-- Security fix F-13 (ADR-0306). sweep_stuck_jobs (0329) was meant to refund an
-- ordinary orphaned DEBITED job after p_debited_minutes, and to HOLD only a job
-- explicitly marked error_code = 'provider_outcome_unknown' that still has a
-- supplier reservation (an ambiguous submit a human/reconciler must resolve).
--
-- The exclusion used `j.error_code = 'provider_outcome_unknown'`. For an ordinary
-- orphaned debit error_code IS NULL, so that comparison is NULL, and
-- `NULL AND EXISTS(reservation)` is NULL when a reservation exists -> the whole
-- DEBITED branch is NULL -> the row is never selected and the user is never
-- auto-refunded. A Worker that dies after the debit+reservation commit but before
-- submit therefore leaves a stuck debit that only manual recovery can clear.
--
-- Fix: compare with IS NOT DISTINCT FROM, which is NULL-safe. A NULL error_code
-- is "distinct from" the sentinel, so an ordinary orphaned debit is swept and
-- refunded; a genuine 'provider_outcome_unknown' job with a reservation is still
-- held. Only this one predicate changes; the rest of the function is 0329 verbatim.
--
-- Idempotent: CREATE OR REPLACE. No catalog UPDATE, so no ROW_COUNT assertion.
-- Same signature as 0329, so the ACL is preserved; the REVOKE/GRANT below is
-- restated for safety and is a no-op on replay.

CREATE OR REPLACE FUNCTION public.sweep_stuck_jobs(
    p_debited_minutes INTEGER DEFAULT 15,
    p_submitted_minutes INTEGER DEFAULT 120,
    p_limit INTEGER DEFAULT 200,
    p_succeeded_minutes INTEGER DEFAULT 60
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_job RECORD; v_refunded INTEGER := 0; v_failed INTEGER := 0;
    v_unstored INTEGER := 0; v_unpaid INTEGER := 0; v_res JSONB;
BEGIN
    FOR v_job IN
        SELECT j.id, j.user_id, j.credits, j.state
        FROM public.jobs j
        WHERE (j.state = 'DEBITED'
               AND j.updated_at < now() - make_interval(mins => p_debited_minutes)
               AND NOT (j.error_code IS NOT DISTINCT FROM 'provider_outcome_unknown' AND EXISTS (
                   SELECT 1 FROM public.provider_spend_reservations r
                    WHERE r.user_id = j.user_id AND r.effect_key = j.idempotency_key
                      AND r.provider IN ('grsai','fal','kie','openrouter'))))
           OR (j.state IN ('SUBMITTED', 'FAILOVER') AND j.updated_at < now() - make_interval(mins => p_submitted_minutes))
           OR (j.state = 'SUCCEEDED' AND j.updated_at < now() - make_interval(mins => p_succeeded_minutes)
               AND NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = j.id))
           OR (j.state = 'FAILED' AND j.credits > 0
               AND j.updated_at < now() - make_interval(mins => p_debited_minutes)
               AND NOT EXISTS (SELECT 1 FROM public.ledger_entries le WHERE le.job_id = j.id AND le.delta > 0))
        ORDER BY j.updated_at LIMIT p_limit FOR UPDATE OF j SKIP LOCKED
    LOOP
        IF v_job.state IN ('SUBMITTED', 'FAILOVER') THEN
            UPDATE public.jobs SET state = 'FAILED', error_code = 'stuck_timeout', updated_at = now() WHERE id = v_job.id;
            v_failed := v_failed + 1;
        ELSIF v_job.state = 'SUCCEEDED' THEN
            UPDATE public.jobs SET state = 'FAILED', error_code = 'asset_store_failed', updated_at = now() WHERE id = v_job.id;
            v_unstored := v_unstored + 1;
        ELSIF v_job.state = 'FAILED' THEN
            v_unpaid := v_unpaid + 1;
        END IF;
        v_res := public.ledger_refund(v_job.id, v_job.user_id, v_job.credits,
            CASE v_job.state WHEN 'DEBITED' THEN 'refund:stuck_debited'
                WHEN 'SUCCEEDED' THEN 'refund:asset_store_failed'
                WHEN 'FAILED' THEN 'refund:failed_unpaid' ELSE 'refund:stuck_submitted' END);
        IF (v_res->>'ok')::boolean AND NOT COALESCE((v_res->>'idempotent')::boolean, false) THEN
            v_refunded := v_refunded + 1;
        END IF;
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'failed', v_failed, 'unstored', v_unstored,
                              'unpaid_failures', v_unpaid, 'refunded', v_refunded);
END $$;

REVOKE ALL ON FUNCTION public.sweep_stuck_jobs(INTEGER,INTEGER,INTEGER,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stuck_jobs(INTEGER,INTEGER,INTEGER,INTEGER) TO service_role;
