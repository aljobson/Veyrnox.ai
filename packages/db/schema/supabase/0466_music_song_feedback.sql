-- Private owner feedback and liked-song collection. Service-role RPC only.
CREATE TABLE IF NOT EXISTS public.music_song_feedback (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    song_id UUID NOT NULL,
    value TEXT NOT NULL CHECK (value IN ('like', 'dislike')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, song_id),
    FOREIGN KEY (song_id, user_id) REFERENCES public.music_songs(id, user_id) ON DELETE CASCADE
);

ALTER TABLE public.music_song_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_song_feedback FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.music_song_feedback FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.music_song_feedback TO service_role;

CREATE OR REPLACE FUNCTION public.music_set_song_feedback(
    p_auth_id TEXT,
    p_song_id UUID,
    p_value TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
BEGIN
    IF p_value IS NOT NULL AND p_value NOT IN ('like', 'dislike') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.music_songs WHERE id = p_song_id AND user_id = v_user AND status = 'active'
    ) THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF p_value IS NULL THEN
        DELETE FROM public.music_song_feedback WHERE user_id = v_user AND song_id = p_song_id;
    ELSE
        INSERT INTO public.music_song_feedback(user_id, song_id, value, updated_at)
        VALUES (v_user, p_song_id, p_value, now())
        ON CONFLICT (user_id, song_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
    END IF;
    RETURN jsonb_build_object('ok', true, 'feedback', p_value);
END $$;

CREATE OR REPLACE FUNCTION public.music_library_songs(
    p_auth_id TEXT,
    p_workspace_id UUID DEFAULT NULL,
    p_query TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 50
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_rows JSONB;
    v_query TEXT := btrim(COALESCE(p_query, ''));
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50);
BEGIN
    IF char_length(v_query) > 100 THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS'); END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', true, 'songs', '[]'::jsonb); END IF;
    PERFORM private.music_ensure_default_workspace(v_user);
    IF p_workspace_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.music_workspaces WHERE id = p_workspace_id AND user_id = v_user AND status = 'active'
    ) THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    SELECT COALESCE(jsonb_agg(x.song ORDER BY x.created_at DESC, x.id DESC), '[]'::jsonb) INTO v_rows
    FROM (
        SELECT s.id, s.created_at, jsonb_build_object(
            'id', s.id, 'title', s.title, 'visibility', s.visibility,
            'workspace_id', s.workspace_id, 'workspace_name', w.name,
            'revision', s.revision, 'created_at', s.created_at,
            'version_id', v.id, 'job_id', v.job_id,
            'audio_url', '/api/v1/jobs/' || v.job_id || '/asset', 'status', 'ready',
            'feedback', f.value
        ) AS song
        FROM public.music_songs s
        JOIN public.music_song_versions v ON v.id = s.current_version_id
        JOIN public.music_workspaces w ON w.id = s.workspace_id
        LEFT JOIN public.music_song_feedback f ON f.song_id = s.id AND f.user_id = v_user
        WHERE s.user_id = v_user AND s.status = 'active'
          AND (p_workspace_id IS NULL OR s.workspace_id = p_workspace_id)
          AND (v_query = '' OR position(lower(v_query) in lower(s.title)) > 0)
        ORDER BY s.created_at DESC, s.id DESC LIMIT v_limit
    ) x;
    RETURN jsonb_build_object('ok', true, 'songs', v_rows);
END $$;

REVOKE ALL ON FUNCTION public.music_set_song_feedback(TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_set_song_feedback(TEXT,UUID,TEXT) TO service_role;
