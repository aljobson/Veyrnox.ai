-- ADR-0359 Amendment 1: ACE-Step 1.5 alone admits 10..180 seconds,
-- priced from the frozen catalog unit in 60-second blocks per take.
-- Product exposure remains gated in the app; no catalog or dispatch changes.

DO $$
DECLARE v_constraint RECORD;
BEGIN
    -- Find the original single-column CHECK by its definition, not its generated name.
    FOR v_constraint IN
        SELECT c.conname
        FROM pg_catalog.pg_constraint c
        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid
            AND a.attname = 'duration_seconds'
        WHERE c.conrelid = 'public.music_prompt_specs'::regclass AND c.contype = 'c'
          AND c.conkey = ARRAY[a.attnum]
          AND pg_catalog.regexp_replace(pg_catalog.pg_get_expr(c.conbin, c.conrelid),
              '[()[:space:]]', '', 'g') = 'duration_seconds>=10ANDduration_seconds<=60'
    LOOP
        EXECUTE format('ALTER TABLE public.music_prompt_specs DROP CONSTRAINT %I', v_constraint.conname);
    END LOOP;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.music_prompt_specs'::regclass
          AND conname = 'music_prompt_specs_duration_by_model_check'
    ) THEN
        ALTER TABLE public.music_prompt_specs
            ADD CONSTRAINT music_prompt_specs_duration_by_model_check CHECK (
                duration_seconds BETWEEN 10 AND 60
                OR (model_id = 'ace-step-1.5' AND duration_seconds BETWEEN 10 AND 180)
            );
    END IF;
END $$;

CREATE OR REPLACE FUNCTION private.music_duration_price_blocks(
    p_model_id TEXT, p_duration_seconds INTEGER
) RETURNS INTEGER
LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
    SELECT CASE WHEN p_model_id = 'ace-step-1.5'
        THEN ceil(p_duration_seconds / 60.0)::INTEGER ELSE 1 END;
$$;
REVOKE ALL ON FUNCTION private.music_duration_price_blocks(TEXT,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.music_duration_price_blocks(TEXT,INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.music_create_quote(
    p_auth_id TEXT,
    p_prompt TEXT,
    p_title TEXT,
    p_model_id TEXT,
    p_variety INTEGER,
    p_style_influence INTEGER,
    p_exclude_styles TEXT,
    p_duration_seconds INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_result JSONB;
    v_prompt_spec_id UUID;
    v_blocks INTEGER;
    v_base_unit INTEGER;
    v_new_unit INTEGER;
    v_max INTEGER;
    v_quote public.music_generation_quotes%ROWTYPE;
BEGIN
    v_max := CASE WHEN p_model_id = 'ace-step-1.5' THEN 180 ELSE 60 END;
    IF p_duration_seconds IS NULL OR p_duration_seconds NOT BETWEEN 10 AND v_max THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;

    v_result := public.music_create_quote(
        p_auth_id, p_prompt, p_title, p_model_id,
        p_variety, p_style_influence, p_exclude_styles
    );
    IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_result; END IF;

    SELECT q.prompt_spec_id INTO v_prompt_spec_id
    FROM public.music_generation_quotes q
    JOIN public.users u ON u.id = q.user_id
    WHERE q.id = (v_result->>'quote_id')::UUID
      AND u.auth_id = p_auth_id;
    IF v_prompt_spec_id IS NULL THEN RAISE EXCEPTION 'music quote prompt snapshot missing'; END IF;

    UPDATE public.music_prompt_specs
    SET duration_seconds = p_duration_seconds
    WHERE id = v_prompt_spec_id;
    v_blocks := private.music_duration_price_blocks(p_model_id, p_duration_seconds);
    IF v_blocks > 1 THEN
        SELECT q.unit_credits INTO v_base_unit
        FROM public.music_generation_quotes q
        JOIN public.users u ON u.id = q.user_id
        WHERE q.id = (v_result->>'quote_id')::UUID
          AND u.auth_id = p_auth_id AND q.consumed_at IS NULL
        FOR UPDATE OF q;
        IF NOT FOUND THEN RAISE EXCEPTION 'music quote price snapshot missing'; END IF;

        v_new_unit := v_base_unit * v_blocks;
        UPDATE public.music_generation_quotes q
        SET unit_credits = v_new_unit, total_credits = v_new_unit * q.output_count
        FROM public.users u
        WHERE q.id = (v_result->>'quote_id')::UUID
          AND u.id = q.user_id AND u.auth_id = p_auth_id AND q.consumed_at IS NULL
        RETURNING q.* INTO v_quote;
        IF NOT FOUND THEN RAISE EXCEPTION 'music quote price snapshot missing'; END IF;
        v_result := v_result || jsonb_build_object(
            'unit_credits', v_quote.unit_credits, 'total_credits', v_quote.total_credits,
            'balance_after', (v_result->>'balance')::INTEGER - v_quote.total_credits,
            'affordable', (v_result->>'balance')::INTEGER >= v_quote.total_credits
        );
    END IF;
    RETURN v_result || jsonb_build_object('duration_seconds', p_duration_seconds);
END $$;
REVOKE ALL ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.music_create_custom_quote(
    p_auth_id TEXT,
    p_draft_revision INTEGER,
    p_instrumental BOOLEAN,
    p_rights_confirmed BOOLEAN,
    p_duration_seconds INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_draft public.music_lyric_drafts%ROWTYPE;
    v_result JSONB;
    v_prompt_spec_id UUID;
BEGIN
    IF p_draft_revision IS NULL OR p_draft_revision < 0 OR p_instrumental IS NULL
       OR (p_instrumental AND p_rights_confirmed IS DISTINCT FROM false)
       OR (NOT p_instrumental AND p_rights_confirmed IS DISTINCT FROM true)
       OR p_duration_seconds IS NULL OR p_duration_seconds NOT BETWEEN 10 AND 180 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    SELECT * INTO v_draft FROM public.music_lyric_drafts
    WHERE user_id = v_user AND revision = p_draft_revision FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'REVISION_CONFLICT'); END IF;
    IF v_draft.model_id IS DISTINCT FROM 'ace-step-1.5'
       OR char_length(btrim(v_draft.styles)) NOT BETWEEN 1 AND 500
       OR (NOT p_instrumental AND char_length(btrim(v_draft.lyrics)) NOT BETWEEN 1 AND 3000) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;

    v_result := public.music_create_quote(
        p_auth_id, btrim(v_draft.styles), NULLIF(btrim(v_draft.title), ''), 'ace-step-1.5',
        NULL, NULL, NULL, p_duration_seconds
    );
    IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_result; END IF;
    SELECT prompt_spec_id INTO v_prompt_spec_id FROM public.music_generation_quotes
    WHERE id = (v_result->>'quote_id')::UUID AND user_id = v_user;
    IF v_prompt_spec_id IS NULL THEN RAISE EXCEPTION 'music custom quote prompt snapshot missing'; END IF;

    UPDATE public.music_prompt_specs SET
        mode = 'custom', instrumental = p_instrumental, schema_version = 'music-custom-v1',
        lyrics = CASE WHEN p_instrumental THEN NULL ELSE v_draft.lyrics END,
        styles = v_draft.styles, draft_revision = v_draft.revision,
        lyrics_rights_version = CASE WHEN p_instrumental THEN NULL ELSE 'music-lyrics-rights-v1' END
    WHERE id = v_prompt_spec_id;
    RETURN v_result || jsonb_build_object(
        'mode', 'custom', 'draft_revision', v_draft.revision, 'instrumental', p_instrumental
    );
END $$;

REVOKE ALL ON FUNCTION public.music_create_custom_quote(TEXT,INTEGER,BOOLEAN,BOOLEAN,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_custom_quote(TEXT,INTEGER,BOOLEAN,BOOLEAN,INTEGER) TO service_role;

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
       OR v_model.provider_endpoint <> v_expected_endpoint OR v_model.credits_5s *
           private.music_duration_price_blocks(v_quote.model_id, v_prompt.duration_seconds) <> v_quote.unit_credits
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
            WHEN 'ace-step' THEN jsonb_build_object('tags', v_prompt.prompt, 'duration', v_prompt.duration_seconds)
            WHEN 'ace-step-1.5' THEN jsonb_build_object(
                'prompt', v_prompt.prompt, 'duration', v_prompt.duration_seconds, 'thinking', true, 'num_outputs', 1)
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
