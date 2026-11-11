-- Bounded duration control for both admitted Music endpoints. The providers
-- allow longer ranges, but this product tier deliberately caps at 60 seconds:
-- the existing catalog quote is priced for a 60-second candidate, so every
-- selectable shorter duration stays within that already quoted maximum cost.

ALTER TABLE public.music_prompt_specs
    ADD COLUMN IF NOT EXISTS duration_seconds SMALLINT NOT NULL DEFAULT 60
    CHECK (duration_seconds BETWEEN 10 AND 60);

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

CREATE OR REPLACE FUNCTION private.music_apply_variety_to_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_variety SMALLINT;
    v_style_influence SMALLINT;
    v_exclude_styles TEXT;
    v_duration_seconds SMALLINT;
    v_temperature NUMERIC;
    v_style_guidance NUMERIC;
BEGIN
    IF NEW.endpoint NOT IN ('fal-ai/ace-step', 'fal-ai/ace-step-1.5') THEN RETURN NEW; END IF;

    SELECT ps.variety, ps.style_influence, ps.exclude_styles, ps.duration_seconds
    INTO v_variety, v_style_influence, v_exclude_styles, v_duration_seconds
    FROM public.music_generation_candidates c
    JOIN public.music_generation_requests r ON r.id = c.generation_request_id
    JOIN public.music_prompt_specs ps ON ps.id = r.prompt_spec_id
    WHERE c.job_id = NEW.job_id;

    IF v_duration_seconds IS NOT NULL THEN
        NEW.payload := NEW.payload || jsonb_build_object('duration', v_duration_seconds);
    END IF;
    IF NEW.endpoint = 'fal-ai/ace-step-1.5' AND v_variety IS NOT NULL THEN
        v_temperature := CASE
            WHEN v_variety <= 50 THEN round(v_variety::NUMERIC * 0.017, 2)
            ELSE round(0.85 + (v_variety - 50)::NUMERIC * 0.023, 2)
        END;
        NEW.payload := NEW.payload || jsonb_build_object('lm_temperature', v_temperature);
    END IF;
    IF NEW.endpoint = 'fal-ai/ace-step-1.5' AND v_style_influence IS NOT NULL THEN
        v_style_guidance := round(1 + v_style_influence::NUMERIC * 0.09, 2);
        NEW.payload := NEW.payload || jsonb_build_object('lm_cfg_scale', v_style_guidance);
    END IF;
    IF NEW.endpoint = 'fal-ai/ace-step-1.5' AND v_exclude_styles IS NOT NULL THEN
        NEW.payload := NEW.payload || jsonb_build_object('lm_negative_prompt', v_exclude_styles);
    END IF;
    RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER) TO service_role;
