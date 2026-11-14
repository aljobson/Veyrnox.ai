-- 0504: two Music actions failed on every call in production.
--
-- 1. Local WAV renders (crop, fade, speed, reorder, remaster) insert a zero-credit
--    job with provider 'local' and state 'STORED'. 0472 added jobs_credits_check to
--    allow exactly that, but 0206's jobs_credits_or_free_check (credits > 0 OR
--    free_allowance) was never dropped. CHECK constraints are ANDed, so every
--    render commit raised 23514. jobs_credits_check already contains the 0206 rule
--    as its first two branches, so dropping the older constraint loosens nothing
--    except the local zero-credit row 0472 meant to allow. The drop is refused if
--    jobs_credits_check is missing, so jobs.credits is never left unchecked.
--
-- 2. music_publish_song called gen_random_bytes unqualified under search_path=''.
--    pgcrypto lives in the extensions schema on Supabase (public on a bare
--    Postgres), never pg_catalog, so every first publish raised 42883. The slug is
--    now built from pg_catalog functions only: sha256 over two random UUIDs, cut to
--    the 24 hex characters the slug CHECK requires. The body is otherwise unchanged
--    from 0463.
--
-- Idempotent: IF EXISTS, OR REPLACE, explicit revoke and grant.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_credits_check'
    ) THEN
        RAISE EXCEPTION '0504: jobs_credits_check is missing; refusing to drop jobs_credits_or_free_check';
    END IF;
END $$;

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_credits_or_free_check;

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
    v_slug := substr(encode(sha256(uuid_send(gen_random_uuid())||uuid_send(gen_random_uuid())),'hex'),1,24);
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
REVOKE ALL ON FUNCTION public.music_publish_song(TEXT,UUID,UUID,TEXT,TEXT,BOOLEAN,BOOLEAN,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_publish_song(TEXT,UUID,UUID,TEXT,TEXT,BOOLEAN,BOOLEAN,TEXT,TEXT) TO service_role;
