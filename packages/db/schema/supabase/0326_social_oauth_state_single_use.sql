-- OAuth state is random, identity-bound, short-lived and consumed before a
-- provider authorization code is exchanged. Store only a SHA-256 digest so a
-- database read cannot recover a usable state token.
CREATE TABLE IF NOT EXISTS public.social_oauth_states (
    state_hash TEXT PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
    auth_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    network TEXT NOT NULL CHECK (network IN (
        'instagram','linkedin','tiktok','twitter','youtube',
        'facebook','threads','pinterest','twitch','gmb'
    )),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '10 minutes'
);
CREATE INDEX IF NOT EXISTS social_oauth_states_auth_id_idx ON public.social_oauth_states(auth_id);
CREATE INDEX IF NOT EXISTS social_oauth_states_expiry_idx ON public.social_oauth_states(expires_at);
ALTER TABLE public.social_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_oauth_states FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_oauth_states FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prepare_social_oauth_state(
    p_auth_id UUID, p_network TEXT, p_state_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE auth_id = p_auth_id::TEXT)
        OR p_network NOT IN ('instagram','linkedin','tiktok','twitter','youtube','facebook','threads','pinterest','twitch','gmb')
        OR p_state_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN NULL;
    END IF;
    DELETE FROM public.social_oauth_states WHERE expires_at <= now();
    INSERT INTO public.social_oauth_states(state_hash, auth_id, network)
    VALUES (p_state_hash, p_auth_id, p_network)
    ON CONFLICT (state_hash) DO NOTHING;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.consume_social_oauth_state(
    p_auth_id UUID, p_network TEXT, p_state_hash TEXT
) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    DELETE FROM public.social_oauth_states
    WHERE state_hash = p_state_hash AND auth_id = p_auth_id
      AND network = p_network AND expires_at > now()
    RETURNING jsonb_build_object('ok', true);
$$;

REVOKE ALL ON FUNCTION public.prepare_social_oauth_state(UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_social_oauth_state(UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_social_oauth_state(UUID,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_social_oauth_state(UUID,TEXT,TEXT) TO service_role;
