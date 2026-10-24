-- 0372 — mark_job_attempt_outcome: close attempt 1 when a job settles (ADR-0256, phase 1b).
--
-- 0370 starts the attempt log (attempt 1, outcome 'submitted'). When the supplier
-- reports an outcome, the completion paths call this to move that row to
-- 'completed' or 'failed'. It is keyed by what every completion path already has,
-- the supplier and the supplier's own job id, and it only moves a row forward from
-- 'submitted', so a repeat or a late duplicate is a no-op.
--
-- It touches job_attempts only: not jobs, not the ledger, not credit balances. The
-- caller treats any failure as non-fatal.
--
-- Service-role only: explicit REVOKE, then GRANT EXECUTE (CLAUDE.md).
-- Idempotent: CREATE OR REPLACE; REVOKE and GRANT re-run.
-- Rollback: DROP FUNCTION public.mark_job_attempt_outcome(text, text, text).

CREATE OR REPLACE FUNCTION public.mark_job_attempt_outcome(
    p_provider text, p_supplier_job_id text, p_outcome text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE n integer;
BEGIN
    IF p_outcome NOT IN ('completed', 'failed') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_outcome');
    END IF;
    UPDATE public.job_attempts a
       SET outcome = p_outcome, updated_at = now()
      FROM public.model_routes r
     WHERE r.id = a.route_id
       AND r.supplier = p_provider
       AND a.supplier_job_id = p_supplier_job_id
       AND a.outcome = 'submitted';
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'updated', n);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_job_attempt_outcome(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_job_attempt_outcome(text, text, text) TO service_role;
