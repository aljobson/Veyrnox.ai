-- Three more provider-backed ACE-Step 1.5 controls for a Simple quote: tempo (BPM),
-- musical key and time signature. fal's documented inputs for fal-ai/ace-step-1.5
-- are bpm (integer, auto when absent), key_scale ("C Major", "Am" style; auto when
-- empty) and time_signature ('2','3','4','6'; auto when empty). Every value is
-- frozen on the quote's prompt spec before either candidate is debited, exactly
-- like 0474-0476. Absent = the provider chooses, which keeps today's output.
-- No other model may use them, and none of them changes the price.

ALTER TABLE public.music_prompt_specs
    ADD COLUMN IF NOT EXISTS bpm SMALLINT NULL
        CHECK (bpm IS NULL OR bpm BETWEEN 40 AND 220),
    ADD COLUMN IF NOT EXISTS key_scale TEXT NULL
        CHECK (key_scale IS NULL OR key_scale ~ '^(C|C#|D|D#|E|F|F#|G|G#|A|A#|B) (Major|Minor)$'),
    ADD COLUMN IF NOT EXISTS time_signature TEXT NULL
        CHECK (time_signature IS NULL OR time_signature IN ('2', '3', '4', '6'));

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
       AND p_model_id IS DISTINCT FROM 'ace-step-1.5' THEN
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

CREATE OR REPLACE FUNCTION private.music_apply_variety_to_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_spec public.music_prompt_specs%ROWTYPE;
    v_temperature NUMERIC;
    v_style_guidance NUMERIC;
BEGIN
    IF NEW.endpoint NOT IN ('fal-ai/ace-step', 'fal-ai/ace-step-1.5') THEN RETURN NEW; END IF;
    SELECT ps.* INTO v_spec
    FROM public.music_generation_candidates c
    JOIN public.music_generation_requests r ON r.id = c.generation_request_id
    JOIN public.music_prompt_specs ps ON ps.id = r.prompt_spec_id
    WHERE c.job_id = NEW.job_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    NEW.payload := NEW.payload || jsonb_build_object('duration', v_spec.duration_seconds);
    IF NEW.endpoint = 'fal-ai/ace-step-1.5' AND v_spec.mode = 'custom' THEN
        NEW.payload := NEW.payload || jsonb_build_object(
            'prompt', v_spec.styles,
            'lyrics', CASE WHEN v_spec.instrumental THEN '[Instrumental]' ELSE v_spec.lyrics END
        );
    END IF;
    IF NEW.endpoint = 'fal-ai/ace-step-1.5' AND v_spec.variety IS NOT NULL THEN
        v_temperature := CASE
            WHEN v_spec.variety <= 50 THEN round(v_spec.variety::NUMERIC * 0.017, 2)
            ELSE round(0.85 + (v_spec.variety - 50)::NUMERIC * 0.023, 2)
        END;
        NEW.payload := NEW.payload || jsonb_build_object('lm_temperature', v_temperature);
    END IF;
    IF NEW.endpoint = 'fal-ai/ace-step-1.5' AND v_spec.style_influence IS NOT NULL THEN
        v_style_guidance := round(1 + v_spec.style_influence::NUMERIC * 0.09, 2);
        NEW.payload := NEW.payload || jsonb_build_object('lm_cfg_scale', v_style_guidance);
    END IF;
    IF NEW.endpoint = 'fal-ai/ace-step-1.5' AND v_spec.exclude_styles IS NOT NULL THEN
        NEW.payload := NEW.payload || jsonb_build_object('lm_negative_prompt', v_spec.exclude_styles);
    END IF;
    IF NEW.endpoint = 'fal-ai/ace-step-1.5' AND v_spec.bpm IS NOT NULL THEN
        NEW.payload := NEW.payload || jsonb_build_object('bpm', v_spec.bpm);
    END IF;
    IF NEW.endpoint = 'fal-ai/ace-step-1.5' AND v_spec.key_scale IS NOT NULL THEN
        NEW.payload := NEW.payload || jsonb_build_object('key_scale', v_spec.key_scale);
    END IF;
    IF NEW.endpoint = 'fal-ai/ace-step-1.5' AND v_spec.time_signature IS NOT NULL THEN
        NEW.payload := NEW.payload || jsonb_build_object('time_signature', v_spec.time_signature);
    END IF;
    RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER,INTEGER,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER,INTEGER,TEXT,TEXT) TO service_role;
REVOKE ALL ON FUNCTION private.music_apply_variety_to_dispatch() FROM PUBLIC, anon, authenticated;
