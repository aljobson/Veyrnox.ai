-- Add the already live-E2E-verified ACE-Step 1.5 catalog model to Music.
-- The higher-quality model is a paid-plan capability. Both quote creation and
-- the atomic submit boundary re-check the plan so a stale or forged browser
-- entitlement cannot spend against it.

ALTER TABLE public.music_generation_quotes
    DROP CONSTRAINT IF EXISTS music_generation_quotes_provider_endpoint_check;
ALTER TABLE public.music_generation_quotes
    ADD CONSTRAINT music_generation_quotes_provider_endpoint_check
    CHECK (provider_endpoint IN ('fal-ai/ace-step', 'fal-ai/ace-step-1.5'));

CREATE OR REPLACE FUNCTION private.music_paid_plan_active(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.credit_subscriptions s
        WHERE s.user_id = p_user_id
          AND s.status = 'active'
          AND s.current_period_end IS NOT NULL
          AND s.current_period_end > now()
    );
$$;
REVOKE ALL ON FUNCTION private.music_paid_plan_active(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.music_paid_plan_active(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.music_create_quote(
    p_auth_id TEXT,
    p_prompt TEXT,
    p_title TEXT DEFAULT NULL,
    p_model_id TEXT DEFAULT 'ace-step'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_model public.model_catalog%ROWTYPE;
    v_prompt UUID;
    v_quote public.music_generation_quotes%ROWTYPE;
    v_balance INTEGER;
    v_expected_endpoint TEXT;
BEGIN
    IF p_prompt IS NULL OR char_length(btrim(p_prompt)) NOT BETWEEN 1 AND 500
       OR (p_title IS NOT NULL AND char_length(btrim(p_title)) NOT BETWEEN 1 AND 80)
       OR p_model_id NOT IN ('ace-step', 'ace-step-1.5') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    v_expected_endpoint := CASE p_model_id
        WHEN 'ace-step' THEN 'fal-ai/ace-step'
        WHEN 'ace-step-1.5' THEN 'fal-ai/ace-step-1.5'
    END;

    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    IF p_model_id = 'ace-step-1.5' AND NOT private.music_paid_plan_active(v_user) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PLAN_UNAVAILABLE');
    END IF;
    IF (SELECT count(*) FROM public.music_generation_quotes
        WHERE user_id = v_user AND created_at > now() - interval '60 seconds') >= 20 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'retry_after_seconds', 60);
    END IF;

    SELECT * INTO v_model FROM public.model_catalog WHERE id = p_model_id;
    IF NOT FOUND OR NOT v_model.active OR v_model.gated_flag OR v_model.provider <> 'fal'
       OR v_model.modality <> 'text-to-audio' OR v_model.provider_endpoint <> v_expected_endpoint
       OR v_model.credits_5s IS NULL OR v_model.credits_5s <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'MODEL_UNAVAILABLE');
    END IF;

    SELECT balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id = v_user;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW'); END IF;

    INSERT INTO public.music_prompt_specs(user_id, model_id, title, prompt)
    VALUES (v_user, v_model.id, NULLIF(btrim(p_title), ''), btrim(p_prompt)) RETURNING id INTO v_prompt;
    INSERT INTO public.music_generation_quotes(
        user_id, prompt_spec_id, model_id, provider_endpoint, unit_credits,
        total_credits, catalog_updated_at, expires_at
    ) VALUES (
        v_user, v_prompt, v_model.id, v_model.provider_endpoint, v_model.credits_5s,
        v_model.credits_5s * 2, v_model.updated_at, now() + interval '5 minutes'
    ) RETURNING * INTO v_quote;
    RETURN jsonb_build_object('ok', true, 'quote_id', v_quote.id, 'model_id', v_quote.model_id,
        'unit_credits', v_quote.unit_credits, 'total_credits', v_quote.total_credits,
        'balance', v_balance, 'balance_after', v_balance - v_quote.total_credits,
        'affordable', v_balance >= v_quote.total_credits,
        'expires_at', v_quote.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.music_submit_pair(
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
    IF v_quote.model_id = 'ace-step-1.5' AND NOT private.music_paid_plan_active(v_user) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PLAN_UNAVAILABLE');
    END IF;
    v_expected_endpoint := CASE v_quote.model_id
        WHEN 'ace-step' THEN 'fal-ai/ace-step'
        WHEN 'ace-step-1.5' THEN 'fal-ai/ace-step-1.5'
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

REVOKE ALL ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_submit_pair(TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_submit_pair(TEXT,UUID,TEXT) TO service_role;
