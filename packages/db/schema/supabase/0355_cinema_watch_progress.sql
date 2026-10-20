-- Cinema "Continue watching" (ADR-0232): one private resume position per person and title.
-- Not audience analytics (0281) and not metering (0144): nothing here feeds rankings, creator
-- analytics, Pass Plays or credits. No ledger_entries or credit_balances write.
-- The three RPCs are the only readers and writers; the table denies every browser and service role.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cinema_watch_resume (
    user_id          UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    content_id       UUID        NOT NULL REFERENCES public.cinema_content(id) ON DELETE CASCADE,
    position_seconds INTEGER     NOT NULL CHECK (position_seconds >= 0),
    duration_seconds INTEGER     NOT NULL CHECK (duration_seconds BETWEEN 1 AND 600),
    completed        BOOLEAN     NOT NULL DEFAULT false,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, content_id),
    CHECK (position_seconds <= duration_seconds)
);
CREATE INDEX IF NOT EXISTS cinema_watch_resume_recent_idx
    ON public.cinema_watch_resume (user_id, updated_at DESC, content_id DESC);
CREATE INDEX IF NOT EXISTS cinema_watch_resume_content_idx
    ON public.cinema_watch_resume (content_id);

ALTER TABLE public.cinema_watch_resume ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_watch_resume FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_watch_resume FROM PUBLIC, anon, authenticated, service_role;

-- Save the position (at most 6 titles' writes per 10 s each, 20 titles a minute: 120 writes a minute). An absolute last-write-wins upsert, so a replay changes nothing.
CREATE OR REPLACE FUNCTION public.save_cinema_watch_resume(p_auth_id TEXT, p_content_id UUID, p_position INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID; v_ent JSONB; v_upload public.cinema_uploads%ROWTYPE; v_old public.cinema_watch_resume%ROWTYPE;
    v_duration INTEGER; v_pos INTEGER; v_done BOOLEAN; v_now TIMESTAMPTZ;
BEGIN
    v_user := public.cinema_community_actor(p_auth_id);
    IF v_user IS NULL THEN RETURN jsonb_build_object('error', 'profile_required'); END IF;
    IF p_content_id IS NULL OR p_position IS NULL OR p_position NOT BETWEEN 0 AND 600 THEN
        RETURN jsonb_build_object('error', 'invalid_position');
    END IF;
    IF public.cinema_community_root(p_content_id) IS NULL THEN RETURN jsonb_build_object('error', 'content_not_found'); END IF;
    PERFORM pg_advisory_xact_lock(355, hashtext(v_user::TEXT));
    IF public.cinema_community_actor(p_auth_id) IS DISTINCT FROM v_user THEN
        RETURN jsonb_build_object('error', 'account_not_active');
    END IF;
    v_ent := public.cinema_entitlement(p_auth_id, p_content_id);
    IF v_ent->>'access' IS NULL OR v_ent->>'access' NOT IN ('free', 'unlocked', 'pass') THEN
        RETURN jsonb_build_object('error', 'locked');
    END IF;
    SELECT * INTO v_upload FROM public.cinema_uploads
     WHERE content_id = p_content_id AND state = 'ready' AND stream_uid IS NOT NULL;
    IF NOT FOUND OR v_upload.duration_seconds IS NULL OR v_upload.duration_seconds < 1 OR v_upload.duration_seconds > 600 THEN
        RETURN jsonb_build_object('error', 'not_ready');
    END IF;
    v_duration := ceil(v_upload.duration_seconds)::INTEGER;
    v_pos := least(p_position, v_duration);
    v_done := v_pos * 100 >= v_duration * 95;
    v_now := clock_timestamp();

    SELECT * INTO v_old FROM public.cinema_watch_resume WHERE user_id = v_user AND content_id = p_content_id;
    IF FOUND AND v_old.updated_at > v_now - interval '10 seconds' THEN
        -- Too soon: keep the stored value, say so, and do not count it as a failure.
        RETURN jsonb_build_object('recorded', false, 'content_id', p_content_id, 'position_seconds', v_old.position_seconds,
            'duration_seconds', v_old.duration_seconds, 'completed', v_old.completed);
    END IF;
    IF (SELECT count(*) FROM public.cinema_watch_resume
         WHERE user_id = v_user AND content_id <> p_content_id AND updated_at > v_now - interval '1 minute') >= 20 THEN
        RETURN jsonb_build_object('error', 'rate_limited');
    END IF;

    INSERT INTO public.cinema_watch_resume (user_id, content_id, position_seconds, duration_seconds, completed, updated_at)
    VALUES (v_user, p_content_id, v_pos, v_duration, v_done, v_now)
    ON CONFLICT (user_id, content_id) DO UPDATE
        SET position_seconds = EXCLUDED.position_seconds, duration_seconds = EXCLUDED.duration_seconds,
            completed = EXCLUDED.completed, updated_at = EXCLUDED.updated_at;

    RETURN jsonb_build_object('recorded', true, 'content_id', p_content_id, 'position_seconds', v_pos,
        'duration_seconds', v_duration, 'completed', v_done);
END $$;

-- The caller's own unfinished titles, newest first. Visibility and entitlement are rechecked on every read.
CREATE OR REPLACE FUNCTION public.list_cinema_watch_resume(p_auth_id TEXT, p_before_id UUID, p_limit INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_before TIMESTAMPTZ; v_items JSONB;
BEGIN
    v_user := public.cinema_community_actor(p_auth_id);
    IF v_user IS NULL THEN RETURN jsonb_build_object('error', 'profile_required'); END IF;
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 40 THEN RETURN jsonb_build_object('error', 'invalid_query'); END IF;
    IF p_before_id IS NOT NULL THEN
        SELECT updated_at INTO v_before FROM public.cinema_watch_resume WHERE user_id = v_user AND content_id = p_before_id;
        IF NOT FOUND THEN RETURN jsonb_build_object('error', 'invalid_cursor'); END IF;
    END IF;
    WITH visible AS (
        SELECT r.content_id, r.position_seconds, r.duration_seconds, r.updated_at, c.title, p.username, p.display_name
          FROM public.cinema_watch_resume r
          JOIN public.cinema_content c ON c.id = r.content_id
          JOIN public.cinema_profiles p ON p.user_id = c.creator_id
         WHERE r.user_id = v_user AND NOT r.completed
           AND (p_before_id IS NULL OR (r.updated_at, r.content_id) < (v_before, p_before_id))
           AND public.cinema_community_root(r.content_id) IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.cinema_uploads x WHERE x.content_id = r.content_id AND x.state = 'ready')
           AND public.cinema_entitlement(p_auth_id, r.content_id)->>'access' IN ('free', 'unlocked', 'pass')
         ORDER BY r.updated_at DESC, r.content_id DESC LIMIT p_limit + 1)
    SELECT coalesce(jsonb_agg(jsonb_build_object('content_id', content_id, 'title', title, 'username', username,
               'display_name', display_name, 'position_seconds', position_seconds, 'duration_seconds', duration_seconds,
               'updated_at', updated_at) ORDER BY updated_at DESC, content_id DESC), '[]'::jsonb)
      INTO v_items FROM visible;
    RETURN jsonb_build_object('items', v_items);
END $$;

-- Dismiss a row. Removing something that is not there is the same answer.
CREATE OR REPLACE FUNCTION public.remove_cinema_watch_resume(p_auth_id TEXT, p_content_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID;
BEGIN
    v_user := public.cinema_community_actor(p_auth_id);
    IF v_user IS NULL THEN RETURN jsonb_build_object('error', 'profile_required'); END IF;
    IF p_content_id IS NULL THEN RETURN jsonb_build_object('error', 'invalid_query'); END IF;
    DELETE FROM public.cinema_watch_resume WHERE user_id = v_user AND content_id = p_content_id;
    RETURN jsonb_build_object('content_id', p_content_id, 'removed', true);
END $$;

-- At most 200 titles per person; a new title pushes out the least recently watched.
CREATE OR REPLACE FUNCTION private.watch_resume_cap()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    DELETE FROM public.cinema_watch_resume r
     WHERE r.user_id = NEW.user_id AND r.content_id IN (
         SELECT x.content_id FROM public.cinema_watch_resume x WHERE x.user_id = NEW.user_id
          ORDER BY x.updated_at DESC, x.content_id DESC OFFSET 200);
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.watch_resume_cap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cinema_watch_resume_cap ON public.cinema_watch_resume;
CREATE TRIGGER cinema_watch_resume_cap
    AFTER INSERT ON public.cinema_watch_resume
    FOR EACH ROW EXECUTE FUNCTION private.watch_resume_cap();

-- ── Account deletion hook (ADR-0111): a tombstoned account keeps no resume positions ──
CREATE OR REPLACE FUNCTION private.watch_resume_forget_erased_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        DELETE FROM public.cinema_watch_resume WHERE user_id = NEW.id;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.watch_resume_forget_erased_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_watch_resume_forget_erased ON public.users;
CREATE TRIGGER users_watch_resume_forget_erased
    AFTER UPDATE OF deleted_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.watch_resume_forget_erased_user();

REVOKE ALL ON FUNCTION public.save_cinema_watch_resume(TEXT, UUID, INTEGER),
    public.list_cinema_watch_resume(TEXT, UUID, INTEGER),
    public.remove_cinema_watch_resume(TEXT, UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_cinema_watch_resume(TEXT, UUID, INTEGER),
    public.list_cinema_watch_resume(TEXT, UUID, INTEGER),
    public.remove_cinema_watch_resume(TEXT, UUID) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
