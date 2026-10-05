-- ADR-0061: TikTok refresh tokens can rotate. Write the pair atomically,
-- only if the claimed connection is still active and both old ciphertexts
-- match. A disconnect, reconnect or competing refresh wins over stale work.
-- Additive: the existing YouTube access-only update RPC is unchanged.
CREATE OR REPLACE FUNCTION public.rotate_tiktok_account_tokens(
    p_account_id UUID,
    p_expected_access_token_enc BYTEA,
    p_expected_refresh_token_enc BYTEA,
    p_access_token_enc BYTEA,
    p_refresh_token_enc BYTEA,
    p_token_expires_at TIMESTAMPTZ,
    p_scopes TEXT[]
) RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
    UPDATE public.social_accounts
    SET access_token_enc = p_access_token_enc,
        refresh_token_enc = p_refresh_token_enc,
        token_expires_at = p_token_expires_at,
        scopes_granted = p_scopes
    WHERE id = p_account_id AND network = 'tiktok' AND status = 'active'
      AND access_token_enc = p_expected_access_token_enc
      AND refresh_token_enc = p_expected_refresh_token_enc
      AND octet_length(p_access_token_enc) > 0
      AND octet_length(p_refresh_token_enc) > 0
      AND p_token_expires_at > now() AND p_token_expires_at < 'infinity'::TIMESTAMPTZ
      AND p_scopes IS NOT NULL
    RETURNING jsonb_build_object('ok', true);
$$;
REVOKE ALL ON FUNCTION public.rotate_tiktok_account_tokens(UUID, BYTEA, BYTEA, BYTEA, BYTEA, TIMESTAMPTZ, TEXT[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_tiktok_account_tokens(UUID, BYTEA, BYTEA, BYTEA, BYTEA, TIMESTAMPTZ, TEXT[])
    TO service_role;
