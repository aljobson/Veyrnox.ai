-- 0516: "More by this creator" and "Similar" rails for a public Music track
-- (song page parity, slice 2: docs/product/music-song-page-plan-2026-11-14.md).
--
-- Read-only, no new tables. Both rails list only published tracks of active songs
-- and return the same public fields the track page already shows (slug, title,
-- creator handle and name). Similar ranks other creators' tracks by how many
-- style words (four letters or more, minus words like "music" and "draft" that
-- every default title has) their generation direction shares with this
-- one, newest first on a tie; the words themselves are never returned. Off until
-- MUSIC_RUNTIME_FLAGS rails is true.

CREATE OR REPLACE FUNCTION private.music_publication_words(p_publication_id UUID)
RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT coalesce(array_agg(DISTINCT w), ARRAY[]::TEXT[])
    FROM public.music_publications p
    JOIN public.music_song_versions v ON v.id = p.song_version_id
    LEFT JOIN public.music_generation_candidates c ON c.job_id = v.job_id
    LEFT JOIN public.music_generation_requests r ON r.id = c.generation_request_id
    LEFT JOIN public.music_prompt_specs ps ON ps.id = r.prompt_spec_id
    JOIN public.music_songs s ON s.id = p.song_id
    CROSS JOIN LATERAL regexp_split_to_table(lower(coalesce(ps.styles, ps.prompt, '') || ' ' || s.title), '[^a-z0-9]+') AS w
    WHERE p.id = p_publication_id AND char_length(w) >= 4
      AND w NOT IN ('music', 'draft', 'song', 'track', 'version', 'with', 'from', 'that', 'this');
$$;

CREATE OR REPLACE FUNCTION public.music_public_rails(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pub public.music_publications%ROWTYPE; v_words TEXT[]; v_by JSONB; v_similar JSONB;
BEGIN
    IF p_slug IS NULL OR p_slug !~ '^[a-f0-9]{24}$' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS'); END IF;
    SELECT * INTO v_pub FROM public.music_publications WHERE slug = p_slug AND status = 'published';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'title', t.title, 'handle', t.handle, 'display_name', t.display_name) ORDER BY t.published_at DESC), '[]'::jsonb)
    INTO v_by FROM (
        SELECT p.slug, s.title, cp.handle, cp.display_name, p.published_at
        FROM public.music_publications p
        JOIN public.music_songs s ON s.id = p.song_id AND s.user_id = p.user_id AND s.status = 'active'
        JOIN public.music_creator_profiles cp ON cp.user_id = p.user_id
        WHERE p.user_id = v_pub.user_id AND p.status = 'published' AND p.id <> v_pub.id
        ORDER BY p.published_at DESC LIMIT 6
    ) t;

    v_words := private.music_publication_words(v_pub.id);
    SELECT coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'title', t.title, 'handle', t.handle, 'display_name', t.display_name) ORDER BY t.shared DESC, t.published_at DESC), '[]'::jsonb)
    INTO v_similar FROM (
        SELECT p.slug, s.title, cp.handle, cp.display_name, p.published_at,
               cardinality(ARRAY(SELECT unnest(private.music_publication_words(p.id)) INTERSECT SELECT unnest(v_words))) AS shared
        FROM public.music_publications p
        JOIN public.music_songs s ON s.id = p.song_id AND s.user_id = p.user_id AND s.status = 'active'
        JOIN public.music_creator_profiles cp ON cp.user_id = p.user_id
        WHERE p.user_id <> v_pub.user_id AND p.status = 'published'
        ORDER BY shared DESC, p.published_at DESC LIMIT 6
    ) t;

    RETURN jsonb_build_object('ok', true, 'by_creator', v_by, 'similar', v_similar);
END $$;

REVOKE ALL ON FUNCTION private.music_publication_words(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.music_publication_words(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.music_public_rails(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_public_rails(TEXT) TO service_role;
