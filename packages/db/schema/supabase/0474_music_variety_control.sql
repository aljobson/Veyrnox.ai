-- Provider-backed Variety control for the paid ACE-Step 1.5 pair path.
-- The public 0..100 value is frozen with the immutable prompt spec. A dispatch
-- trigger maps it to fal's documented lm_temperature 0..2 range, with 50
-- preserving the provider default of 0.85. The base model rejects the control.

ALTER TABLE public.music_prompt_specs
    ADD COLUMN IF NOT EXISTS variety SMALLINT NULL
    CHECK (variety IS NULL OR variety BETWEEN 0 AND 100);

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
        p_model_id IS DISTINCT FROM 'ace-step-1.5'
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

CREATE OR REPLACE FUNCTION private.music_apply_variety_to_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_variety SMALLINT;
    v_temperature NUMERIC;
BEGIN
    IF NEW.endpoint IS DISTINCT FROM 'fal-ai/ace-step-1.5' THEN RETURN NEW; END IF;

    SELECT ps.variety INTO v_variety
    FROM public.music_generation_candidates c
    JOIN public.music_generation_requests r ON r.id = c.generation_request_id
    JOIN public.music_prompt_specs ps ON ps.id = r.prompt_spec_id
    WHERE c.job_id = NEW.job_id;

    IF v_variety IS NULL THEN RETURN NEW; END IF;
    v_temperature := CASE
        WHEN v_variety <= 50 THEN round(v_variety::NUMERIC * 0.017, 2)
        ELSE round(0.85 + (v_variety - 50)::NUMERIC * 0.023, 2)
    END;
    NEW.payload := NEW.payload || jsonb_build_object('lm_temperature', v_temperature);
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS music_apply_variety_to_dispatch ON public.fal_dispatch;
CREATE TRIGGER music_apply_variety_to_dispatch
BEFORE INSERT ON public.fal_dispatch
FOR EACH ROW EXECUTE FUNCTION private.music_apply_variety_to_dispatch();

REVOKE ALL ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.music_apply_variety_to_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER) TO service_role;
