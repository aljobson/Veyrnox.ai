-- Pending owner price decision D6 (staging probe + fal bill). No price invented.
INSERT INTO public.model_catalog (
  id,
  name,
  provider,
  provider_endpoint,
  modality,
  credits_5s,
  provider_cost_per_unit,
  gated_flag,
  active,
  updated_at,
  cost_unit,
  billing_seconds,
  chat_max_reply_tokens,
  chat_reasoning_effort,
  chat_thinking_effort,
  chat_thinking_max_reply_tokens,
  chat_thinking_extra_credits,
  chat_thinking_extra_cost,
  chat_web_extra_credits,
  chat_web_extra_cost,
  chat_images_extra_credits,
  chat_images_extra_cost,
  free_allowance_per_day,
  free_allowance_daily_budget,
  chat_research_extra_credits,
  chat_research_extra_cost,
  chat_research_write_max_tokens,
  chat_web_engine,
  chat_research_search_model,
  editor_render_rates,
  chat_long_text_extra_credits,
  chat_long_text_extra_cost
) SELECT
  'ace-step-loop',
  'ACE-Step loop (beat editor)',
  provider,
  provider_endpoint,
  modality,
  credits_5s,
  provider_cost_per_unit,
  gated_flag,
  false,
  updated_at,
  cost_unit,
  billing_seconds,
  chat_max_reply_tokens,
  chat_reasoning_effort,
  chat_thinking_effort,
  chat_thinking_max_reply_tokens,
  chat_thinking_extra_credits,
  chat_thinking_extra_cost,
  chat_web_extra_credits,
  chat_web_extra_cost,
  chat_images_extra_credits,
  chat_images_extra_cost,
  free_allowance_per_day,
  free_allowance_daily_budget,
  chat_research_extra_credits,
  chat_research_extra_cost,
  chat_research_write_max_tokens,
  chat_web_engine,
  chat_research_search_model,
  editor_render_rates,
  chat_long_text_extra_credits,
  chat_long_text_extra_cost
FROM public.model_catalog WHERE id='ace-step-1.5' ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.model_catalog WHERE id='ace-step-loop' AND active=false) <> 1 THEN
  RAISE EXCEPTION 'ace-step-loop must exist exactly once and remain inactive';
 END IF;
END $$;

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
       OR p_model_id NOT IN ('ace-step', 'ace-step-1.5', 'ace-step-loop') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    v_expected_endpoint := CASE p_model_id
        WHEN 'ace-step' THEN 'fal-ai/ace-step'
        WHEN 'ace-step-1.5' THEN 'fal-ai/ace-step-1.5'
        WHEN 'ace-step-loop' THEN 'fal-ai/ace-step-1.5'
    END;

    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    IF p_model_id IN ('ace-step-1.5', 'ace-step-loop') AND NOT private.music_paid_plan_active(v_user) THEN
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
REVOKE ALL ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_create_quote(
    p_auth_id TEXT,
    p_prompt TEXT,
    p_title TEXT,
    p_model_id TEXT,
    p_variety INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_result JSONB;
    v_prompt_spec_id UUID;
BEGIN
    IF p_variety IS NOT NULL AND (
        (p_model_id IS DISTINCT FROM 'ace-step-1.5' AND p_model_id IS DISTINCT FROM 'ace-step-loop')
        OR p_variety NOT BETWEEN 0 AND 100
    ) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;

    v_result := public.music_create_quote(p_auth_id, p_prompt, p_title, p_model_id);
    IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_result; END IF;

    SELECT q.prompt_spec_id INTO v_prompt_spec_id
    FROM public.music_generation_quotes q
    JOIN public.users u ON u.id = q.user_id
    WHERE q.id = (v_result->>'quote_id')::UUID
      AND u.auth_id = p_auth_id;
    IF v_prompt_spec_id IS NULL THEN
        RAISE EXCEPTION 'music quote prompt snapshot missing';
    END IF;

    UPDATE public.music_prompt_specs
    SET variety = p_variety
    WHERE id = v_prompt_spec_id;
    RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.music_create_quote(
    p_auth_id TEXT,
    p_prompt TEXT,
    p_title TEXT,
    p_model_id TEXT,
    p_variety INTEGER,
    p_style_influence INTEGER,
    p_exclude_styles TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_result JSONB;
    v_prompt_spec_id UUID;
    v_exclude_styles TEXT := NULLIF(btrim(p_exclude_styles), '');
BEGIN
    IF (p_style_influence IS NOT NULL OR v_exclude_styles IS NOT NULL)
       AND (p_model_id IS DISTINCT FROM 'ace-step-1.5' AND p_model_id IS DISTINCT FROM 'ace-step-loop') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    IF p_style_influence IS NOT NULL AND p_style_influence NOT BETWEEN 0 AND 100 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    IF v_exclude_styles IS NOT NULL AND char_length(v_exclude_styles) NOT BETWEEN 1 AND 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;

    v_result := public.music_create_quote(p_auth_id, p_prompt, p_title, p_model_id, p_variety);
    IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_result; END IF;

    SELECT q.prompt_spec_id INTO v_prompt_spec_id
    FROM public.music_generation_quotes q
    JOIN public.users u ON u.id = q.user_id
    WHERE q.id = (v_result->>'quote_id')::UUID
      AND u.auth_id = p_auth_id;
    IF v_prompt_spec_id IS NULL THEN RAISE EXCEPTION 'music quote prompt snapshot missing'; END IF;

    UPDATE public.music_prompt_specs
    SET style_influence = p_style_influence,
        exclude_styles = v_exclude_styles
    WHERE id = v_prompt_spec_id;
    RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT) TO service_role;

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
BEGIN
    IF p_duration_seconds IS NULL OR p_duration_seconds NOT BETWEEN 10 AND 60 THEN
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
    RETURN v_result || jsonb_build_object('duration_seconds', p_duration_seconds);
END $$;
REVOKE ALL ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.music_create_quote(
    p_auth_id TEXT,
    p_prompt TEXT,
    p_title TEXT,
    p_model_id TEXT,
    p_variety INTEGER,
    p_style_influence INTEGER,
    p_exclude_styles TEXT,
    p_duration_seconds INTEGER,
    p_bpm INTEGER,
    p_key_scale TEXT,
    p_time_signature TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_result JSONB;
    v_prompt_spec_id UUID;
BEGIN
    IF (p_bpm IS NOT NULL OR p_key_scale IS NOT NULL OR p_time_signature IS NOT NULL)
       AND (p_model_id IS DISTINCT FROM 'ace-step-1.5' AND p_model_id IS DISTINCT FROM 'ace-step-loop') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    IF (p_bpm IS NOT NULL AND p_bpm NOT BETWEEN 40 AND 220)
       OR (p_key_scale IS NOT NULL AND p_key_scale !~ '^(C|C#|D|D#|E|F|F#|G|G#|A|A#|B) (Major|Minor)$')
       OR (p_time_signature IS NOT NULL AND p_time_signature NOT IN ('2', '3', '4', '6')) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;

    v_result := public.music_create_quote(
        p_auth_id, p_prompt, p_title, p_model_id,
        p_variety, p_style_influence, p_exclude_styles, p_duration_seconds
    );
    IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_result; END IF;
    IF p_bpm IS NULL AND p_key_scale IS NULL AND p_time_signature IS NULL THEN RETURN v_result; END IF;

    SELECT q.prompt_spec_id INTO v_prompt_spec_id
    FROM public.music_generation_quotes q
    JOIN public.users u ON u.id = q.user_id
    WHERE q.id = (v_result->>'quote_id')::UUID
      AND u.auth_id = p_auth_id;
    IF v_prompt_spec_id IS NULL THEN RAISE EXCEPTION 'music quote prompt snapshot missing'; END IF;

    UPDATE public.music_prompt_specs
    SET bpm = p_bpm, key_scale = p_key_scale, time_signature = p_time_signature
    WHERE id = v_prompt_spec_id;
    RETURN v_result || jsonb_build_object('bpm', p_bpm, 'key_scale', p_key_scale, 'time_signature', p_time_signature);
END $$;
REVOKE ALL ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER,INTEGER,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER,INTEGER,TEXT,TEXT) TO service_role;

