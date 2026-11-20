-- ADR-0367: Music-only user blocks. No identity is minted by a read.
CREATE TABLE IF NOT EXISTS public.music_actors (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE RESTRICT,
    public_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.music_user_blocks (
    blocker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id), CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS music_user_blocks_blocked_idx ON public.music_user_blocks(blocked_id);
ALTER TABLE public.music_actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_actors FORCE ROW LEVEL SECURITY;
ALTER TABLE public.music_user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_user_blocks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.music_actors, public.music_user_blocks FROM PUBLIC, anon, authenticated, service_role;
-- Existing creators and commenters get one shared identity; erased users never do.
INSERT INTO public.music_actors(user_id)
SELECT u.id FROM public.users u WHERE u.deleted_at IS NULL AND
    (EXISTS (SELECT 1 FROM public.music_creator_profiles p WHERE p.user_id=u.id)
     OR EXISTS (SELECT 1 FROM public.music_comments c WHERE c.author_id=u.id))
ORDER BY u.id FOR UPDATE OF u
ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION private.music_actor_id(p_user UUID)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id UUID;
BEGIN
    -- Serialize with account erasure before minting.
    PERFORM 1 FROM public.users WHERE id=p_user AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    INSERT INTO public.music_actors(user_id) VALUES(p_user) ON CONFLICT DO NOTHING;
    SELECT public_id INTO v_id FROM public.music_actors WHERE user_id=p_user;
    RETURN v_id;
END $$;
-- A missing actor omits only the new field, including during staged rollout.
CREATE OR REPLACE FUNCTION private.music_actor_field(p_user UUID, p_key TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT coalesce((SELECT jsonb_build_object(p_key, public_id) FROM public.music_actors WHERE user_id=p_user), '{}'::jsonb);
$$;
CREATE OR REPLACE FUNCTION private.music_actor_blocked(p_auth_id TEXT, p_actor_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1 FROM public.music_user_blocks b
        JOIN public.users u ON u.id=b.blocker_id AND u.deleted_at IS NULL
        JOIN public.music_actors a ON a.user_id=b.blocked_id
        WHERE u.auth_id=p_auth_id AND a.public_id=p_actor_id);
$$;
-- Keep existing write validation and idempotency unchanged.
DO $$ BEGIN
    IF to_regprocedure('private.music_publish_song_pre_0570(text,uuid,uuid,text,text,boolean,boolean,text,text)') IS NULL THEN
        ALTER FUNCTION public.music_publish_song(TEXT,UUID,UUID,TEXT,TEXT,BOOLEAN,BOOLEAN,TEXT,TEXT) SET SCHEMA private;
        ALTER FUNCTION private.music_publish_song(TEXT,UUID,UUID,TEXT,TEXT,BOOLEAN,BOOLEAN,TEXT,TEXT) RENAME TO music_publish_song_pre_0570;
    END IF;
END $$;
REVOKE ALL ON FUNCTION private.music_publish_song_pre_0570(TEXT,UUID,UUID,TEXT,TEXT,BOOLEAN,BOOLEAN,TEXT,TEXT) FROM PUBLIC, anon, authenticated, service_role;
-- Later publication changes must target private.music_publish_song_pre_0570; retain this minting wrapper.
CREATE OR REPLACE FUNCTION public.music_publish_song(p_auth_id TEXT,p_song_id UUID,p_version_id UUID,p_handle TEXT,p_display_name TEXT,p_allow_comments BOOLEAN,p_allow_remixes BOOLEAN,p_policy_version TEXT,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result JSONB;
BEGIN
    v_result := private.music_publish_song_pre_0570(p_auth_id,p_song_id,p_version_id,p_handle,p_display_name,p_allow_comments,p_allow_remixes,p_policy_version,p_idempotency_key);
    IF v_result->>'ok'='true' THEN
        PERFORM private.music_actor_id((SELECT id FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL));
    END IF;
    RETURN v_result;
END $$;
-- Keep existing write validation and idempotency unchanged.
DO $$ BEGIN
    IF to_regprocedure('private.music_comment_mutate_pre_0570(text,text,jsonb)') IS NULL THEN
        ALTER FUNCTION public.music_comment_mutate(TEXT,TEXT,JSONB) SET SCHEMA private;
        ALTER FUNCTION private.music_comment_mutate(TEXT,TEXT,JSONB) RENAME TO music_comment_mutate_pre_0570;
    END IF;
END $$;
REVOKE ALL ON FUNCTION private.music_comment_mutate_pre_0570(TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated, service_role;
-- Later comment changes must target private.music_comment_mutate_pre_0570; retain this minting wrapper.
CREATE OR REPLACE FUNCTION public.music_comment_mutate(p_auth_id TEXT,p_idempotency_key TEXT,p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result JSONB;
BEGIN
    v_result := private.music_comment_mutate_pre_0570(p_auth_id,p_idempotency_key,p_payload);
    IF v_result->>'ok'='true' AND p_payload->>'action'='submit' THEN
        PERFORM private.music_actor_id((SELECT id FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL));
    END IF;
    RETURN v_result;
END $$;
CREATE OR REPLACE FUNCTION public.music_block_actor(p_auth_id TEXT, p_actor_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me UUID; v_target UUID; v_rows INTEGER;
BEGIN
    SELECT id INTO v_me FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF v_me IS NULL THEN RETURN jsonb_build_object('error','account_not_found'); END IF;
    IF p_actor_id IS NULL THEN RETURN jsonb_build_object('error','invalid_actor_id'); END IF;
    SELECT a.user_id INTO v_target FROM public.music_actors a JOIN public.users u ON u.id=a.user_id
        WHERE a.public_id=p_actor_id AND u.deleted_at IS NULL;
    IF v_target IS NULL THEN RETURN jsonb_build_object('error','user_not_found'); END IF;
    IF v_target=v_me THEN RETURN jsonb_build_object('error','cannot_block_self'); END IF;
    -- Shared account locks allow independent blockers while excluding account erasure.
    PERFORM id FROM public.users WHERE id IN (v_me,v_target) ORDER BY id FOR SHARE;
    IF EXISTS (SELECT 1 FROM public.users WHERE id=v_me AND deleted_at IS NOT NULL) THEN
        RETURN jsonb_build_object('error','account_not_found');
    END IF;
    IF EXISTS (SELECT 1 FROM public.users WHERE id=v_target AND deleted_at IS NOT NULL) THEN
        RETURN jsonb_build_object('error','user_not_found');
    END IF;
    PERFORM pg_advisory_xact_lock(570, hashtext(v_me::text));
    IF NOT EXISTS (SELECT 1 FROM public.music_user_blocks WHERE blocker_id=v_me AND blocked_id=v_target)
       AND (SELECT count(*) FROM public.music_user_blocks WHERE blocker_id=v_me)>=500 THEN
        RETURN jsonb_build_object('error','block_limit');
    END IF;
    INSERT INTO public.music_user_blocks(blocker_id,blocked_id) VALUES(v_me,v_target) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN jsonb_build_object('ok',true,'already',v_rows=0);
END $$;
CREATE OR REPLACE FUNCTION public.music_unblock_actor(p_auth_id TEXT, p_actor_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me UUID; v_target UUID; v_rows INTEGER;
BEGIN
    SELECT id INTO v_me FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF v_me IS NULL THEN RETURN jsonb_build_object('error','account_not_found'); END IF;
    IF p_actor_id IS NULL THEN RETURN jsonb_build_object('error','invalid_actor_id'); END IF;
    SELECT a.user_id INTO v_target FROM public.music_actors a JOIN public.users u ON u.id=a.user_id
        WHERE a.public_id=p_actor_id AND u.deleted_at IS NULL;
    IF v_target IS NULL THEN RETURN jsonb_build_object('error','user_not_found'); END IF;
    IF v_target=v_me THEN RETURN jsonb_build_object('error','cannot_block_self'); END IF;
    -- Shared account locks allow independent blockers while excluding account erasure.
    PERFORM id FROM public.users WHERE id IN (v_me,v_target) ORDER BY id FOR SHARE;
    IF EXISTS (SELECT 1 FROM public.users WHERE id=v_me AND deleted_at IS NOT NULL) THEN
        RETURN jsonb_build_object('error','account_not_found');
    END IF;
    IF EXISTS (SELECT 1 FROM public.users WHERE id=v_target AND deleted_at IS NOT NULL) THEN
        RETURN jsonb_build_object('error','user_not_found');
    END IF;
    PERFORM pg_advisory_xact_lock(570, hashtext(v_me::text));
    DELETE FROM public.music_user_blocks WHERE blocker_id=v_me AND blocked_id=v_target;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN jsonb_build_object('ok',true,'already',v_rows=0);
END $$;
CREATE OR REPLACE FUNCTION public.music_list_blocked_actors(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me UUID;
BEGIN
    SELECT id INTO v_me FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF v_me IS NULL THEN RETURN jsonb_build_object('error','account_not_found'); END IF;
    RETURN jsonb_build_object('blocks',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'actor_id',a.public_id,'display_name',private.music_commenter_name(a.user_id),'created_at',b.created_at)
        ORDER BY b.created_at DESC,a.public_id)
        FROM public.music_user_blocks b JOIN public.music_actors a ON a.user_id=b.blocked_id
        JOIN public.users u ON u.id=a.user_id AND u.deleted_at IS NULL
        WHERE b.blocker_id=v_me),'[]'::jsonb));
END $$;
CREATE OR REPLACE FUNCTION public.music_resolve_publication(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row JSONB; BEGIN
    SELECT jsonb_build_object('title',s.title,'version_number',v.version_number,'job_id',v.job_id,
        'published_at',p.published_at,'allow_comments',p.allow_comments,'allow_remixes',p.allow_remixes,
        'commercial_status',p.commercial_status,'handle',cp.handle,'display_name',cp.display_name) || private.music_actor_field(p.user_id,'creator_id')
    INTO v_row FROM public.music_publications p
    JOIN public.music_creator_profiles cp ON cp.user_id=p.user_id
    JOIN public.music_songs s ON s.id=p.song_id AND s.user_id=p.user_id AND s.status='active'
    JOIN public.music_song_versions v ON v.id=p.song_version_id AND v.user_id=p.user_id
    WHERE p.slug=p_slug AND p.status='published';
    RETURN CASE WHEN v_row IS NULL THEN jsonb_build_object('ok',false,'code','NOT_FOUND')
        ELSE jsonb_build_object('ok',true,'track',v_row) END;
END $$;
CREATE OR REPLACE FUNCTION public.music_read_public_profile(p_handle TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_profile JSONB; v_tracks JSONB; BEGIN
    SELECT jsonb_build_object('handle',handle,'display_name',display_name) || private.music_actor_field(user_id,'creator_id') INTO v_profile
    FROM public.music_creator_profiles WHERE handle=p_handle;
    IF v_profile IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('slug',p.slug,'title',s.title,'published_at',p.published_at,
        'commercial_status',p.commercial_status) || private.music_actor_field(p.user_id,'creator_id') ORDER BY p.published_at DESC),'[]'::jsonb) INTO v_tracks
    FROM public.music_publications p JOIN public.music_songs s ON s.id=p.song_id AND s.user_id=p.user_id
    JOIN public.music_creator_profiles cp ON cp.user_id=p.user_id
    WHERE cp.handle=p_handle AND p.status='published' AND s.status='active';
    RETURN jsonb_build_object('ok',true,'profile',v_profile,'tracks',v_tracks);
END $$;
CREATE OR REPLACE FUNCTION public.music_public_rails(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pub public.music_publications%ROWTYPE; v_words TEXT[]; v_by JSONB; v_similar JSONB;
BEGIN
    IF p_slug IS NULL OR p_slug !~ '^[a-f0-9]{24}$' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS'); END IF;
    SELECT * INTO v_pub FROM public.music_publications WHERE slug = p_slug AND status = 'published';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'title', t.title, 'handle', t.handle, 'display_name', t.display_name) || private.music_actor_field(t.user_id,'creator_id') ORDER BY t.published_at DESC), '[]'::jsonb)
    INTO v_by FROM (
        SELECT p.user_id, p.slug, s.title, cp.handle, cp.display_name, p.published_at
        FROM public.music_publications p
        JOIN public.music_songs s ON s.id = p.song_id AND s.user_id = p.user_id AND s.status = 'active'
        JOIN public.music_creator_profiles cp ON cp.user_id = p.user_id
        WHERE p.user_id = v_pub.user_id AND p.status = 'published' AND p.id <> v_pub.id
        ORDER BY p.published_at DESC LIMIT 6
    ) t;
    v_words := private.music_publication_words(v_pub.id);
    SELECT coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'title', t.title, 'handle', t.handle, 'display_name', t.display_name) || private.music_actor_field(t.user_id,'creator_id') ORDER BY t.shared DESC, t.published_at DESC), '[]'::jsonb)
    INTO v_similar FROM (
        SELECT p.user_id, p.slug, s.title, cp.handle, cp.display_name, p.published_at,
               cardinality(ARRAY(SELECT unnest(private.music_publication_words(p.id)) INTERSECT SELECT unnest(v_words))) AS shared
        FROM (
            -- Bounded: only the 200 newest published tracks by other creators are
            -- scored, so an anonymous page view costs the same whatever the size of
            -- the library (pr gate, HIGH). Uses music_publications_published_idx.
            SELECT * FROM public.music_publications
            WHERE status = 'published' AND user_id <> v_pub.user_id
            ORDER BY published_at DESC LIMIT 200
        ) p
        JOIN public.music_songs s ON s.id = p.song_id AND s.user_id = p.user_id AND s.status = 'active'
        JOIN public.music_creator_profiles cp ON cp.user_id = p.user_id
        ORDER BY shared DESC, p.published_at DESC LIMIT 6
    ) t;
    RETURN jsonb_build_object('ok', true, 'by_creator', v_by, 'similar', v_similar);
END $$;
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
        SELECT p.user_id, p.id, p.slug, p.published_at, s.title, cp.handle, cp.display_name,
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
        FROM (SELECT genre, ord, jsonb_agg(jsonb_build_object('slug', slug, 'title', title, 'handle', handle, 'display_name', display_name) || private.music_actor_field(user_id,'creator_id') ORDER BY n) AS tracks
              FROM ranked WHERE n <= 8 GROUP BY genre, ord) x), '[]'::jsonb));
$$;
CREATE OR REPLACE FUNCTION public.music_comments_read(p_slug TEXT, p_auth_id TEXT, p_before_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pub public.music_publications%ROWTYPE; v_viewer UUID; v_before TIMESTAMPTZ; v_items JSONB; v_own JSONB; v_next UUID;
BEGIN
    IF p_slug IS NULL OR p_slug !~ '^[a-f0-9]{24}$' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS'); END IF;
    SELECT * INTO v_pub FROM public.music_publications WHERE slug = p_slug AND status = 'published';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF p_auth_id IS NOT NULL THEN SELECT id INTO v_viewer FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL; END IF;
    IF p_before_id IS NOT NULL THEN
        SELECT created_at INTO v_before FROM public.music_comments WHERE id = p_before_id AND publication_id = v_pub.id AND status = 'approved';
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS'); END IF;
    END IF;
    SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC, id DESC), '[]'::jsonb) INTO v_items FROM (
        SELECT c.created_at, c.id, jsonb_build_object(
            'id', c.id, 'parent_id', c.parent_id, 'body', c.body, 'at_seconds', c.at_seconds, 'created_at', c.created_at,
            'author', private.music_commenter_name(c.author_id), 'is_creator', c.author_id = v_pub.user_id,
            'own', v_viewer IS NOT NULL AND c.author_id = v_viewer) AS item
        FROM public.music_comments c JOIN public.users u ON u.id = c.author_id
        WHERE c.publication_id = v_pub.id AND c.status = 'approved' AND u.deleted_at IS NULL AND u.frozen_at IS NULL
          AND (v_before IS NULL OR (c.created_at, c.id) < (v_before, p_before_id))
        ORDER BY c.created_at DESC, c.id DESC LIMIT 26
    ) x;
    IF jsonb_array_length(v_items) > 25 THEN v_next := (v_items->24->>'id')::UUID; v_items := v_items - 25; END IF;
    IF v_viewer IS NOT NULL THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'parent_id', parent_id, 'body', body, 'status', status, 'created_at', created_at) ORDER BY created_at DESC), '[]'::jsonb)
        INTO v_own FROM (SELECT * FROM public.music_comments WHERE author_id = v_viewer AND publication_id = v_pub.id AND status IN ('pending', 'rejected') ORDER BY created_at DESC LIMIT 25) o;
    END IF;
    RETURN jsonb_build_object('ok', true, 'allow_comments', v_pub.allow_comments, 'comments', v_items, 'own_comments', coalesce(v_own, '[]'::jsonb), 'next_cursor', v_next);
END $$;
CREATE OR REPLACE FUNCTION public.music_comments_read_for_viewer(p_slug TEXT, p_auth_id TEXT, p_before_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pub public.music_publications%ROWTYPE; v_viewer UUID; v_before TIMESTAMPTZ; v_items JSONB; v_own JSONB; v_next UUID;
BEGIN
    IF p_slug IS NULL OR p_slug !~ '^[a-f0-9]{24}$' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS'); END IF;
    SELECT * INTO v_pub FROM public.music_publications WHERE slug = p_slug AND status = 'published';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF p_auth_id IS NOT NULL THEN SELECT id INTO v_viewer FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL; END IF;
    IF v_viewer IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
    IF p_before_id IS NOT NULL THEN
        SELECT created_at INTO v_before FROM public.music_comments WHERE id = p_before_id AND publication_id = v_pub.id AND status = 'approved';
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS'); END IF;
    END IF;
    SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC, id DESC), '[]'::jsonb) INTO v_items FROM (
        SELECT c.created_at, c.id, jsonb_build_object(
            'id', c.id, 'parent_id', c.parent_id, 'body', c.body, 'at_seconds', c.at_seconds, 'created_at', c.created_at,
            'author', private.music_commenter_name(c.author_id), 'is_creator', c.author_id = v_pub.user_id,
            'own', v_viewer IS NOT NULL AND c.author_id = v_viewer) || private.music_actor_field(c.author_id,'author_id') AS item
        FROM public.music_comments c JOIN public.users u ON u.id = c.author_id
        WHERE c.publication_id = v_pub.id AND c.status = 'approved' AND u.deleted_at IS NULL AND u.frozen_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.music_user_blocks b WHERE b.blocker_id=v_viewer AND b.blocked_id=c.author_id)
          AND (v_before IS NULL OR (c.created_at, c.id) < (v_before, p_before_id))
        ORDER BY c.created_at DESC, c.id DESC LIMIT 26
    ) x;
    IF jsonb_array_length(v_items) > 25 THEN v_next := (v_items->24->>'id')::UUID; v_items := v_items - 25; END IF;
    IF v_viewer IS NOT NULL THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'parent_id', parent_id, 'body', body, 'status', status, 'created_at', created_at) ORDER BY created_at DESC), '[]'::jsonb)
        INTO v_own FROM (SELECT * FROM public.music_comments WHERE author_id = v_viewer AND publication_id = v_pub.id AND status IN ('pending', 'rejected') ORDER BY created_at DESC LIMIT 25) o;
    END IF;
    RETURN jsonb_build_object('ok', true, 'allow_comments', v_pub.allow_comments, 'comments', v_items, 'own_comments', coalesce(v_own, '[]'::jsonb), 'next_cursor', v_next);
END $$;
-- Filter bounded public arrays, preserving their order and existing keys.
CREATE OR REPLACE FUNCTION private.music_visible_tracks(p_rows JSONB, p_auth_id TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT coalesce(jsonb_agg(item ORDER BY ord),'[]'::jsonb)
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(item,ord)
    WHERE NOT private.music_actor_blocked(p_auth_id,(item->>'creator_id')::UUID);
$$;
CREATE OR REPLACE FUNCTION public.music_resolve_publication_for_viewer(p_auth_id TEXT, p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result JSONB; v_actor UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL) THEN
        RETURN jsonb_build_object('error','account_not_found');
    END IF;
    v_result := public.music_resolve_publication(p_slug);
    v_actor := (v_result->'track'->>'creator_id')::UUID;
    IF private.music_actor_blocked(p_auth_id,v_actor) THEN
        RETURN jsonb_build_object('ok',true,'blocked',jsonb_build_object('creator_id',v_actor,'display_name',v_result->'track'->>'display_name'));
    END IF;
    RETURN v_result;
END $$;
CREATE OR REPLACE FUNCTION public.music_read_public_profile_for_viewer(p_auth_id TEXT, p_handle TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result JSONB; v_actor UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL) THEN
        RETURN jsonb_build_object('error','account_not_found');
    END IF;
    v_result := public.music_read_public_profile(p_handle);
    v_actor := (v_result->'profile'->>'creator_id')::UUID;
    IF private.music_actor_blocked(p_auth_id,v_actor) THEN
        RETURN jsonb_build_object('ok',true,'blocked',jsonb_build_object('creator_id',v_actor,'display_name',v_result->'profile'->>'display_name'));
    END IF;
    RETURN v_result;
END $$;
CREATE OR REPLACE FUNCTION public.music_public_rails_for_viewer(p_auth_id TEXT,p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL) THEN
        RETURN jsonb_build_object('error','account_not_found');
    END IF;
    RETURN (SELECT r || jsonb_build_object('by_creator',private.music_visible_tracks(r->'by_creator',p_auth_id),
        'similar',private.music_visible_tracks(r->'similar',p_auth_id)) FROM public.music_public_rails(p_slug) r);
END $$;
CREATE OR REPLACE FUNCTION public.music_best_of_playlists_for_viewer(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL) THEN
        RETURN jsonb_build_object('error','account_not_found');
    END IF;
    RETURN (SELECT r || jsonb_build_object('playlists',coalesce((SELECT jsonb_agg(
        item || jsonb_build_object('tracks',private.music_visible_tracks(item->'tracks',p_auth_id)) ORDER BY ord)
        FROM jsonb_array_elements(r->'playlists') WITH ORDINALITY AS p(item,ord)),'[]'::jsonb))
        FROM public.music_best_of_playlists() r);
END $$;
CREATE OR REPLACE FUNCTION private.music_blocks_forget_erased_user()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        DELETE FROM public.music_user_blocks WHERE blocker_id=NEW.id OR blocked_id=NEW.id;
        DELETE FROM public.music_actors WHERE user_id=NEW.id;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_music_blocks_forget_erased ON public.users;
CREATE TRIGGER users_music_blocks_forget_erased AFTER UPDATE OF deleted_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.music_blocks_forget_erased_user();
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
                             'music_play_listens', 'music_song_reports', 'music_mixdown_reservations', 'music_actors', 'music_user_blocks')
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
REVOKE ALL ON FUNCTION private.account_deletion_blockers(UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;
DO $$ BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0570(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0570;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT p_path IN ('/api/v1/music/blocks','/api/v1/music/blocks/:id',
        '/api/v1/music/explore/best-of','/api/v1/music/explore/tracks/:id','/api/v1/music/explore/creators/:id')
        OR public.telemetry_path_allowed_pre_0570(p_path);
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.music_actor_id(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.music_actor_id(UUID) TO service_role;
REVOKE ALL ON FUNCTION private.music_actor_field(UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.music_actor_field(UUID,TEXT) TO service_role;
REVOKE ALL ON FUNCTION private.music_actor_blocked(TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.music_actor_blocked(TEXT,UUID) TO service_role;
REVOKE ALL ON FUNCTION private.music_visible_tracks(JSONB,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.music_visible_tracks(JSONB,TEXT) TO service_role;
REVOKE ALL ON FUNCTION private.music_blocks_forget_erased_user() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.music_blocks_forget_erased_user() TO service_role;
REVOKE ALL ON FUNCTION public.music_publish_song(TEXT,UUID,UUID,TEXT,TEXT,BOOLEAN,BOOLEAN,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_publish_song(TEXT,UUID,UUID,TEXT,TEXT,BOOLEAN,BOOLEAN,TEXT,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.music_comment_mutate(TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_comment_mutate(TEXT,TEXT,JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.music_block_actor(TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_block_actor(TEXT,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.music_unblock_actor(TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_unblock_actor(TEXT,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.music_list_blocked_actors(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_list_blocked_actors(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.music_resolve_publication(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_resolve_publication(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.music_read_public_profile(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_read_public_profile(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.music_public_rails(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_public_rails(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.music_best_of_playlists() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_best_of_playlists() TO service_role;
REVOKE ALL ON FUNCTION public.music_comments_read(TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_comments_read(TEXT,TEXT,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.music_comments_read_for_viewer(TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_comments_read_for_viewer(TEXT,TEXT,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.music_resolve_publication_for_viewer(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_resolve_publication_for_viewer(TEXT,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.music_read_public_profile_for_viewer(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_read_public_profile_for_viewer(TEXT,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.music_public_rails_for_viewer(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_public_rails_for_viewer(TEXT,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.music_best_of_playlists_for_viewer(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_best_of_playlists_for_viewer(TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
