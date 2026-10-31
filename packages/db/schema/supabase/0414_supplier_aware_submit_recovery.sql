-- Supplier-aware ambiguous-submit holding and reconciliation (assessment F-14,
-- ADR-0307).
--
-- 0329's sweep_stuck_jobs (DEBITED hold) and reconcile_provider_submit_unknown
-- both key the "an ambiguous submit may be held by the supplier, do not
-- auto-refund it" decision on a provider_spend_reservation found by the
-- ORIGINAL unsuffixed key AND a hard-coded supplier set
-- ('grsai','fal','kie','openrouter'). Two gaps:
--
--   * Crun is now the primary supplier for routed models (0380) and is not in
--     that list. A Crun job that answers ambiguously (outcome unknown) is held
--     on nothing, so sweep_stuck_jobs refunds it after 15 minutes while Crun
--     may have accepted and billed it; reconcile_provider_submit_unknown then
--     cannot resolve it either (same list), so it is rejected. Veyrnox-provider
--     jobs had the same hole.
--   * Submit-phase failover (0373/0376) reserves each later attempt under a
--     SUFFIXED key (`<idempotency_key>:aN`) with that attempt's supplier. The
--     recovery read only the unsuffixed key, so a job whose ambiguous answer
--     came from a failover attempt was matched against the first supplier's
--     reservation — reconciled to the wrong supplier, or not held at all.
--
-- Fix: base both decisions on the job's ACTUAL attempt. Hold a
-- provider_outcome_unknown DEBITED job whenever it has ANY job reservation —
-- its own key or any failover suffix — for ANY supplier; and reconcile against
-- the LAST reserved supplier (max admitted_at), which is the attempt whose
-- answer was ambiguous. No hard-coded list, Crun included, suffixed keys
-- handled. starts_with() matches the failover prefix literally so an
-- underscore in an idempotency key cannot act as a LIKE wildcard.
--
-- This also carries F-13's NULL-safe predicate (error_code IS NOT DISTINCT FROM
-- 'provider_outcome_unknown', ADR-0306 / migration 0409), so a 0414 that lands
-- after 0409 keeps that fix and a 0414 that lands without it still has it. Both
-- functions are CREATE OR REPLACE with the existing signatures (ACL preserved,
-- restated), idempotent, no catalog UPDATE. The hold change only ever holds
-- more ambiguous jobs (never refunds one it used to hold); reconciliation only
-- resolves jobs it previously could not. Safe under Worker-only rollback.

CREATE OR REPLACE FUNCTION public.reconcile_provider_submit_unknown(
    p_job_id UUID, p_outcome TEXT, p_provider_job_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.jobs%ROWTYPE; v_provider TEXT; v_result JSONB;
BEGIN
    IF p_outcome NOT IN ('ACCEPTED','REJECTED')
       OR (p_outcome = 'ACCEPTED' AND (p_provider_job_id IS NULL OR p_provider_job_id !~ '^[A-Za-z0-9._-]{1,128}$'))
       OR (p_outcome = 'REJECTED' AND p_provider_job_id IS NOT NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_OUTCOME');
    END IF;
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND OR v_job.state <> 'DEBITED' OR v_job.error_code IS DISTINCT FROM 'provider_outcome_unknown' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_RECONCILABLE');
    END IF;
    -- The supplier of the actual last attempt: the first attempt reserves under
    -- the job's own key, each failover attempt under `<key>:aN`. The newest
    -- reservation is the attempt whose answer was ambiguous. Any supplier,
    -- including Crun and Veyrnox.
    SELECT r.provider INTO v_provider
      FROM public.provider_spend_reservations r
     WHERE r.user_id = v_job.user_id
       AND (r.effect_key = v_job.idempotency_key OR starts_with(r.effect_key, v_job.idempotency_key || ':a'))
     ORDER BY r.admitted_at DESC
     LIMIT 1;
    IF v_provider IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_RECONCILABLE');
    END IF;
    IF p_outcome = 'ACCEPTED' THEN
        v_result := public.job_submitted(v_job.id, v_provider, p_provider_job_id);
        IF v_result->>'ok' = 'true' THEN
            UPDATE public.jobs SET error_code = NULL WHERE id = v_job.id;
        END IF;
        RETURN v_result;
    END IF;
    UPDATE public.jobs SET error_code = 'provider_submit_failed', updated_at = now() WHERE id = v_job.id;
    v_result := public.ledger_refund(v_job.id, v_job.user_id, v_job.credits, 'refund:submit_rejected_reconciled');
    RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.reconcile_provider_submit_unknown(UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_provider_submit_unknown(UUID,TEXT,TEXT) TO service_role;

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
               -- Hold (do not refund) an explicitly-ambiguous submit that still
               -- has a supplier reservation: its own key or any failover
               -- suffix, for ANY supplier (F-13 null-safe predicate, F-14
               -- supplier-agnostic + suffixed keys). A reconciler resolves it.
               AND NOT (j.error_code IS NOT DISTINCT FROM 'provider_outcome_unknown' AND EXISTS (
                   SELECT 1 FROM public.provider_spend_reservations r
                    WHERE r.user_id = j.user_id
                      AND (r.effect_key = j.idempotency_key OR starts_with(r.effect_key, j.idempotency_key || ':a')))))
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
