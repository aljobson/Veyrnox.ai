-- Validate the final stored payload before creating paid/free admission effects.
-- Preserve replay and capacity contracts; no operator policy or grant changes.
CREATE OR REPLACE FUNCTION public.admit_fal_dispatch(
    p_user_id UUID, p_idempotency_key TEXT, p_model_id TEXT, p_inputs JSONB,
    p_payload JSONB, p_endpoint TEXT, p_allow_free BOOLEAN DEFAULT false
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_job public.jobs%ROWTYPE;
    v_model public.model_catalog%ROWTYPE;
    v_result JSONB;
    v_balance INTEGER;
    v_policy public.fal_capacity_policy%ROWTYPE;
    v_day DATE := (statement_timestamp() AT TIME ZONE 'UTC')::date;
    v_held BIGINT; v_untracked BIGINT; v_daily BIGINT; v_cost BIGINT;
BEGIN
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$'
       OR p_inputs IS NULL OR jsonb_typeof(p_inputs) <> 'object' OR octet_length(p_inputs::text) > 16384
       OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR octet_length(p_payload::text) > 16384
       OR p_inputs ?| ARRAY['source_keys','source_assets','edit'] THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    -- Same serialization boundary as ledger_debit and submit_free_job. A replay
    -- never locks/changes the old job, and never upgrades a legacy job into dispatch.
    SELECT balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW'); END IF;
    SELECT * INTO v_job FROM public.jobs WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_job.model_id IS DISTINCT FROM p_model_id OR v_job.inputs IS DISTINCT FROM p_inputs
           OR EXISTS (SELECT 1 FROM public.fal_dispatch d WHERE d.job_id = v_job.id
                      AND (d.payload IS DISTINCT FROM CASE WHEN EXISTS (
                          SELECT 1 FROM public.fal_capacity_reservations r WHERE r.job_id = v_job.id)
                          THEN p_payload || '{"image_size":{"width":1024,"height":768}}'::jsonb
                          ELSE p_payload END
                          OR (EXISTS (SELECT 1 FROM public.fal_capacity_reservations r WHERE r.job_id = v_job.id)
                              AND p_payload - ARRAY['prompt','seed'] <> '{}'::jsonb) OR d.endpoint IS DISTINCT FROM p_endpoint)) THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
        END IF;
        RETURN jsonb_build_object('ok', true, 'job_id', v_job.id, 'idempotent', true,
            'state', v_job.state, 'free', v_job.free_allowance, 'balance_after', v_balance);
    END IF;
    SELECT * INTO v_model FROM public.model_catalog WHERE id = p_model_id FOR SHARE;
    IF NOT FOUND OR NOT v_model.active OR v_model.gated_flag OR v_model.provider <> 'fal'
       OR v_model.modality <> 'text-to-image' OR v_model.provider_endpoint IS DISTINCT FROM p_endpoint
       OR v_model.credits_5s IS NULL OR v_model.credits_5s <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'MODEL_UNAVAILABLE');
    END IF;
    -- Existing replay above remains valid even when this policy is paused.
    -- This helper holds no job/balance locks; completed reservations can drain.
    PERFORM public.release_fal_capacity(25);
    SELECT * INTO v_policy FROM public.fal_capacity_policy WHERE singleton FOR UPDATE;
    IF NOT FOUND OR NOT v_policy.enabled THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_ADMISSION_PAUSED', 'retry_after_seconds', 60);
    END IF;
    IF p_model_id IS DISTINCT FROM v_policy.model_id OR p_endpoint <> 'fal-ai/flux-2-pro'
       OR v_model.provider_cost_per_unit IS DISTINCT FROM 0.03::numeric
       OR p_payload - ARRAY['prompt','seed'] <> '{}'::jsonb
       OR jsonb_typeof(p_payload->'prompt') IS DISTINCT FROM 'string'
       OR btrim(p_payload->>'prompt') = '' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'MODEL_UNAVAILABLE');
    END IF;
    SELECT count(*) INTO v_held FROM public.fal_capacity_reservations WHERE released_at IS NULL;
    -- Older outbox work is not grandfathered out of the admission bound.
    SELECT count(*) INTO v_untracked FROM public.fal_dispatch d JOIN public.jobs j ON j.id = d.job_id
    WHERE NOT EXISTS (SELECT 1 FROM public.fal_capacity_reservations r WHERE r.job_id = d.job_id)
      AND (d.state IN ('READY','STARTED','UNKNOWN') OR (d.state = 'ACCEPTED'
          AND NOT (j.state = 'STORED' AND d.provider_job_id IS NOT NULL
              AND j.provider_job_id IS NOT DISTINCT FROM d.provider_job_id)));
    SELECT count(*), COALESCE(sum(cost_microusd),0) INTO v_daily, v_cost
    FROM public.fal_capacity_reservations WHERE admission_day = v_day;
    IF v_held + v_untracked >= v_policy.outstanding_limit OR v_daily >= v_policy.daily_limit
       OR v_cost + 30000 > v_policy.daily_budget_microusd THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_CAPACITY_UNAVAILABLE', 'retry_after_seconds', 60);
    END IF;
    -- Size is pinned by this transaction; only prompt/seed inputs are admitted.
    p_payload := p_payload || '{"image_size":{"width":1024,"height":768}}'::jsonb;
    IF octet_length(p_payload::text) > 16384 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    IF p_allow_free THEN
        v_result := private.submit_free_job_for_admission(p_user_id, p_idempotency_key, p_model_id, p_inputs, 10, 60, true);
        IF v_result->>'ok' = 'false' THEN RETURN v_result; END IF;
    END IF;
    IF v_result IS NULL OR v_result->>'taken' IS DISTINCT FROM 'true' THEN
        v_result := private.ledger_debit_for_admission(p_user_id, p_idempotency_key, v_model.credits_5s,
            'debit:generation', p_model_id, p_inputs, 10, 60, true);
    END IF;
    IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_result; END IF;
    -- Any failure here rolls back the job AND debit/allowance in this RPC.
    INSERT INTO public.fal_dispatch(job_id, endpoint, payload)
    VALUES ((v_result->>'job_id')::uuid, p_endpoint, p_payload);
    INSERT INTO public.fal_capacity_reservations(job_id, admission_day, cost_microusd)
    VALUES ((v_result->>'job_id')::uuid, v_day, 30000);
    SELECT balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id = p_user_id;
    RETURN v_result || jsonb_build_object('state', 'DEBITED', 'balance_after', v_balance,
        'free', COALESCE((v_result->>'taken')::boolean, false));
END $$;
REVOKE ALL ON FUNCTION public.admit_fal_dispatch(UUID,TEXT,TEXT,JSONB,JSONB,TEXT,BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_fal_dispatch(UUID,TEXT,TEXT,JSONB,JSONB,TEXT,BOOLEAN) TO service_role;
