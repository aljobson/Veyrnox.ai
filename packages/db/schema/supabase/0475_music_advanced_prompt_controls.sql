-- Two more provider-backed ACE-Step 1.5 controls. Both values are frozen on
-- the quote prompt before either candidate is debited. Style influence maps
-- 0..100 to fal's documented lm_cfg_scale 1..10; exclusions map to its
-- documented LM negative prompt. No other model may use these controls.

ALTER TABLE public.music_prompt_specs
    ADD COLUMN IF NOT EXISTS style_influence SMALLINT NULL
    CHECK (style_influence IS NULL OR style_influence BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS exclude_styles TEXT NULL
    CHECK (exclude_styles IS NULL OR char_length(exclude_styles) BETWEEN 1 AND 500);

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
       AND p_model_id IS DISTINCT FROM 'ace-step-1.5' THEN
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

CREATE OR REPLACE FUNCTION private.music_apply_variety_to_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_variety SMALLINT;
    v_style_influence SMALLINT;
    v_exclude_styles TEXT;
    v_temperature NUMERIC;
    v_style_guidance NUMERIC;
BEGIN
    IF NEW.endpoint IS DISTINCT FROM 'fal-ai/ace-step-1.5' THEN RETURN NEW; END IF;

    SELECT ps.variety, ps.style_influence, ps.exclude_styles
    INTO v_variety, v_style_influence, v_exclude_styles
    FROM public.music_generation_candidates c
    JOIN public.music_generation_requests r ON r.id = c.generation_request_id
    JOIN public.music_prompt_specs ps ON ps.id = r.prompt_spec_id
    WHERE c.job_id = NEW.job_id;

    IF v_variety IS NOT NULL THEN
        v_temperature := CASE
            WHEN v_variety <= 50 THEN round(v_variety::NUMERIC * 0.017, 2)
            ELSE round(0.85 + (v_variety - 50)::NUMERIC * 0.023, 2)
        END;
        NEW.payload := NEW.payload || jsonb_build_object('lm_temperature', v_temperature);
    END IF;
    IF v_style_influence IS NOT NULL THEN
        v_style_guidance := round(1 + v_style_influence::NUMERIC * 0.09, 2);
        NEW.payload := NEW.payload || jsonb_build_object('lm_cfg_scale', v_style_guidance);
    END IF;
    IF v_exclude_styles IS NOT NULL THEN
        NEW.payload := NEW.payload || jsonb_build_object('lm_negative_prompt', v_exclude_styles);
    END IF;
    RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT) TO service_role;
