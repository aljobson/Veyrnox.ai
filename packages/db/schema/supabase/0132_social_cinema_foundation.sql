-- Additive Social Cinema foundation (ADR-0048). No auth/provisioning or money changes.
-- Application callers supply the middleware-verified auth id through the server API.
-- No browser role can call these functions or access these tables directly.
CREATE TABLE IF NOT EXISTS public.cinema_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    username TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-z][a-z0-9_]{2,29}$'),
    display_name TEXT NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
    bio TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 500),
    create_key UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cinema_memberships (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer','creator','moderator','administrator')),
    account_status TEXT NOT NULL DEFAULT 'active'
        CHECK (account_status IN ('active','restricted','suspended','banned'))
);
ALTER TABLE public.cinema_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_memberships FORCE ROW LEVEL SECURITY;
-- No client policy: deny by default even if a client table grant drifts later.
REVOKE ALL ON public.cinema_profiles, public.cinema_memberships FROM PUBLIC, anon, authenticated, service_role;
-- No direct service-role writes either. Mutations go through the narrow function.

CREATE OR REPLACE FUNCTION public.create_cinema_profile(
    p_auth_id TEXT, p_idempotency_key UUID, p_profile JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user_id UUID;
    v_profile public.cinema_profiles%ROWTYPE;
    v_username TEXT;
    v_display_name TEXT;
    v_bio TEXT;
BEGIN
    IF p_auth_id IS NULL OR p_idempotency_key IS NULL OR p_profile IS NULL
        OR jsonb_typeof(p_profile) <> 'object' THEN
        RETURN jsonb_build_object('error','invalid_profile');
    END IF;
    -- No ownership, privilege, moderation or identity field can be supplied.
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_profile) AS k
               WHERE k NOT IN ('username','display_name','bio'))
        OR jsonb_typeof(p_profile->'username') IS DISTINCT FROM 'string'
        OR jsonb_typeof(p_profile->'display_name') IS DISTINCT FROM 'string'
        OR (p_profile ? 'bio' AND jsonb_typeof(p_profile->'bio') IS DISTINCT FROM 'string') THEN
        RETURN jsonb_build_object('error','invalid_profile');
    END IF;
    v_username := p_profile->>'username';
    v_display_name := btrim(p_profile->>'display_name');
    v_bio := coalesce(p_profile->>'bio','');
    IF v_username !~ '^[a-z][a-z0-9_]{2,29}$'
        OR length(v_display_name) NOT BETWEEN 1 AND 80 OR length(v_bio) > 500 THEN
        RETURN jsonb_build_object('error','invalid_profile');
    END IF;
    -- Serializes creation/replay for this existing identity. Never provisions a user.
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id FOR UPDATE;
    IF v_user_id IS NULL THEN RETURN jsonb_build_object('error','user_not_provisioned'); END IF;
    SELECT * INTO v_profile FROM public.cinema_profiles WHERE user_id = v_user_id;
    IF FOUND THEN
        IF v_profile.create_key = p_idempotency_key
            AND v_profile.username = v_username AND v_profile.display_name = v_display_name
            AND v_profile.bio = v_bio THEN
            RETURN jsonb_build_object('profile_id',v_profile.id,'idempotent',true);
        END IF;
        RETURN jsonb_build_object('error',CASE WHEN v_profile.create_key = p_idempotency_key
            THEN 'idempotency_conflict' ELSE 'profile_exists' END);
    END IF;
    BEGIN
        INSERT INTO public.cinema_profiles(user_id,username,display_name,bio,create_key)
        VALUES(v_user_id,v_username,v_display_name,v_bio,p_idempotency_key)
        RETURNING * INTO v_profile;
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('error','username_unavailable');
    END;
    -- Role/account state are server-owned and cannot be reset by a replay.
    INSERT INTO public.cinema_memberships(user_id) VALUES(v_user_id) ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('profile_id',v_profile.id,'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.read_own_cinema_profile(p_auth_id TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,
        'bio',p.bio,'role',m.role,'account_status',m.account_status)
    FROM public.users u JOIN public.cinema_profiles p ON p.user_id=u.id
    JOIN public.cinema_memberships m ON m.user_id=u.id WHERE u.auth_id=p_auth_id;
$$;

CREATE OR REPLACE FUNCTION public.read_public_cinema_profile(p_username TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'bio',p.bio)
    FROM public.cinema_profiles p JOIN public.cinema_memberships m ON m.user_id=p.user_id
    WHERE p.username=p_username AND m.account_status='active';
$$;

REVOKE ALL ON FUNCTION public.create_cinema_profile(TEXT,UUID,JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_own_cinema_profile(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_public_cinema_profile(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_cinema_profile(TEXT,UUID,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_own_cinema_profile(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_public_cinema_profile(TEXT) TO service_role;
