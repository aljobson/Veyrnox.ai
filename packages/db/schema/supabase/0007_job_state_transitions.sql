-- Slice 5 — job state transitions callable from the Worker via PostgREST.
--
-- Each transition is one atomic Postgres function. The Worker records
-- fal's provider job id and moves the job through the §25.7 state
-- machine:
--
--   PRICED (never used post-Slice-4 — debit goes straight to DEBITED)
--     → DEBITED (ledger_debit)
--     → SUBMITTED (job_submitted, after fal enqueue)
--     → SUCCEEDED (job_succeeded, on webhook success)
--     → STORED (job_stored, after R2 copy — Slice 7)
--     → FAILED (job_failed, on webhook fail; caller triggers refund + failover)
--     → REFUNDED (ledger_refund)

CREATE OR REPLACE FUNCTION public.job_submitted(
    p_job_id UUID,
    p_provider TEXT,
    p_provider_job_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_state TEXT;
BEGIN
    UPDATE public.jobs
    SET state = 'SUBMITTED',
        provider = p_provider,
        provider_job_id = p_provider_job_id,
        updated_at = now()
    WHERE id = p_job_id AND state = 'DEBITED'
    RETURNING state::text INTO v_state;

    IF v_state IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_STATE_FOR_SUBMIT');
    END IF;
    RETURN jsonb_build_object('ok', true, 'state', v_state);
END $$;

CREATE OR REPLACE FUNCTION public.job_succeeded(
    p_provider_job_id TEXT,
    p_provider TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_job_id UUID;
BEGIN
    UPDATE public.jobs
    SET state = 'SUCCEEDED', updated_at = now()
    WHERE provider = p_provider
      AND provider_job_id = p_provider_job_id
      AND state IN ('SUBMITTED', 'FAILOVER')
    RETURNING id INTO v_job_id;

    IF v_job_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND_OR_BAD_STATE');
    END IF;
    RETURN jsonb_build_object('ok', true, 'job_id', v_job_id);
END $$;

CREATE OR REPLACE FUNCTION public.job_failed(
    p_provider_job_id TEXT,
    p_provider TEXT,
    p_error_code TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job_id UUID;
    v_user_id UUID;
    v_credits INTEGER;
BEGIN
    UPDATE public.jobs
    SET state = 'FAILED', error_code = p_error_code, updated_at = now()
    WHERE provider = p_provider
      AND provider_job_id = p_provider_job_id
      AND state IN ('SUBMITTED', 'FAILOVER')
    RETURNING id, user_id, credits INTO v_job_id, v_user_id, v_credits;

    IF v_job_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND_OR_BAD_STATE');
    END IF;
    -- Return the refund-worthy info to the caller. The Worker calls
    -- ledger_refund next. Doing the refund here would couple two atomic
    -- units; keeping them separate lets the failover path (Phase 3)
    -- intercept without refunding.
    RETURN jsonb_build_object('ok', true,
                               'job_id', v_job_id,
                               'user_id', v_user_id,
                               'credits', v_credits);
END $$;

-- Permissions: service_role only. End users see job state via /api/v1/jobs
-- (future) which reads via read RPCs.
DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.job_submitted(UUID, TEXT, TEXT)',
        'public.job_succeeded(TEXT, TEXT)',
        'public.job_failed(TEXT, TEXT, TEXT)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
