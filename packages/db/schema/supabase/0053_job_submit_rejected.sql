-- #117: record why a provider refused a submit.
--
-- A submit the provider rejects never gets a provider_job_id, so job_failed
-- (which finds the job by provider_job_id) cannot record an error_code, and
-- ledger_refund moves the job straight from DEBITED to REFUNDED with
-- error_code null. The seedance-2.0-fast live test on 2026-09-13 left exactly
-- that: REFUNDED, provider_job_id null, error_code null.
--
-- job_submit_rejected sets a typed error_code on the job while it is still
-- DEBITED and unsubmitted. It changes nothing else: no state change, no
-- ledger row. The Worker calls ledger_refund straight after, unchanged.
--
-- The code must match /^[a-z0-9_]{1,64}$/ (what /api/v1/jobs passes to the
-- client), so a vendor message can never be stored through this path.
--
-- Idempotent: CREATE OR REPLACE; a replay writes the same code, and a call on
-- a job that is no longer DEBITED is a no-op returning JOB_NOT_FOUND_OR_BAD_STATE.

CREATE OR REPLACE FUNCTION public.job_submit_rejected(
    p_job_id UUID,
    p_error_code TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job_id UUID;
BEGIN
    IF p_error_code IS NULL OR p_error_code !~ '^[a-z0-9_]{1,64}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ERROR_CODE');
    END IF;

    UPDATE public.jobs
    SET error_code = p_error_code, updated_at = now()
    WHERE id = p_job_id
      AND state = 'DEBITED'
      AND provider_job_id IS NULL
    RETURNING id INTO v_job_id;

    IF v_job_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND_OR_BAD_STATE');
    END IF;
    RETURN jsonb_build_object('ok', true, 'job_id', v_job_id);
END $$;

REVOKE ALL ON FUNCTION public.job_submit_rejected(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.job_submit_rejected(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.job_submit_rejected(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.job_submit_rejected(UUID, TEXT) TO service_role;
