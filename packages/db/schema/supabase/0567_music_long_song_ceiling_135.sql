-- ADR-0359 Amendment 3: cap ACE-Step 1.5 at 135 seconds so 48 kHz stereo
-- 16-bit output fits the existing 25 MiB FLAC-to-WAV conversion limit.
-- Keep pricing, submit, refunds and the dark-by-default app switch unchanged.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.music_prompt_specs WHERE duration_seconds > 135
    ) THEN
        RAISE EXCEPTION 'music long-song ceiling: music_prompt_specs contains duration_seconds > 135';
    END IF;

    ALTER TABLE public.music_prompt_specs
        DROP CONSTRAINT IF EXISTS music_prompt_specs_duration_by_model_check;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.music_prompt_specs'::regclass
          AND conname = 'music_prompt_specs_duration_by_model_check'
    ) THEN
        ALTER TABLE public.music_prompt_specs
            ADD CONSTRAINT music_prompt_specs_duration_by_model_check CHECK (
                duration_seconds BETWEEN 10 AND 60
                OR (model_id = 'ace-step-1.5' AND duration_seconds BETWEEN 10 AND 135)
            );
    END IF;
END $$;

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
    v_max := CASE WHEN p_model_id = 'ace-step-1.5' THEN 135 ELSE 60 END;
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
       OR p_duration_seconds IS NULL OR p_duration_seconds NOT BETWEEN 10 AND 135 THEN
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

