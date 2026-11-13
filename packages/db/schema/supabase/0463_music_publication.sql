-- Separate, policy-gated public publication. Link-only sharing remains the
-- default. Commercial status is an eligibility projection, never a promise
-- that a user's prompts, uploads or use satisfy third-party rights or terms.

CREATE TABLE IF NOT EXISTS public.music_creator_profiles (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE RESTRICT,
    handle TEXT NOT NULL UNIQUE CHECK (handle ~ '^[a-z][a-z0-9_]{2,29}$'),
    display_name TEXT NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.music_publication_attestations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    statement_version TEXT NOT NULL CHECK (statement_version = 'music-publication-rights-v1'),
    claims JSONB NOT NULL CHECK (claims = '{"publication_permission":true,"terms_acknowledged":true}'::jsonb),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS music_publication_attestations_id_user_idx
    ON public.music_publication_attestations(id,user_id);

CREATE TABLE IF NOT EXISTS public.music_publications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    song_id UUID NOT NULL,
    song_version_id UUID NOT NULL,
    attestation_id UUID NOT NULL,
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-f0-9]{24}$'),
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','unpublished','blocked')),
    allow_comments BOOLEAN NOT NULL DEFAULT false,
    allow_remixes BOOLEAN NOT NULL DEFAULT false,
    policy_version TEXT NOT NULL CHECK (char_length(policy_version) BETWEEN 1 AND 80),
    commercial_status TEXT NOT NULL CHECK (commercial_status IN ('personal_use_only','plan_eligible_terms_apply')),
    idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,120}$'),
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    unpublished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id,idempotency_key),
    CONSTRAINT music_publications_version_owner_fk FOREIGN KEY (song_version_id,user_id,song_id)
        REFERENCES public.music_song_versions(id,user_id,song_id) ON DELETE RESTRICT,
    CONSTRAINT music_publications_attestation_owner_fk FOREIGN KEY (attestation_id,user_id)
        REFERENCES public.music_publication_attestations(id,user_id) ON DELETE RESTRICT,
    CHECK ((status = 'unpublished') = (unpublished_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS music_publications_one_live_song_idx
    ON public.music_publications(song_id) WHERE status='published';
CREATE INDEX IF NOT EXISTS music_publications_profile_idx
    ON public.music_publications(user_id,status,published_at DESC);

DO $$ DECLARE t TEXT; BEGIN
    FOREACH t IN ARRAY ARRAY['music_creator_profiles','music_publication_attestations','music_publications'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
        EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO service_role',t);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.music_reject_publication_attestation_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
    RAISE EXCEPTION 'music publication rights evidence is immutable'
        USING ERRCODE='integrity_constraint_violation';
END $$;
REVOKE ALL ON FUNCTION private.music_reject_publication_attestation_mutation() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.music_reject_publication_attestation_mutation() TO service_role;
DROP TRIGGER IF EXISTS music_publication_attestations_immutable ON public.music_publication_attestations;
CREATE TRIGGER music_publication_attestations_immutable BEFORE UPDATE OR DELETE
ON public.music_publication_attestations FOR EACH ROW
EXECUTE FUNCTION private.music_reject_publication_attestation_mutation();

CREATE OR REPLACE FUNCTION public.music_get_publication_context(p_auth_id TEXT,p_song_id UUID,p_version_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row JSONB; BEGIN
    SELECT jsonb_build_object('ok',true,'title',s.title,'prompt',ps.prompt)
    INTO v_row
    FROM public.users u
    JOIN public.music_songs s ON s.user_id=u.id
    JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=u.id AND v.song_id=s.id
    JOIN public.music_generation_requests gr ON gr.id=v.generation_request_id
    JOIN public.music_prompt_specs ps ON ps.id=gr.prompt_spec_id
    WHERE u.auth_id=p_auth_id AND s.id=p_song_id AND s.current_version_id=p_version_id AND s.status='active';
    RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','NOT_FOUND'));
END $$;

CREATE OR REPLACE FUNCTION public.music_publish_song(
    p_auth_id TEXT,p_song_id UUID,p_version_id UUID,p_handle TEXT,p_display_name TEXT,
    p_allow_comments BOOLEAN,p_allow_remixes BOOLEAN,p_policy_version TEXT,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    v_user UUID; v_existing public.music_publications%ROWTYPE; v_live public.music_publications%ROWTYPE;
    v_attestation UUID; v_commercial TEXT; v_slug TEXT;
BEGIN
    IF p_handle !~ '^[a-z][a-z0-9_]{2,29}$' OR char_length(btrim(p_display_name)) NOT BETWEEN 1 AND 80
       OR p_allow_comments IS NULL OR p_allow_remixes IS NULL
       OR p_policy_version IS NULL OR char_length(p_policy_version) NOT BETWEEN 1 AND 80
       OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF NOT EXISTS(SELECT 1 FROM public.music_songs s JOIN public.music_song_versions v
        ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
        WHERE s.id=p_song_id AND s.user_id=v_user AND s.current_version_id=p_version_id AND s.status='active') THEN
        RETURN jsonb_build_object('ok',false,'code','NOT_FOUND');
    END IF;
    SELECT * INTO v_existing FROM public.music_publications
        WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
    IF FOUND THEN
        IF v_existing.song_id IS DISTINCT FROM p_song_id OR v_existing.song_version_id IS DISTINCT FROM p_version_id
           OR v_existing.allow_comments IS DISTINCT FROM p_allow_comments OR v_existing.allow_remixes IS DISTINCT FROM p_allow_remixes THEN
            RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
        END IF;
        RETURN jsonb_build_object('ok',true,'idempotent',true,'publication',jsonb_build_object(
            'slug',v_existing.slug,'status',v_existing.status,'allow_comments',v_existing.allow_comments,
            'allow_remixes',v_existing.allow_remixes,'commercial_status',v_existing.commercial_status,
            'handle',p_handle,'display_name',p_display_name));
    END IF;
    IF EXISTS(SELECT 1 FROM public.music_creator_profiles WHERE handle=p_handle AND user_id<>v_user) THEN
        RETURN jsonb_build_object('ok',false,'code','HANDLE_TAKEN');
    END IF;
    INSERT INTO public.music_creator_profiles(user_id,handle,display_name)
    VALUES(v_user,p_handle,btrim(p_display_name))
    ON CONFLICT(user_id) DO UPDATE SET handle=EXCLUDED.handle,display_name=EXCLUDED.display_name,updated_at=now();
    SELECT * INTO v_live FROM public.music_publications WHERE song_id=p_song_id AND status='published' FOR UPDATE;
    IF FOUND THEN
        RETURN jsonb_build_object('ok',true,'idempotent',true,'publication',jsonb_build_object(
            'slug',v_live.slug,'status',v_live.status,'allow_comments',v_live.allow_comments,
            'allow_remixes',v_live.allow_remixes,'commercial_status',v_live.commercial_status,
            'handle',p_handle,'display_name',p_display_name));
    END IF;
    INSERT INTO public.music_publication_attestations(user_id,statement_version,claims)
    VALUES(v_user,'music-publication-rights-v1','{"publication_permission":true,"terms_acknowledged":true}'::jsonb)
    RETURNING id INTO v_attestation;
    v_commercial := CASE WHEN EXISTS(SELECT 1 FROM public.credit_subscriptions
        WHERE user_id=v_user AND status='active' AND current_period_end>now()
          AND plan_id IN ('starter-monthly','plus-monthly','ultra-monthly'))
        THEN 'plan_eligible_terms_apply' ELSE 'personal_use_only' END;
    v_slug := encode(gen_random_bytes(12),'hex');
    INSERT INTO public.music_publications(user_id,song_id,song_version_id,attestation_id,slug,
        allow_comments,allow_remixes,policy_version,commercial_status,idempotency_key)
    VALUES(v_user,p_song_id,p_version_id,v_attestation,v_slug,p_allow_comments,p_allow_remixes,
        p_policy_version,v_commercial,p_idempotency_key) RETURNING * INTO v_live;
    RETURN jsonb_build_object('ok',true,'idempotent',false,'publication',jsonb_build_object(
        'slug',v_live.slug,'status',v_live.status,'allow_comments',v_live.allow_comments,
        'allow_remixes',v_live.allow_remixes,'commercial_status',v_live.commercial_status,
        'handle',p_handle,'display_name',p_display_name));
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok',false,'code','HANDLE_TAKEN');
END $$;

CREATE OR REPLACE FUNCTION public.music_read_song_publication(p_auth_id TEXT,p_song_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT jsonb_build_object('ok',true,'publication',COALESCE((SELECT jsonb_build_object(
        'slug',p.slug,'status',p.status,'allow_comments',p.allow_comments,'allow_remixes',p.allow_remixes,
        'commercial_status',p.commercial_status,'handle',cp.handle,'display_name',cp.display_name,
        'published_at',p.published_at) FROM public.music_publications p
        JOIN public.users u ON u.id=p.user_id JOIN public.music_creator_profiles cp ON cp.user_id=p.user_id
        WHERE u.auth_id=p_auth_id AND p.song_id=p_song_id ORDER BY p.created_at DESC LIMIT 1),'null'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.music_unpublish_song(p_auth_id TEXT,p_song_id UUID,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.music_publications%ROWTYPE; BEGIN
    SELECT p.* INTO v_row FROM public.music_publications p JOIN public.users u ON u.id=p.user_id
    WHERE u.auth_id=p_auth_id AND p.song_id=p_song_id ORDER BY p.created_at DESC LIMIT 1 FOR UPDATE OF p;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF v_row.status='published' THEN UPDATE public.music_publications SET status='unpublished',unpublished_at=now(),updated_at=now() WHERE id=v_row.id; END IF;
    RETURN jsonb_build_object('ok',true,'idempotent',v_row.status<>'published');
END $$;

CREATE OR REPLACE FUNCTION public.music_resolve_publication(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row JSONB; BEGIN
    SELECT jsonb_build_object('title',s.title,'version_number',v.version_number,'job_id',v.job_id,
        'published_at',p.published_at,'allow_comments',p.allow_comments,'allow_remixes',p.allow_remixes,
        'commercial_status',p.commercial_status,'handle',cp.handle,'display_name',cp.display_name)
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
    SELECT jsonb_build_object('handle',handle,'display_name',display_name) INTO v_profile
    FROM public.music_creator_profiles WHERE handle=p_handle;
    IF v_profile IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('slug',p.slug,'title',s.title,'published_at',p.published_at,
        'commercial_status',p.commercial_status) ORDER BY p.published_at DESC),'[]'::jsonb) INTO v_tracks
    FROM public.music_publications p JOIN public.music_songs s ON s.id=p.song_id AND s.user_id=p.user_id
    JOIN public.music_creator_profiles cp ON cp.user_id=p.user_id
    WHERE cp.handle=p_handle AND p.status='published' AND s.status='active';
    RETURN jsonb_build_object('ok',true,'profile',v_profile,'tracks',v_tracks);
END $$;

CREATE OR REPLACE FUNCTION public.music_resolve_publication_asset(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_asset public.assets%ROWTYPE; BEGIN
    SELECT a.* INTO v_asset FROM public.music_publications p
    JOIN public.music_songs s ON s.id=p.song_id AND s.user_id=p.user_id AND s.status='active'
    JOIN public.music_song_versions v ON v.id=p.song_version_id AND v.user_id=p.user_id
    JOIN public.assets a ON a.id=v.audio_asset_id WHERE p.slug=p_slug AND p.status='published';
    RETURN CASE WHEN NOT FOUND THEN jsonb_build_object('ok',false,'code','NOT_FOUND')
        ELSE jsonb_build_object('ok',true,'r2_key',v_asset.r2_key,'mime_type',v_asset.mime_type) END;
END $$;

REVOKE ALL ON FUNCTION public.music_get_publication_context(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_publish_song(TEXT,UUID,UUID,TEXT,TEXT,BOOLEAN,BOOLEAN,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_read_song_publication(TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_unpublish_song(TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_resolve_publication(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_read_public_profile(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_resolve_publication_asset(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_publication_context(TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_publish_song(TEXT,UUID,UUID,TEXT,TEXT,BOOLEAN,BOOLEAN,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_read_song_publication(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_unpublish_song(TEXT,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_resolve_publication(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_read_public_profile(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_resolve_publication_asset(TEXT) TO service_role;
