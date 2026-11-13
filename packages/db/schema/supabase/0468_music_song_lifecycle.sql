-- Reversible owner-only Music song trash. Permanent deletion deliberately
-- remains unavailable until asset/provider cleanup can be proven end to end.

DROP FUNCTION IF EXISTS public.music_library_songs(TEXT,UUID,TEXT,INTEGER);

CREATE OR REPLACE FUNCTION public.music_library_songs(
    p_auth_id TEXT,
    p_workspace_id UUID DEFAULT NULL,
    p_query TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 50,
    p_status TEXT DEFAULT 'active'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_rows JSONB;
    v_query TEXT := btrim(COALESCE(p_query, ''));
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50);
BEGIN
    IF char_length(v_query) > 100 OR p_status NOT IN ('active','trashed') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', true, 'songs', '[]'::jsonb); END IF;
    PERFORM private.music_ensure_default_workspace(v_user);
    IF p_workspace_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.music_workspaces
        WHERE id = p_workspace_id AND user_id = v_user AND status = 'active'
    ) THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    SELECT COALESCE(jsonb_agg(x.song ORDER BY x.updated_at DESC, x.id DESC), '[]'::jsonb) INTO v_rows
    FROM (
        SELECT s.id, s.updated_at, jsonb_build_object(
            'id', s.id, 'title', s.title, 'visibility', s.visibility,
            'workspace_id', s.workspace_id, 'workspace_name', w.name,
            'revision', s.revision, 'created_at', s.created_at, 'updated_at', s.updated_at,
            'version_id', v.id, 'job_id', v.job_id,
            'audio_url', CASE WHEN s.status = 'active' THEN '/api/v1/jobs/' || v.job_id || '/asset' END,
            'status', 'ready', 'lifecycle_status', s.status,
            'feedback', f.value
        ) AS song
        FROM public.music_songs s
        JOIN public.music_song_versions v ON v.id = s.current_version_id
        JOIN public.music_workspaces w ON w.id = s.workspace_id
        LEFT JOIN public.music_song_feedback f ON f.song_id = s.id AND f.user_id = v_user
        WHERE s.user_id = v_user AND s.status = p_status
          AND (p_workspace_id IS NULL OR s.workspace_id = p_workspace_id)
          AND (v_query = '' OR position(lower(v_query) in lower(s.title)) > 0)
        ORDER BY s.updated_at DESC, s.id DESC LIMIT v_limit
    ) x;
    RETURN jsonb_build_object('ok', true, 'songs', v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.music_set_song_lifecycle(
    p_auth_id TEXT,
    p_song_id UUID,
    p_revision INTEGER,
    p_action TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_song public.music_songs%ROWTYPE;
    v_target TEXT;
BEGIN
    IF p_action NOT IN ('trash','restore') OR p_revision IS NULL OR p_revision < 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    v_target := CASE p_action WHEN 'trash' THEN 'trashed' ELSE 'active' END;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    SELECT * INTO v_song FROM public.music_songs
    WHERE id = p_song_id AND user_id = v_user FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF v_song.status = v_target THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'song', jsonb_build_object(
            'id', v_song.id, 'revision', v_song.revision, 'lifecycle_status', v_song.status,
            'updated_at', v_song.updated_at
        ));
    END IF;
    IF v_song.revision <> p_revision THEN
        RETURN jsonb_build_object('ok', false, 'code', 'REVISION_CONFLICT');
    END IF;
    UPDATE public.music_songs
    SET status = v_target, revision = revision + 1, updated_at = now()
    WHERE id = v_song.id AND user_id = v_user
    RETURNING * INTO v_song;
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'song', jsonb_build_object(
        'id', v_song.id, 'revision', v_song.revision, 'lifecycle_status', v_song.status,
        'updated_at', v_song.updated_at
    ));
END $$;

REVOKE ALL ON FUNCTION public.music_library_songs(TEXT,UUID,TEXT,INTEGER,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_library_songs(TEXT,UUID,TEXT,INTEGER,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.music_set_song_lifecycle(TEXT,UUID,INTEGER,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_set_song_lifecycle(TEXT,UUID,INTEGER,TEXT) TO service_role;
