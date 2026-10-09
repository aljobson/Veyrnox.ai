-- ADR-0061 extension: keep Page/board/location tokens server-side while a
-- tester chooses a destination. Short-lived, single-use, identity-bound.
CREATE TABLE IF NOT EXISTS public.social_connection_selections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    network TEXT NOT NULL CHECK (network IN ('facebook','pinterest','gmb')),
    payload_enc BYTEA NOT NULL CHECK (octet_length(payload_enc) BETWEEN 1 AND 1048576),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '10 minutes',
    UNIQUE (auth_id, network)
);
CREATE INDEX IF NOT EXISTS social_connection_selections_expiry_idx ON public.social_connection_selections(expires_at);
ALTER TABLE public.social_connection_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_connection_selections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_connection_selections FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prepare_social_connection_selection(p_auth_id UUID, p_network TEXT, p_payload_enc BYTEA)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE auth_id = p_auth_id::TEXT)
        OR p_network NOT IN ('facebook','pinterest','gmb') OR p_network IS NULL
        OR p_payload_enc IS NULL OR octet_length(p_payload_enc) NOT BETWEEN 1 AND 1048576 THEN RETURN NULL; END IF;
    DELETE FROM public.social_connection_selections WHERE expires_at <= now();
    INSERT INTO public.social_connection_selections(auth_id, network, payload_enc)
    VALUES(p_auth_id, p_network, p_payload_enc)
    ON CONFLICT (auth_id, network) DO UPDATE SET id = gen_random_uuid(), payload_enc = EXCLUDED.payload_enc,
        expires_at = now() + INTERVAL '10 minutes'
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.consume_social_connection_selection(p_auth_id UUID, p_network TEXT, p_id UUID)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    DELETE FROM public.social_connection_selections
    WHERE id = p_id AND auth_id = p_auth_id AND network = p_network AND expires_at > now()
    RETURNING jsonb_build_object('payload_enc', payload_enc);
$$;

-- Compare both old ciphertexts atomically: a competing refresh, reconnect or
-- disconnect wins over stale cron work. Existing YouTube/TikTok RPCs stay intact.
CREATE OR REPLACE FUNCTION public.rotate_extended_social_tokens(
    p_account_id UUID, p_network TEXT, p_expected_access_token_enc BYTEA, p_expected_refresh_token_enc BYTEA,
    p_access_token_enc BYTEA, p_refresh_token_enc BYTEA, p_token_expires_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    UPDATE public.social_accounts SET access_token_enc = p_access_token_enc, refresh_token_enc = p_refresh_token_enc,
        token_expires_at = p_token_expires_at
    WHERE id = p_account_id AND network = p_network AND status = 'active'
      AND p_network IN ('pinterest','threads','bluesky','twitch','gmb')
      AND access_token_enc = p_expected_access_token_enc
      AND refresh_token_enc IS NOT DISTINCT FROM p_expected_refresh_token_enc
      AND (p_network = 'threads' OR octet_length(p_expected_refresh_token_enc) > 0)
      AND octet_length(p_access_token_enc) > 0
      AND (p_network = 'threads' OR octet_length(p_refresh_token_enc) > 0)
      AND p_token_expires_at > now() AND p_token_expires_at < 'infinity'::TIMESTAMPTZ
    RETURNING jsonb_build_object('ok', true);
$$;
REVOKE ALL ON FUNCTION public.prepare_social_connection_selection(UUID,TEXT,BYTEA) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_social_connection_selection(UUID,TEXT,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotate_extended_social_tokens(UUID,TEXT,BYTEA,BYTEA,BYTEA,BYTEA,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_social_connection_selection(UUID,TEXT,BYTEA) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_social_connection_selection(UUID,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_extended_social_tokens(UUID,TEXT,BYTEA,BYTEA,BYTEA,BYTEA,TIMESTAMPTZ) TO service_role;

-- New providers lack a universal idempotency key. Commit this marker before
-- publishing so a lost response/Worker crash cannot trigger another public
-- post. An uncertain result needs reconciliation rather than blind retry.
CREATE OR REPLACE FUNCTION public.mark_social_provider_submission(p_target_id UUID, p_claim_key UUID, p_network TEXT)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    UPDATE public.social_post_targets
    SET provider_state = provider_state || '{"submission_started":true}'::JSONB
    WHERE id = p_target_id AND claim_key = p_claim_key AND publish_status = 'publishing'
      AND network = p_network AND network IN ('facebook','threads','pinterest','bluesky','gmb')
      AND NOT (provider_state ? 'submission_started')
    RETURNING jsonb_build_object('ok', true);
$$;
REVOKE ALL ON FUNCTION public.mark_social_provider_submission(UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_social_provider_submission(UUID,UUID,TEXT) TO service_role;
