-- 0515: song reactions and creator follows (song page parity, slice 1).
-- docs/product/music-song-page-plan-2026-11-14.md.
--
-- A signed-in person can leave one emoji reaction on a published Music track and
-- follow a Music creator. Counts are public; who reacted or follows is not. Nothing
-- here spends or grants credits. Every write takes an idempotency key and is
-- replay-safe. Rows are erased with the account (they hold no generated media), so
-- the Music deletion guard (0490, 0493) skips these three tables.
-- Off until MUSIC_RUNTIME_FLAGS reactions / follows are true.

CREATE TABLE IF NOT EXISTS public.music_song_reactions (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    publication_id UUID NOT NULL REFERENCES public.music_publications(id) ON DELETE CASCADE,
    reaction TEXT NOT NULL CHECK (reaction IN ('fire', 'love', 'wow', 'praise', 'like', 'cool', 'hot')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, publication_id)
);
CREATE INDEX IF NOT EXISTS music_song_reactions_publication_idx ON public.music_song_reactions(publication_id, reaction);

CREATE TABLE IF NOT EXISTS public.music_creator_follows (
    follower_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    creator_user_id UUID NOT NULL REFERENCES public.music_creator_profiles(user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, creator_user_id),
    CHECK (follower_id <> creator_user_id)
);
CREATE INDEX IF NOT EXISTS music_creator_follows_creator_idx ON public.music_creator_follows(creator_user_id);

CREATE TABLE IF NOT EXISTS public.music_social_mutations (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,120}$'),
    action TEXT NOT NULL CHECK (action IN ('reaction', 'follow')),
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS music_social_mutations_recent_idx ON public.music_social_mutations(user_id, created_at DESC);

DO $$ DECLARE t TEXT; BEGIN
    FOREACH t IN ARRAY ARRAY['music_song_reactions', 'music_creator_follows', 'music_social_mutations'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
    END LOOP;
END $$;

-- Counts for a published track (by slug) or a creator (by handle), plus the
-- viewer's own state when an auth id is given. Anonymous callers get counts only.
CREATE OR REPLACE FUNCTION public.music_social_summary(p_slug TEXT, p_handle TEXT, p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_viewer UUID; v_pub public.music_publications%ROWTYPE; v_creator UUID; v_counts JSONB; v_mine TEXT;
BEGIN
    IF (p_slug IS NULL) = (p_handle IS NULL) THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS'); END IF;
    IF p_auth_id IS NOT NULL THEN
        SELECT id INTO v_viewer FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    END IF;
    IF p_slug IS NOT NULL THEN
        SELECT * INTO v_pub FROM public.music_publications WHERE slug = p_slug AND status = 'published';
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
        v_creator := v_pub.user_id;
        SELECT coalesce(jsonb_object_agg(reaction, n), '{}'::jsonb) INTO v_counts
        FROM (SELECT reaction, count(*) AS n FROM public.music_song_reactions WHERE publication_id = v_pub.id GROUP BY reaction) s;
        IF v_viewer IS NOT NULL THEN
            SELECT reaction INTO v_mine FROM public.music_song_reactions WHERE user_id = v_viewer AND publication_id = v_pub.id;
        END IF;
    ELSE
        SELECT user_id INTO v_creator FROM public.music_creator_profiles WHERE handle = p_handle;
        IF v_creator IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    END IF;
    RETURN jsonb_build_object(
        'ok', true,
        'reactions', coalesce(v_counts, '{}'::jsonb),
        'my_reaction', v_mine,
        'follower_count', (SELECT count(*) FROM public.music_creator_follows WHERE creator_user_id = v_creator),
        'following', v_viewer IS NOT NULL AND EXISTS (SELECT 1 FROM public.music_creator_follows WHERE follower_id = v_viewer AND creator_user_id = v_creator),
        'is_own', v_viewer IS NOT NULL AND v_viewer = v_creator
    );
END $$;

-- Writes allow 120 changes per person per hour.
CREATE OR REPLACE FUNCTION private.music_social_rate_ok(p_user UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT count(*) < 120 FROM public.music_social_mutations WHERE user_id = p_user AND created_at > now() - interval '1 hour';
$$;

-- p_reaction NULL clears the person's reaction.
CREATE OR REPLACE FUNCTION public.music_set_song_reaction(p_auth_id TEXT, p_slug TEXT, p_reaction TEXT, p_idempotency_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_pub public.music_publications%ROWTYPE; v_prior JSONB; v_result JSONB;
BEGIN
    IF p_auth_id IS NULL OR p_slug IS NULL OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$'
       OR (p_reaction IS NOT NULL AND p_reaction NOT IN ('fire', 'love', 'wow', 'praise', 'like', 'cool', 'hot')) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL AND frozen_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    SELECT result INTO v_prior FROM public.music_social_mutations WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_prior || jsonb_build_object('idempotent', true); END IF;
    IF NOT private.music_social_rate_ok(v_user) THEN RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED'); END IF;
    SELECT * INTO v_pub FROM public.music_publications WHERE slug = p_slug AND status = 'published';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF p_reaction IS NULL THEN
        DELETE FROM public.music_song_reactions WHERE user_id = v_user AND publication_id = v_pub.id;
    ELSE
        INSERT INTO public.music_song_reactions(user_id, publication_id, reaction) VALUES (v_user, v_pub.id, p_reaction)
        ON CONFLICT (user_id, publication_id) DO UPDATE SET reaction = EXCLUDED.reaction, updated_at = now();
    END IF;
    v_result := public.music_social_summary(p_slug, NULL, p_auth_id);
    INSERT INTO public.music_social_mutations(user_id, idempotency_key, action, result) VALUES (v_user, p_idempotency_key, 'reaction', v_result);
    RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.music_set_creator_follow(p_auth_id TEXT, p_handle TEXT, p_following BOOLEAN, p_idempotency_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_creator UUID; v_prior JSONB; v_result JSONB;
BEGIN
    IF p_auth_id IS NULL OR p_handle IS NULL OR p_following IS NULL
       OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL AND frozen_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    SELECT result INTO v_prior FROM public.music_social_mutations WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_prior || jsonb_build_object('idempotent', true); END IF;
    IF NOT private.music_social_rate_ok(v_user) THEN RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED'); END IF;
    SELECT user_id INTO v_creator FROM public.music_creator_profiles WHERE handle = p_handle;
    IF v_creator IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF v_creator = v_user THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS'); END IF;
    IF p_following THEN
        INSERT INTO public.music_creator_follows(follower_id, creator_user_id) VALUES (v_user, v_creator) ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM public.music_creator_follows WHERE follower_id = v_user AND creator_user_id = v_creator;
    END IF;
    v_result := public.music_social_summary(NULL, p_handle, p_auth_id);
    INSERT INTO public.music_social_mutations(user_id, idempotency_key, action, result) VALUES (v_user, p_idempotency_key, 'follow', v_result);
    RETURN v_result;
END $$;

-- Erase with the account: these rows hold no generated media.
CREATE OR REPLACE FUNCTION private.music_social_forget_erased_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        DELETE FROM public.music_song_reactions WHERE user_id = NEW.id;
        DELETE FROM public.music_creator_follows WHERE follower_id = NEW.id;
        DELETE FROM public.music_social_mutations WHERE user_id = NEW.id;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_music_social_forget_erased ON public.users;
CREATE TRIGGER users_music_social_forget_erased
    AFTER UPDATE OF deleted_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.music_social_forget_erased_user();

-- 0493's guard, with the three erased tables also skipped.
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
  -- Inspect every direct Music foreign key to users, including collaborator and
  -- inviter/invitee columns. This also makes a future Music table fail closed
  -- before the classification tests require an explicit retention decision.
  FOR v_ref IN
    SELECT c.conrelid, a.attname
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class r ON r.oid=c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
      JOIN LATERAL unnest(c.conkey) k(attnum) ON true
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
     WHERE c.contype='f' AND c.confrelid='public.users'::regclass
       AND n.nspname='public' AND r.relname LIKE 'music!_%' ESCAPE '!'
       AND r.relname NOT IN ('music_reference_links', 'music_song_reactions', 'music_creator_follows', 'music_social_mutations')
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
REVOKE ALL ON FUNCTION private.music_social_forget_erased_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.music_social_forget_erased_user() TO service_role;
REVOKE ALL ON FUNCTION private.music_social_rate_ok(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.music_social_rate_ok(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.music_social_summary(TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_social_summary(TEXT,TEXT,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.music_set_song_reaction(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_set_song_reaction(TEXT,TEXT,TEXT,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.music_set_creator_follow(TEXT,TEXT,BOOLEAN,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_set_creator_follow(TEXT,TEXT,BOOLEAN,TEXT) TO service_role;
