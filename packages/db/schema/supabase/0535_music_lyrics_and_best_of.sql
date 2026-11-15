-- 0535: lyrics with a copy button, and Explore "Best of <genre>" playlists
-- (Suno parity S-A6 lyrics with copy, S-D2 Best of playlists).
--
-- Lyrics: the lyrics a song was made from live in its prompt spec. The owner
-- reads them for any of their songs; the public reads them only for a
-- published track, and only once MUSIC_RUNTIME_FLAGS lyrics is true. A song
-- made without lyrics (instrumental) returns none.
--
-- Best of: twelve fixed genres. Among the 200 newest published tracks of active
-- songs (bounded, as the 0516 rails), a track belongs to a genre when its
-- generation direction or title matches the genre's words. Each playlist holds
-- the 8 tracks with the most reactions, newest first on a tie. Only the public
-- rail fields are returned (slug, title, creator handle and name). Off until
-- MUSIC_RUNTIME_FLAGS bestOf is true. Read-only, no new tables.

CREATE OR REPLACE FUNCTION private.music_version_lyrics(p_version_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT ps.lyrics
    FROM public.music_song_versions v
    JOIN public.music_generation_candidates c ON c.job_id = v.job_id
    JOIN public.music_generation_requests r ON r.id = c.generation_request_id
    JOIN public.music_prompt_specs ps ON ps.id = r.prompt_spec_id
    WHERE v.id = p_version_id AND ps.lyrics IS NOT NULL
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.music_get_song_lyrics(p_auth_id TEXT, p_song_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_version UUID;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF v_user IS NULL OR p_song_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    SELECT current_version_id INTO v_version FROM public.music_songs WHERE id = p_song_id AND user_id = v_user AND status = 'active';
    IF v_version IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok', true, 'lyrics', private.music_version_lyrics(v_version));
END $$;

CREATE OR REPLACE FUNCTION public.music_public_lyrics(p_slug TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT jsonb_build_object('ok', true, 'lyrics', (
        SELECT private.music_version_lyrics(p.song_version_id)
        FROM public.music_publications p
        JOIN public.music_songs s ON s.id = p.song_id AND s.user_id = p.user_id AND s.status = 'active'
        WHERE p.slug = p_slug AND p.status = 'published'));
$$;

CREATE OR REPLACE FUNCTION public.music_best_of_playlists()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH genres(genre, ord, pattern) AS (VALUES
        ('pop', 1, '\y(pop|synthpop|electropop)\y'),
        ('hip-hop', 2, '\y(hip[ -]?hop|rap|trap|boom ?bap)\y'),
        ('rock', 3, '\y(rock|punk|grunge|metal|indie rock)\y'),
        ('electronic', 4, '\y(edm|electronic|techno|trance|dubstep|drum and bass|dnb|synthwave)\y'),
        ('house', 5, '\y(house|deep house|disco)\y'),
        ('lo-fi', 6, '\y(lo[ -]?fi|chillhop)\y'),
        ('jazz', 7, '\y(jazz|bebop|swing)\y'),
        ('rnb-soul', 8, '\y(rnb|soul|funk|neo soul)\y'),
        ('ambient', 9, '\y(ambient|drone|meditation|meditative)\y'),
        ('cinematic', 10, '\y(cinematic|orchestral|soundtrack|epic)\y'),
        ('country-folk', 11, '\y(country|folk|bluegrass|americana)\y'),
        ('latin', 12, '\y(latin|reggaeton|salsa|bossa|samba|afrobeats?)\y')
    ), recent AS (
        SELECT p.id, p.slug, p.published_at, s.title, cp.handle, cp.display_name,
               lower(coalesce(ps.styles, ps.prompt, '') || ' ' || s.title) AS words,
               (SELECT count(*) FROM public.music_song_reactions r WHERE r.publication_id = p.id) AS reactions
        FROM (SELECT * FROM public.music_publications WHERE status = 'published' ORDER BY published_at DESC LIMIT 200) p
        JOIN public.music_songs s ON s.id = p.song_id AND s.user_id = p.user_id AND s.status = 'active'
        JOIN public.music_creator_profiles cp ON cp.user_id = p.user_id
        JOIN public.music_song_versions v ON v.id = p.song_version_id
        LEFT JOIN public.music_generation_candidates c ON c.job_id = v.job_id
        LEFT JOIN public.music_generation_requests rq ON rq.id = c.generation_request_id
        LEFT JOIN public.music_prompt_specs ps ON ps.id = rq.prompt_spec_id
    ), ranked AS (
        SELECT g.genre, g.ord, t.*, row_number() OVER (PARTITION BY g.genre ORDER BY t.reactions DESC, t.published_at DESC) AS n
        FROM genres g JOIN recent t ON t.words ~ g.pattern
    )
    SELECT jsonb_build_object('ok', true, 'playlists', coalesce((
        SELECT jsonb_agg(jsonb_build_object('genre', x.genre, 'tracks', x.tracks) ORDER BY x.ord)
        FROM (SELECT genre, ord, jsonb_agg(jsonb_build_object('slug', slug, 'title', title, 'handle', handle, 'display_name', display_name) ORDER BY n) AS tracks
              FROM ranked WHERE n <= 8 GROUP BY genre, ord) x), '[]'::jsonb));
$$;

DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0535(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0535;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT p_path IN ('/api/music/best-of')
        OR public.telemetry_path_allowed_pre_0535(p_path)
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.music_version_lyrics(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_get_song_lyrics(TEXT,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_public_lyrics(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_best_of_playlists() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_song_lyrics(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_public_lyrics(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_best_of_playlists() TO service_role;
