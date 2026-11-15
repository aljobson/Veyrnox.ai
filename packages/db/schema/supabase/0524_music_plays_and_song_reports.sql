-- 0524: public play counts and song reports (Suno parity S-A4 Report, S-A5 play counts).
--
-- Play counts: a signed-in listener's play of a published track counts once per
-- 30 minutes; the creator's own plays do not count. Only the total is public.
-- Which listener played is kept in music_play_listens for the 30-minute check,
-- is readable by no one but service_role, and is erased with the account.
-- Anonymous plays are not counted (no identity to de-duplicate on without
-- storing network data).
--
-- Song reports: a listener reports someone else's published track. Modelled on
-- the comment reports in 0518: one open report per listener per track, at most
-- 20 a day, idempotent through music_comment_mutations, reviewed in the same
-- administrator queue. Nothing here spends or grants credits.
-- Off until MUSIC_RUNTIME_FLAGS plays / songReports is true.

CREATE TABLE IF NOT EXISTS public.music_publication_plays (
    publication_id UUID PRIMARY KEY REFERENCES public.music_publications(id) ON DELETE CASCADE,
    play_count BIGINT NOT NULL DEFAULT 0 CHECK (play_count >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.music_play_listens (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    publication_id UUID NOT NULL REFERENCES public.music_publications(id) ON DELETE CASCADE,
    last_counted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, publication_id)
);
CREATE INDEX IF NOT EXISTS music_play_listens_publication_idx ON public.music_play_listens(publication_id);

CREATE TABLE IF NOT EXISTS public.music_song_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    publication_id UUID NOT NULL REFERENCES public.music_publications(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('spam', 'abuse', 'privacy', 'rights', 'other')),
    details TEXT NOT NULL CHECK (char_length(btrim(details)) BETWEEN 3 AND 500),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    resolved_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (reporter_id, publication_id)
);
CREATE INDEX IF NOT EXISTS music_song_reports_open_idx ON public.music_song_reports(created_at, id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS music_song_reports_publication_idx ON public.music_song_reports(publication_id);
CREATE INDEX IF NOT EXISTS music_song_reports_resolved_by_idx ON public.music_song_reports(resolved_by);

DO $$ DECLARE t TEXT; BEGIN
    FOREACH t IN ARRAY ARRAY['music_publication_plays', 'music_play_listens', 'music_song_reports'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.music_count_public_play(p_auth_id TEXT, p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_pub public.music_publications%ROWTYPE; v_counted BOOLEAN := false;
BEGIN
    IF p_slug IS NULL OR p_slug !~ '^[a-f0-9]{24}$' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS'); END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    SELECT * INTO v_pub FROM public.music_publications WHERE slug = p_slug AND status = 'published';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF v_pub.user_id <> v_user THEN
        INSERT INTO public.music_play_listens(user_id, publication_id) VALUES (v_user, v_pub.id)
        ON CONFLICT (user_id, publication_id) DO UPDATE SET last_counted_at = now()
        WHERE public.music_play_listens.last_counted_at < now() - interval '30 minutes'
        RETURNING true INTO v_counted;
        IF v_counted THEN
            INSERT INTO public.music_publication_plays(publication_id, play_count) VALUES (v_pub.id, 1)
            ON CONFLICT (publication_id) DO UPDATE SET play_count = public.music_publication_plays.play_count + 1, updated_at = now();
        END IF;
    END IF;
    RETURN jsonb_build_object('ok', true, 'counted', coalesce(v_counted, false));
END $$;

-- The public total only.
CREATE OR REPLACE FUNCTION public.music_public_play_count(p_slug TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT jsonb_build_object('ok', true, 'play_count', coalesce((
        SELECT c.play_count FROM public.music_publications p
        JOIN public.music_publication_plays c ON c.publication_id = p.id
        WHERE p.slug = p_slug AND p.status = 'published'), 0));
$$;

CREATE OR REPLACE FUNCTION public.music_report_song(p_auth_id TEXT, p_idempotency_key TEXT, p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_pub public.music_publications%ROWTYPE; v_old public.music_comment_mutations%ROWTYPE; v_result JSONB;
BEGIN
    IF p_auth_id IS NULL OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$'
       OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action', 'slug', 'category', 'details'))
       OR p_payload->>'action' IS DISTINCT FROM 'report_song'
       OR coalesce(p_payload->>'slug', '') !~ '^[a-f0-9]{24}$'
       OR coalesce(p_payload->>'category', '') NOT IN ('spam', 'abuse', 'privacy', 'rights', 'other')
       OR jsonb_typeof(p_payload->'details') IS DISTINCT FROM 'string'
       OR char_length(btrim(p_payload->>'details')) NOT BETWEEN 3 AND 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL AND frozen_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    PERFORM pg_advisory_xact_lock(523, hashtext(v_user::text));
    SELECT * INTO v_old FROM public.music_comment_mutations WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_old.payload IS DISTINCT FROM p_payload THEN RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT'); END IF;
        RETURN v_old.result || jsonb_build_object('idempotent', true);
    END IF;
    SELECT * INTO v_pub FROM public.music_publications WHERE slug = p_payload->>'slug' AND status = 'published';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF v_pub.user_id = v_user THEN RETURN jsonb_build_object('ok', false, 'code', 'SELF_REVIEW'); END IF;
    IF EXISTS (SELECT 1 FROM public.music_song_reports WHERE reporter_id = v_user AND publication_id = v_pub.id) THEN
        v_result := jsonb_build_object('ok', true, 'status', 'reported');
    ELSE
        IF (SELECT count(*) FROM public.music_song_reports WHERE reporter_id = v_user AND created_at > now() - interval '24 hours')
         + (SELECT count(*) FROM public.music_comment_reports WHERE reporter_id = v_user AND created_at > now() - interval '24 hours') >= 20 THEN
            RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'retry_after_seconds', 3600);
        END IF;
        INSERT INTO public.music_song_reports(reporter_id, publication_id, category, details)
        VALUES (v_user, v_pub.id, p_payload->>'category', btrim(p_payload->>'details'));
        v_result := jsonb_build_object('ok', true, 'status', 'reported');
    END IF;
    INSERT INTO public.music_comment_mutations(user_id, idempotency_key, payload, result) VALUES (v_user, p_idempotency_key, p_payload, v_result);
    RETURN v_result;
END $$;

-- Administrator queue: open song reports, oldest first, 50.
CREATE OR REPLACE FUNCTION public.music_song_report_list(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE auth_id = p_auth_id AND is_admin IS TRUE AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('ok', true, 'song_reports', coalesce((SELECT jsonb_agg(x ORDER BY created_at, id) FROM (
        SELECT r.id, r.category, r.details, r.created_at, p.slug, p.status AS publication_status, s.title,
               (SELECT count(*) FROM public.music_song_reports o WHERE o.publication_id = r.publication_id AND o.status = 'open') AS open_reports
        FROM public.music_song_reports r JOIN public.music_publications p ON p.id = r.publication_id
        JOIN public.music_songs s ON s.id = p.song_id
        WHERE r.status = 'open' ORDER BY r.created_at, r.id LIMIT 50) x), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.music_song_report_resolve(p_auth_id TEXT, p_idempotency_key TEXT, p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin UUID; v_id UUID; v_report public.music_song_reports%ROWTYPE; v_owner UUID;
        v_old public.music_comment_mutations%ROWTYPE; v_result JSONB;
BEGIN
    SELECT id INTO v_admin FROM public.users WHERE auth_id = p_auth_id AND is_admin IS TRUE AND deleted_at IS NULL;
    IF v_admin IS NULL THEN RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501'; END IF;
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action', 'id', 'reason'))
       OR p_payload->>'action' IS DISTINCT FROM 'resolve_song_report'
       OR coalesce(p_payload->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR char_length(btrim(p_payload->>'reason')) NOT BETWEEN 3 AND 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    v_id := (p_payload->>'id')::UUID;
    PERFORM pg_advisory_xact_lock(519, hashtext(v_admin::text));
    SELECT * INTO v_old FROM public.music_comment_mutations WHERE user_id = v_admin AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_old.payload IS DISTINCT FROM p_payload THEN RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT'); END IF;
        RETURN v_old.result || jsonb_build_object('idempotent', true);
    END IF;
    SELECT * INTO v_report FROM public.music_song_reports WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    SELECT user_id INTO v_owner FROM public.music_publications WHERE id = v_report.publication_id;
    IF v_report.reporter_id = v_admin OR v_owner = v_admin THEN RETURN jsonb_build_object('ok', false, 'code', 'SELF_REVIEW'); END IF;
    IF v_report.status <> 'open' THEN RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_REVIEWED'); END IF;
    UPDATE public.music_song_reports SET status = 'resolved', resolved_by = v_admin, resolved_at = now() WHERE id = v_id;
    v_result := jsonb_build_object('ok', true, 'id', v_id, 'status', 'resolved', 'prior_status', 'open');
    INSERT INTO public.music_comment_mutations(user_id, idempotency_key, payload, result) VALUES (v_admin, p_idempotency_key, p_payload, v_result);
    RETURN v_result;
END $$;

-- Erase with the account.
CREATE OR REPLACE FUNCTION private.music_plays_reports_forget_erased_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        DELETE FROM public.music_play_listens WHERE user_id = NEW.id;
        DELETE FROM public.music_song_reports WHERE reporter_id = NEW.id;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_music_plays_reports_forget_erased ON public.users;
CREATE TRIGGER users_music_plays_reports_forget_erased
    AFTER UPDATE OF deleted_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.music_plays_reports_forget_erased_user();

-- 0518's guard, with the two listener tables also skipped: a person who only
-- listened to or reported a track can still delete their account.
CREATE OR REPLACE FUNCTION private.account_deletion_blockers(p_user_id UUID, p_auth_id TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_blockers TEXT[]; v_auth UUID; v_ref RECORD; v_music_present BOOLEAN;
BEGIN
  v_blockers := ARRAY[]::TEXT[];
  BEGIN v_auth := p_auth_id::uuid; EXCEPTION WHEN invalid_text_representation THEN v_auth := NULL; END;
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id=p_user_id AND u.frozen_at IS NOT NULL) THEN v_blockers:=array_append(v_blockers,'account_frozen'); END IF;
  IF EXISTS (SELECT 1 FROM public.evidence_holds h JOIN public.jobs j ON j.id=h.job_id WHERE j.user_id=p_user_id AND h.released_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.assets a JOIN public.jobs j ON j.id=a.job_id WHERE j.user_id=p_user_id AND a.held_at IS NOT NULL) THEN v_blockers:=array_append(v_blockers,'account_on_hold'); END IF;
  IF EXISTS (SELECT 1 FROM public.credit_subscriptions s WHERE s.user_id=p_user_id AND s.status IN ('active','past_due'))
     OR EXISTS (SELECT 1 FROM public.social_publish_subscriptions s WHERE s.user_id=p_user_id AND s.status IN ('active','past_due')) THEN v_blockers:=array_append(v_blockers,'active_subscription'); END IF;
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id=p_user_id AND j.state IN ('DEBITED','SUBMITTED','FAILOVER')) THEN v_blockers:=array_append(v_blockers,'generation_in_progress'); END IF;
  IF EXISTS (SELECT 1 FROM public.top_ups t WHERE t.user_id=p_user_id AND t.status='pending' AND t.created_at>now()-interval '2 hours') THEN v_blockers:=array_append(v_blockers,'top_up_in_progress'); END IF;
  IF EXISTS (SELECT 1 FROM public.cinema_content c WHERE c.creator_id=p_user_id)
     OR EXISTS (SELECT 1 FROM public.cinema_uploads c WHERE c.creator_id=p_user_id AND c.deleted_at IS NULL) THEN v_blockers:=array_append(v_blockers,'cinema_content_present'); END IF;
  IF v_auth IS NOT NULL AND EXISTS (SELECT 1 FROM public.projects p WHERE p.owner_id=v_auth AND p.deleted_at IS NULL) THEN v_blockers:=array_append(v_blockers,'projects_present'); END IF;
  IF EXISTS (SELECT 1 FROM public.social_brands b JOIN public.social_brand_members m ON m.brand_id=b.id WHERE b.owner_user_id=p_user_id AND m.user_id<>p_user_id) THEN v_blockers:=array_append(v_blockers,'publish_team_present'); END IF;
  IF EXISTS (SELECT 1 FROM public.voice_profiles v WHERE v.user_id=p_user_id AND v.status<>'revoked') THEN v_blockers:=array_append(v_blockers,'voice_profile_present'); END IF;
  FOR v_ref IN
    SELECT c.conrelid, a.attname
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class r ON r.oid=c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
      JOIN LATERAL unnest(c.conkey) k(attnum) ON true
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
     WHERE c.contype='f' AND c.confrelid='public.users'::regclass
       AND n.nspname='public' AND r.relname LIKE 'music!_%' ESCAPE '!'
       AND r.relname NOT IN ('music_reference_links', 'music_song_reactions', 'music_creator_follows', 'music_social_mutations',
                             'music_comments', 'music_comment_reports', 'music_comment_mutations',
                             'music_play_listens', 'music_song_reports')
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I=$1)', v_ref.conrelid::regclass, v_ref.attname)
       INTO v_music_present USING p_user_id;
    IF v_music_present THEN
      v_blockers:=array_append(v_blockers,'music_content_present');
      EXIT;
    END IF;
  END LOOP;
  RETURN v_blockers;
END $$;

REVOKE ALL ON FUNCTION private.account_deletion_blockers(UUID,TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.music_plays_reports_forget_erased_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.music_plays_reports_forget_erased_user() TO service_role;
REVOKE ALL ON FUNCTION public.music_count_public_play(TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_count_public_play(TEXT,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.music_public_play_count(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_public_play_count(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.music_report_song(TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_report_song(TEXT,TEXT,JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.music_song_report_list(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_song_report_list(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.music_song_report_resolve(TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_song_report_resolve(TEXT,TEXT,JSONB) TO service_role;
