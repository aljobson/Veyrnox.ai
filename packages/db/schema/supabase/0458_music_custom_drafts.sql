-- Durable Custom writing draft with optimistic revision conflicts.
-- This stores private user-authored lyrics and style direction; it does not
-- enable Custom generation or imply that the selected model accepts lyrics.

CREATE TABLE IF NOT EXISTS public.music_lyric_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL REFERENCES public.model_catalog(id) ON DELETE RESTRICT,
    lyrics TEXT NOT NULL DEFAULT '' CHECK (char_length(lyrics) <= 3000),
    styles TEXT NOT NULL DEFAULT '' CHECK (char_length(styles) <= 500),
    title TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 80),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_lyric_drafts_user_updated_idx
    ON public.music_lyric_drafts(user_id, updated_at DESC);

ALTER TABLE public.music_lyric_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_lyric_drafts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS music_lyric_drafts_owner_read ON public.music_lyric_drafts;
CREATE POLICY music_lyric_drafts_owner_read ON public.music_lyric_drafts
    FOR SELECT TO authenticated USING (private.music_owns_user(user_id));
REVOKE ALL ON TABLE public.music_lyric_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.music_lyric_drafts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.music_lyric_drafts TO service_role;

CREATE OR REPLACE FUNCTION public.music_get_custom_draft(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_draft public.music_lyric_drafts%ROWTYPE;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    SELECT * INTO v_draft FROM public.music_lyric_drafts WHERE user_id = v_user;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', true, 'draft', jsonb_build_object(
            'id', NULL, 'model_id', 'ace-step', 'lyrics', '', 'styles', '', 'title', '',
            'revision', 0, 'updated_at', NULL
        ));
    END IF;
    RETURN jsonb_build_object('ok', true, 'draft', jsonb_build_object(
        'id', v_draft.id, 'model_id', v_draft.model_id, 'lyrics', v_draft.lyrics,
        'styles', v_draft.styles, 'title', v_draft.title, 'revision', v_draft.revision,
        'updated_at', v_draft.updated_at
    ));
END $$;

CREATE OR REPLACE FUNCTION public.music_save_custom_draft(
    p_auth_id TEXT,
    p_expected_revision INTEGER,
    p_model_id TEXT,
    p_lyrics TEXT,
    p_styles TEXT,
    p_title TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_draft public.music_lyric_drafts%ROWTYPE;
BEGIN
    IF p_expected_revision IS NULL OR p_expected_revision < 0
       OR p_model_id IS NULL OR p_model_id !~ '^[A-Za-z0-9._-]{1,100}$'
       OR p_lyrics IS NULL OR char_length(p_lyrics) > 3000
       OR p_styles IS NULL OR char_length(p_styles) > 500
       OR p_title IS NULL OR char_length(p_title) > 80 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.model_catalog
        WHERE id = p_model_id AND active AND NOT gated_flag AND modality = 'text-to-audio'
    ) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'MODEL_UNAVAILABLE');
    END IF;

    -- Materialize one blank row per owner, then serialize revisions on it.
    -- Two first saves cannot both win: the unique user row plus FOR UPDATE
    -- makes the second request observe revision 1 and return a conflict.
    INSERT INTO public.music_lyric_drafts(user_id, model_id)
    VALUES (v_user, p_model_id) ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_draft FROM public.music_lyric_drafts WHERE user_id = v_user FOR UPDATE;
    IF v_draft.revision IS DISTINCT FROM p_expected_revision THEN
        RETURN jsonb_build_object('ok', false, 'code', 'REVISION_CONFLICT', 'draft', jsonb_build_object(
            'id', v_draft.id, 'model_id', v_draft.model_id, 'lyrics', v_draft.lyrics,
            'styles', v_draft.styles, 'title', v_draft.title, 'revision', v_draft.revision,
            'updated_at', v_draft.updated_at
        ));
    END IF;

    UPDATE public.music_lyric_drafts
    SET model_id = p_model_id, lyrics = p_lyrics, styles = p_styles, title = p_title,
        revision = revision + 1, updated_at = now()
    WHERE id = v_draft.id RETURNING * INTO v_draft;
    RETURN jsonb_build_object('ok', true, 'draft', jsonb_build_object(
        'id', v_draft.id, 'model_id', v_draft.model_id, 'lyrics', v_draft.lyrics,
        'styles', v_draft.styles, 'title', v_draft.title, 'revision', v_draft.revision,
        'updated_at', v_draft.updated_at
    ));
END $$;

REVOKE ALL ON FUNCTION public.music_get_custom_draft(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_save_custom_draft(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_custom_draft(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_save_custom_draft(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT) TO service_role;
