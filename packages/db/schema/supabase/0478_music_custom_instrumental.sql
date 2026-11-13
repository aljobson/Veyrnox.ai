-- Let the verified ACE-Step 1.5 Custom flow explicitly choose vocal lyrics or
-- instrumental output. The quote freezes the choice; instrumental dispatches
-- the provider-documented [Instrumental] marker and never sends saved lyrics.

ALTER TABLE public.music_prompt_specs
    DROP CONSTRAINT IF EXISTS music_prompt_specs_mode_shape_check;
ALTER TABLE public.music_prompt_specs
    ADD CONSTRAINT music_prompt_specs_mode_shape_check CHECK (
        (mode = 'simple' AND instrumental AND lyrics IS NULL AND styles IS NULL
            AND draft_revision IS NULL AND lyrics_rights_version IS NULL AND schema_version = 'music-simple-v1')
        OR
        (mode = 'custom' AND model_id = 'ace-step-1.5' AND styles IS NOT NULL
            AND draft_revision IS NOT NULL AND schema_version = 'music-custom-v1'
            AND (
                (instrumental AND lyrics IS NULL AND lyrics_rights_version IS NULL)
                OR
                (NOT instrumental AND lyrics IS NOT NULL
                    AND lyrics_rights_version = 'music-lyrics-rights-v1')
            ))
    );

DROP FUNCTION IF EXISTS public.music_create_custom_quote(TEXT,INTEGER,BOOLEAN,INTEGER);
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
       OR p_duration_seconds IS NULL OR p_duration_seconds NOT BETWEEN 10 AND 60 THEN
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
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.music_custom_provenance_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_spec public.music_prompt_specs%ROWTYPE;
BEGIN
    SELECT ps.* INTO v_spec FROM public.music_generation_requests r
    JOIN public.music_prompt_specs ps ON ps.id = r.prompt_spec_id
    WHERE r.id = NEW.generation_request_id;
    IF FOUND THEN
        NEW.provenance := NEW.provenance || jsonb_build_object(
            'schema_version', v_spec.schema_version, 'mode', v_spec.mode,
            'instrumental', v_spec.instrumental,
            'lyrics_rights_version', v_spec.lyrics_rights_version,
            'draft_revision', v_spec.draft_revision
        );
    END IF;
    RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.music_create_custom_quote(TEXT,INTEGER,BOOLEAN,BOOLEAN,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_custom_quote(TEXT,INTEGER,BOOLEAN,BOOLEAN,INTEGER) TO service_role;
