-- Event-driven dispatch prerequisite: targeted and cron claims share one fence.
-- No queue provisioning, new admission path, or provider retry.
CREATE OR REPLACE FUNCTION public.claim_fal_dispatch(p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.jobs%ROWTYPE; v_dispatch public.fal_dispatch%ROWTYPE;
BEGIN
    SELECT j.* INTO v_job FROM public.jobs j JOIN public.fal_dispatch d ON d.job_id = j.id
    WHERE j.id = p_job_id FOR UPDATE OF j SKIP LOCKED;
    IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM public.jobs j JOIN public.fal_dispatch d ON d.job_id = j.id WHERE j.id = p_job_id) THEN
            RETURN jsonb_build_object('disposition', 'BUSY');
        END IF;
        RETURN jsonb_build_object('disposition', 'MISSING');
    END IF;
    -- Keep the job-before-outbox lock order. An independently locked outbox
    -- row must not turn a skipped claim into an apparently terminal result.
    SELECT * INTO v_dispatch FROM public.fal_dispatch WHERE job_id = p_job_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN RETURN jsonb_build_object('disposition', 'BUSY'); END IF;
    IF v_dispatch.state <> 'READY' OR v_job.state <> 'DEBITED' OR v_job.provider_job_id IS NOT NULL THEN
        RETURN jsonb_build_object('disposition', 'INELIGIBLE');
    END IF;
    IF v_job.updated_at <= now() - interval '14 minutes' THEN
        RETURN jsonb_build_object('disposition', 'EXPIRED');
    END IF;
    UPDATE public.fal_dispatch SET state = 'STARTED', started_at = now(), attempt_token = gen_random_uuid()
    WHERE job_id = p_job_id AND state = 'READY' RETURNING * INTO v_dispatch;
    IF NOT FOUND THEN RETURN jsonb_build_object('disposition', 'INELIGIBLE'); END IF;
    RETURN jsonb_build_object('disposition', 'CLAIMED', 'job_id', p_job_id,
        'attempt_token', v_dispatch.attempt_token, 'endpoint', v_dispatch.endpoint, 'payload', v_dispatch.payload);
END $$;
REVOKE ALL ON FUNCTION public.claim_fal_dispatch(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_fal_dispatch(UUID) TO service_role;

-- Preserve the existing no-argument RPC and response shape for the cron.
CREATE OR REPLACE FUNCTION public.start_fal_dispatch()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job UUID; v_claim JSONB;
BEGIN
    SELECT j.id INTO v_job FROM public.jobs j JOIN public.fal_dispatch d ON d.job_id = j.id
    WHERE d.state = 'READY' AND j.state = 'DEBITED' AND j.provider_job_id IS NULL
      AND j.updated_at > now() - interval '14 minutes'
    ORDER BY d.created_at, d.job_id LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_claim := public.claim_fal_dispatch(v_job);
    IF v_claim->>'disposition' IS DISTINCT FROM 'CLAIMED' THEN RETURN NULL; END IF;
    RETURN v_claim - 'disposition';
END $$;
REVOKE ALL ON FUNCTION public.start_fal_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_fal_dispatch() TO service_role;
