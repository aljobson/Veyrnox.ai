-- Same admission body as 0469, renamed by 0470; only model additions.
CREATE OR REPLACE FUNCTION private.music_submit_pair_unbounded(
    p_auth_id TEXT,
    p_quote_id UUID,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_balance INTEGER;
    v_recent INTEGER;
    v_quote public.music_generation_quotes%ROWTYPE;
    v_prompt public.music_prompt_specs%ROWTYPE;
    v_model public.model_catalog%ROWTYPE;
    v_request public.music_generation_requests%ROWTYPE;
    v_existing public.music_generation_requests%ROWTYPE;
    v_one JSONB;
    v_two JSONB;
    v_job_one UUID;
    v_job_two UUID;
    v_failure JSONB;
    v_payload JSONB;
    v_expected_endpoint TEXT;
BEGIN
    IF p_quote_id IS NULL OR p_idempotency_key IS NULL
       OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;

    SELECT * INTO v_existing FROM public.music_generation_requests
    WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_existing.quote_id IS DISTINCT FROM p_quote_id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
        END IF;
        SELECT COALESCE(jsonb_agg(c.job_id ORDER BY c.ordinal), '[]'::jsonb)
        INTO v_payload FROM public.music_generation_candidates c
        WHERE c.generation_request_id = v_existing.id;
        SELECT balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
        INTO v_balance FROM public.credit_balances WHERE user_id = v_user;
        RETURN jsonb_build_object('ok', true, 'request_id', v_existing.id, 'state', v_existing.status,
            'job_ids', v_payload, 'balance_after', v_balance, 'idempotent', true);
    END IF;

    SELECT balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id = v_user FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW'); END IF;
    IF EXISTS (SELECT 1 FROM public.users WHERE id = v_user AND frozen_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;

    SELECT * INTO v_quote FROM public.music_generation_quotes
    WHERE id = p_quote_id AND user_id = v_user FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF v_quote.consumed_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'QUOTE_ALREADY_USED'); END IF;
    IF v_quote.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'code', 'QUOTE_EXPIRED'); END IF;
    IF v_quote.model_id IN ('ace-step-1.5', 'ace-step-loop') AND NOT private.music_paid_plan_active(v_user) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PLAN_UNAVAILABLE');
    END IF;
    v_expected_endpoint := CASE v_quote.model_id
        WHEN 'ace-step' THEN 'fal-ai/ace-step'
        WHEN 'ace-step-1.5' THEN 'fal-ai/ace-step-1.5'
        WHEN 'ace-step-loop' THEN 'fal-ai/ace-step-1.5'
        ELSE NULL
    END;
    SELECT * INTO v_prompt FROM public.music_prompt_specs WHERE id = v_quote.prompt_spec_id AND user_id = v_user;
    SELECT * INTO v_model FROM public.model_catalog WHERE id = v_quote.model_id FOR SHARE;
    IF NOT FOUND OR v_expected_endpoint IS NULL OR NOT v_model.active OR v_model.gated_flag OR v_model.provider <> 'fal'
       OR v_model.modality <> 'text-to-audio' OR v_model.provider_endpoint <> v_quote.provider_endpoint
       OR v_model.provider_endpoint <> v_expected_endpoint OR v_model.credits_5s <> v_quote.unit_credits
       OR v_model.updated_at IS DISTINCT FROM v_quote.catalog_updated_at THEN
        RETURN jsonb_build_object('ok', false, 'code', 'QUOTE_STALE');
    END IF;
    IF v_balance < v_quote.total_credits THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_BALANCE');
    END IF;
    SELECT count(*) INTO v_recent FROM public.jobs
    WHERE user_id = v_user AND created_at > now() - interval '60 seconds';
    IF v_recent > 8 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'retry_after_seconds', 60);
    END IF;

    BEGIN
        INSERT INTO public.music_generation_requests(
            user_id, quote_id, prompt_spec_id, model_id, idempotency_key, credit_quote
        ) VALUES (
            v_user, v_quote.id, v_prompt.id, v_model.id, p_idempotency_key, v_quote.total_credits
        ) RETURNING * INTO v_request;

        v_one := public.ledger_debit(v_user, p_idempotency_key || '.1', v_quote.unit_credits,
            'debit:music_generation', v_model.id,
            jsonb_build_object('prompt', v_prompt.prompt, 'music_request_id', v_request.id, 'music_candidate_ordinal', 1), 0, 60);
        IF v_one->>'ok' IS DISTINCT FROM 'true' THEN
            v_failure := v_one; RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'music pair debit one refused';
        END IF;
        v_two := public.ledger_debit(v_user, p_idempotency_key || '.2', v_quote.unit_credits,
            'debit:music_generation', v_model.id,
            jsonb_build_object('prompt', v_prompt.prompt, 'music_request_id', v_request.id, 'music_candidate_ordinal', 2), 0, 60);
        IF v_two->>'ok' IS DISTINCT FROM 'true' THEN
            v_failure := v_two; RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'music pair debit two refused';
        END IF;
        v_job_one := (v_one->>'job_id')::uuid;
        v_job_two := (v_two->>'job_id')::uuid;

        INSERT INTO public.music_generation_candidates(user_id, generation_request_id, ordinal, job_id)
        VALUES (v_user, v_request.id, 1, v_job_one), (v_user, v_request.id, 2, v_job_two);
        v_payload := CASE v_model.id
            WHEN 'ace-step' THEN jsonb_build_object('tags', v_prompt.prompt, 'duration', 60)
            WHEN 'ace-step-1.5' THEN jsonb_build_object(
                'prompt', v_prompt.prompt, 'duration', 60, 'thinking', true, 'num_outputs', 1)
            WHEN 'ace-step-loop' THEN jsonb_build_object(
                'prompt', v_prompt.prompt, 'duration', 60, 'thinking', true, 'num_outputs', 1)
        END;
        INSERT INTO public.fal_dispatch(job_id, endpoint, payload)
        VALUES (v_job_one, v_quote.provider_endpoint, v_payload),
               (v_job_two, v_quote.provider_endpoint, v_payload);
        UPDATE public.music_generation_quotes SET consumed_at = now() WHERE id = v_quote.id;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        RETURN COALESCE(v_failure, jsonb_build_object('ok', false, 'code', 'PAIR_DEBIT_FAILED'));
    END;

    SELECT balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id = v_user;
    RETURN jsonb_build_object('ok', true, 'request_id', v_request.id, 'state', 'debited',
        'job_ids', jsonb_build_array(v_job_one, v_job_two), 'balance_after', v_balance,
        'idempotent', false);
END $$;
REVOKE ALL ON FUNCTION private.music_submit_pair_unbounded(TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated, service_role;
-- Internal helper remains inaccessible to service_role, as in 0470.
