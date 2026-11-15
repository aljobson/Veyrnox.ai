-- Music Library tabs (Suno parity S-L2, S-L3, S-L4): History, Cover Art and
-- Hooks. Everything here is the person's own private data. No credits move:
-- cover art is made with the existing, already-priced image models and only
-- attached here; a hook is a saved time range on an existing version, played
-- with a media fragment, so no audio is rendered or stored.
-- Behind MUSIC_RUNTIME_FLAGS.libraryTabs (ships false).

-- History: the person's own recently played songs, newest first, capped at 200.
CREATE TABLE IF NOT EXISTS public.music_listen_history (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    song_id UUID NOT NULL,
    last_played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    play_count INTEGER NOT NULL DEFAULT 1 CHECK (play_count >= 1),
    PRIMARY KEY (user_id, song_id),
    FOREIGN KEY (song_id, user_id) REFERENCES public.music_songs(id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS music_listen_history_recent_idx ON public.music_listen_history(user_id, last_played_at DESC);
CREATE INDEX IF NOT EXISTS music_listen_history_song_idx ON public.music_listen_history(song_id);

-- Hooks: a 5-30 s range of one owned version.
CREATE TABLE IF NOT EXISTS public.music_hooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    song_id UUID NOT NULL,
    version_id UUID NOT NULL,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
    start_seconds NUMERIC(10,3) NOT NULL CHECK (start_seconds >= 0),
    end_seconds NUMERIC(10,3) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_seconds - start_seconds BETWEEN 5 AND 30),
    FOREIGN KEY (song_id, user_id) REFERENCES public.music_songs(id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (version_id, user_id, song_id) REFERENCES public.music_song_versions(id, user_id, song_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS music_hooks_user_idx ON public.music_hooks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS music_hooks_song_idx ON public.music_hooks(song_id);
CREATE INDEX IF NOT EXISTS music_hooks_version_idx ON public.music_hooks(version_id);

-- Cover Art: one chosen image per song, from the person's own finished image job.
CREATE TABLE IF NOT EXISTS public.music_song_covers (
    song_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (song_id, user_id) REFERENCES public.music_songs(id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS music_song_covers_user_idx ON public.music_song_covers(user_id);
CREATE INDEX IF NOT EXISTS music_song_covers_job_idx ON public.music_song_covers(job_id);

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['music_listen_history','music_hooks','music_song_covers'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_all', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t || '_service_all', t);
    END LOOP;
END $$;

-- Erasure (ADR-0111): these rows go with the account.
CREATE OR REPLACE FUNCTION private.music_library_tabs_forget_erased()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        DELETE FROM public.music_listen_history WHERE user_id=NEW.id;
        DELETE FROM public.music_hooks WHERE user_id=NEW.id;
        DELETE FROM public.music_song_covers WHERE user_id=NEW.id;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.music_library_tabs_forget_erased() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS users_music_library_tabs_forget_erased ON public.users;
CREATE TRIGGER users_music_library_tabs_forget_erased AFTER UPDATE OF deleted_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.music_library_tabs_forget_erased();

-- A deleted creation (ADR-0116) must not stay as anyone's cover.
CREATE OR REPLACE FUNCTION private.music_song_covers_forget_deleted_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        DELETE FROM public.music_song_covers WHERE job_id=NEW.id;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.music_song_covers_forget_deleted_job() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS jobs_music_song_covers_forget_deleted ON public.jobs;
CREATE TRIGGER jobs_music_song_covers_forget_deleted AFTER UPDATE OF deleted_at ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION private.music_song_covers_forget_deleted_job();

CREATE OR REPLACE FUNCTION private.music_song_projection(p_user UUID, p_song UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT jsonb_build_object('id',s.id,'title',s.title,'visibility',s.visibility,'created_at',s.created_at,
        'version_id',v.id,'job_id',v.job_id,'audio_url','/api/v1/jobs/'||v.job_id||'/asset',
        'cover_url',CASE WHEN c.job_id IS NULL THEN NULL ELSE '/api/v1/jobs/'||c.job_id||'/asset' END)
    FROM public.music_songs s
    JOIN public.music_song_versions v ON v.id=s.current_version_id
    LEFT JOIN public.music_song_covers c ON c.song_id=s.id AND c.user_id=s.user_id
    WHERE s.id=p_song AND s.user_id=p_user AND s.status='active'
$$;
REVOKE ALL ON FUNCTION private.music_song_projection(UUID,UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.music_record_listen(p_auth_id TEXT, p_song_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF v_user IS NULL OR p_song_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF NOT EXISTS(SELECT 1 FROM public.music_songs WHERE id=p_song_id AND user_id=v_user AND status='active') THEN
        RETURN jsonb_build_object('ok',false,'code','NOT_FOUND');
    END IF;
    -- A replay inside 30 s is the same listen.
    INSERT INTO public.music_listen_history(user_id,song_id) VALUES(v_user,p_song_id)
    ON CONFLICT (user_id,song_id) DO UPDATE SET last_played_at=now(),
        play_count=public.music_listen_history.play_count+1
    WHERE public.music_listen_history.last_played_at<now()-interval '30 seconds';
    DELETE FROM public.music_listen_history WHERE user_id=v_user AND song_id IN (
        SELECT song_id FROM public.music_listen_history WHERE user_id=v_user
        ORDER BY last_played_at DESC OFFSET 200);
    RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.music_list_listen_history(p_auth_id TEXT, p_limit INTEGER DEFAULT 50)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_rows JSONB; v_limit INTEGER:=LEAST(GREATEST(COALESCE(p_limit,50),1),100);
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',true,'songs','[]'::jsonb); END IF;
    SELECT COALESCE(jsonb_agg(x.song ORDER BY x.last_played_at DESC),'[]'::jsonb) INTO v_rows FROM (
        SELECT h.last_played_at, private.music_song_projection(v_user,h.song_id)
            ||jsonb_build_object('last_played_at',h.last_played_at,'play_count',h.play_count) AS song
        FROM public.music_listen_history h
        JOIN public.music_songs s ON s.id=h.song_id AND s.user_id=v_user AND s.status='active'
        WHERE h.user_id=v_user ORDER BY h.last_played_at DESC LIMIT v_limit) x;
    RETURN jsonb_build_object('ok',true,'songs',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.music_create_hook(
    p_auth_id TEXT, p_song_id UUID, p_version_id UUID, p_title TEXT, p_start NUMERIC, p_end NUMERIC, p_duration NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_id UUID;
BEGIN
    IF p_song_id IS NULL OR p_version_id IS NULL OR p_title IS NULL
       OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 80
       OR p_start IS NULL OR p_end IS NULL OR p_start<0 OR p_end-p_start NOT BETWEEN 5 AND 30
       OR p_duration IS NULL OR p_end>p_duration+0.001 THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL FOR UPDATE;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF NOT EXISTS(SELECT 1 FROM public.music_songs s JOIN public.music_song_versions v
        ON v.id=p_version_id AND v.song_id=s.id AND v.user_id=v_user
        WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active') THEN
        RETURN jsonb_build_object('ok',false,'code','NOT_FOUND');
    END IF;
    IF (SELECT count(*) FROM public.music_hooks WHERE user_id=v_user)>=100 THEN
        RETURN jsonb_build_object('ok',false,'code','LIMIT_REACHED');
    END IF;
    INSERT INTO public.music_hooks(user_id,song_id,version_id,title,start_seconds,end_seconds)
    VALUES(v_user,p_song_id,p_version_id,btrim(p_title),p_start,p_end) RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok',true,'hook_id',v_id);
END $$;

CREATE OR REPLACE FUNCTION public.music_list_hooks(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_rows JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',true,'hooks','[]'::jsonb); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',h.id,'song_id',h.song_id,'song_title',s.title,
        'title',h.title,'start_seconds',h.start_seconds,'end_seconds',h.end_seconds,'created_at',h.created_at,
        'audio_url','/api/v1/jobs/'||v.job_id||'/asset') ORDER BY h.created_at DESC),'[]'::jsonb)
    INTO v_rows FROM public.music_hooks h
    JOIN public.music_songs s ON s.id=h.song_id AND s.user_id=v_user AND s.status='active'
    JOIN public.music_song_versions v ON v.id=h.version_id
    WHERE h.user_id=v_user;
    RETURN jsonb_build_object('ok',true,'hooks',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.music_delete_hook(p_auth_id TEXT, p_hook_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_count INTEGER;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF v_user IS NULL OR p_hook_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    DELETE FROM public.music_hooks WHERE id=p_hook_id AND user_id=v_user;
    GET DIAGNOSTICS v_count=ROW_COUNT;
    -- Deleting an already-deleted hook is a no-op success (idempotent).
    RETURN jsonb_build_object('ok',true,'deleted',v_count=1);
END $$;

-- Cover candidates: the person's 24 newest finished, undeleted image creations.
CREATE OR REPLACE FUNCTION public.music_list_cover_art(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_images JSONB; v_covers JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',true,'images','[]'::jsonb,'covers','[]'::jsonb); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('job_id',x.id,'created_at',x.created_at,
        'image_url','/api/v1/jobs/'||x.id||'/asset') ORDER BY x.created_at DESC),'[]'::jsonb) INTO v_images
    FROM (SELECT j.id,j.created_at FROM public.jobs j
        WHERE j.user_id=v_user AND j.state='STORED' AND j.deleted_at IS NULL
          AND EXISTS(SELECT 1 FROM public.assets a WHERE a.job_id=j.id AND a.mime_type LIKE 'image/%')
        ORDER BY j.created_at DESC LIMIT 24) x;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('song_id',c.song_id,'job_id',c.job_id,
        'image_url','/api/v1/jobs/'||c.job_id||'/asset')),'[]'::jsonb) INTO v_covers
    FROM public.music_song_covers c WHERE c.user_id=v_user;
    RETURN jsonb_build_object('ok',true,'images',v_images,'covers',v_covers);
END $$;

CREATE OR REPLACE FUNCTION public.music_set_song_cover(p_auth_id TEXT, p_song_id UUID, p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF v_user IS NULL OR p_song_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF NOT EXISTS(SELECT 1 FROM public.music_songs WHERE id=p_song_id AND user_id=v_user AND status='active') THEN
        RETURN jsonb_build_object('ok',false,'code','NOT_FOUND');
    END IF;
    IF p_job_id IS NULL THEN
        DELETE FROM public.music_song_covers WHERE song_id=p_song_id AND user_id=v_user;
        RETURN jsonb_build_object('ok',true,'cover',NULL);
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.jobs j WHERE j.id=p_job_id AND j.user_id=v_user
        AND j.state='STORED' AND j.deleted_at IS NULL
        AND EXISTS(SELECT 1 FROM public.assets a WHERE a.job_id=j.id AND a.mime_type LIKE 'image/%')) THEN
        RETURN jsonb_build_object('ok',false,'code','NOT_FOUND');
    END IF;
    INSERT INTO public.music_song_covers(song_id,user_id,job_id) VALUES(p_song_id,v_user,p_job_id)
    ON CONFLICT (song_id) DO UPDATE SET job_id=EXCLUDED.job_id,updated_at=now()
    WHERE public.music_song_covers.user_id=EXCLUDED.user_id;
    RETURN jsonb_build_object('ok',true,'cover','/api/v1/jobs/'||p_job_id||'/asset');
END $$;

REVOKE ALL ON FUNCTION public.music_record_listen(TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_list_listen_history(TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_create_hook(TEXT,UUID,UUID,TEXT,NUMERIC,NUMERIC,NUMERIC) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_list_hooks(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_delete_hook(TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_list_cover_art(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_set_song_cover(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_record_listen(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_list_listen_history(TEXT,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_create_hook(TEXT,UUID,UUID,TEXT,NUMERIC,NUMERIC,NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_list_hooks(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_delete_hook(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_list_cover_art(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_set_song_cover(TEXT,UUID,UUID) TO service_role;

-- The stored asset of one owned version, so the Worker can measure it before
-- saving a hook.
CREATE OR REPLACE FUNCTION public.music_get_hook_source_context(p_auth_id TEXT, p_song_id UUID, p_version_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT jsonb_build_object('ok',true,'r2_key',a.r2_key,'mime_type',a.mime_type) INTO v_row
    FROM public.music_songs s
    JOIN public.music_song_versions v ON v.id=p_version_id AND v.song_id=s.id AND v.user_id=v_user
    JOIN public.assets a ON a.id=v.audio_asset_id
    WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active';
    RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','NOT_FOUND'));
END $$;
REVOKE ALL ON FUNCTION public.music_get_hook_source_context(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_hook_source_context(TEXT,UUID,UUID) TO service_role;

-- Admit the new routes in the privacy-safe route telemetry allowlist.
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0522(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0522;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT p_path IN ('/api/v1/music/history', '/api/v1/music/hooks', '/api/v1/music/hooks/:id',
                      '/api/v1/music/cover-art', '/api/v1/music/songs/:id/cover')
        OR public.telemetry_path_allowed_pre_0522(p_path)
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC, anon, authenticated, service_role;
