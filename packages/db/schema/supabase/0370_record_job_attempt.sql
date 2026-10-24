-- 0370 — record_job_attempt: write attempt 1 of a job (ADR-0256, phase 1).
--
-- After a provider accepts a job and job_submitted has stored the supplier job
-- id, the generation route records which route served it: one job_attempts row,
-- attempt 1, outcome 'submitted', with the route's recorded cost at that moment.
-- Phase 1 has one route per offer, so this changes nothing about how a job runs;
-- it starts the attempt log that failover (phase 2) will extend.
--
-- Safety: the function only inserts. It checks that the job exists, that its
-- stored provider_job_id equals the one passed in (so a stale or wrong id is
-- refused), and that the route belongs to the job's model. A second call for the
-- same job is a no-op (UNIQUE (job_id, attempt_no) with DO NOTHING). The caller
-- treats any failure as non-fatal: the job already runs on jobs.provider_job_id.
--
-- Service-role only: explicit REVOKE, then GRANT EXECUTE (CLAUDE.md).
-- Idempotent: CREATE OR REPLACE; REVOKE and GRANT re-run.
-- Rollback: DROP FUNCTION public.record_job_attempt(uuid, uuid, text).

CREATE OR REPLACE FUNCTION public.record_job_attempt(
    p_job_id uuid, p_route_id uuid, p_supplier_job_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    j public.jobs%ROWTYPE;
    r public.model_routes%ROWTYPE;
    n integer;
BEGIN
    SELECT * INTO j FROM public.jobs WHERE id = p_job_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'job_not_found'); END IF;
    IF j.provider_job_id IS DISTINCT FROM p_supplier_job_id THEN
        RETURN jsonb_build_object('ok', false, 'code', 'supplier_job_mismatch');
    END IF;
    SELECT * INTO r FROM public.model_routes WHERE id = p_route_id;
    IF NOT FOUND OR r.model_id <> j.model_id THEN
        RETURN jsonb_build_object('ok', false, 'code', 'route_not_for_job');
    END IF;
    INSERT INTO public.job_attempts (job_id, attempt_no, route_id, supplier_job_id, outcome, cost_snapshot)
    VALUES (p_job_id, 1, p_route_id, p_supplier_job_id, 'submitted', r.cost_per_unit)
    ON CONFLICT (job_id, attempt_no) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'inserted', n = 1);
END;
$$;

REVOKE ALL ON FUNCTION public.record_job_attempt(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_job_attempt(uuid, uuid, text) TO service_role;
