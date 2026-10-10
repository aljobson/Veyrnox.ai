-- 0265: owner decision 10 Oct 2026: basic scheduling free across several accounts.
-- Five active connections per user, shared across all owned brands. No payment.
-- New writer keeps the original one-account path valid until the Worker flag
-- is enabled after migration, the clean window and flow acceptance.
BEGIN;
CREATE OR REPLACE FUNCTION public.record_social_multi_account_connection(
    p_auth_id TEXT,
    p_brand_id UUID,
    p_network TEXT,
    p_external_account_id TEXT,
    p_display_name TEXT,
    p_avatar_url TEXT,
    p_scopes TEXT[],
    p_access_token_enc BYTEA,
    p_refresh_token_enc BYTEA,
    p_token_expires_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user       UUID;
    v_account_id UUID;
    v_existed    BOOLEAN;
    v_limit      CONSTANT INTEGER := 5;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT u.id INTO v_user FROM public.users u
    JOIN auth.users a ON a.id = p_auth_id::UUID
    WHERE u.auth_id = p_auth_id;
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.social_brands b WHERE b.id = p_brand_id AND b.owner_user_id = v_user) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BRAND_NOT_FOUND');
    END IF;

    -- One user at a time, so two concurrent callbacks cannot both pass the cap.
    PERFORM pg_advisory_xact_lock(169, hashtext(v_user::text));
    -- Existing active connections may refresh even for a grandfathered user
    -- over the limit; a revoked connection consumes a new slot.
    IF NOT EXISTS (SELECT 1 FROM public.social_accounts a WHERE a.brand_id = p_brand_id
        AND a.network = p_network AND a.external_account_id = p_external_account_id AND a.status = 'active')
      AND (SELECT count(*) FROM public.social_accounts a
        JOIN public.social_brands b ON b.id = a.brand_id
        WHERE b.owner_user_id = v_user AND a.status = 'active'
          AND NOT (a.brand_id = p_brand_id AND a.network = p_network
                   AND a.external_account_id = p_external_account_id)) >= v_limit THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_LIMIT', 'limit', v_limit);
    END IF;

    v_existed := EXISTS (
        SELECT 1 FROM public.social_accounts a
        WHERE a.brand_id = p_brand_id AND a.network = p_network AND a.external_account_id = p_external_account_id
    );

    INSERT INTO public.social_accounts (
        brand_id, network, external_account_id, display_name, avatar_url,
        scopes_granted, access_token_enc, refresh_token_enc, token_expires_at, status, disconnected_at
    ) VALUES (
        p_brand_id, p_network, p_external_account_id, p_display_name, p_avatar_url,
        COALESCE(p_scopes, '{}'), p_access_token_enc, p_refresh_token_enc, p_token_expires_at, 'active', NULL
    )
    ON CONFLICT (brand_id, network, external_account_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        avatar_url = EXCLUDED.avatar_url,
        scopes_granted = EXCLUDED.scopes_granted,
        access_token_enc = EXCLUDED.access_token_enc,
        refresh_token_enc = EXCLUDED.refresh_token_enc,
        token_expires_at = EXCLUDED.token_expires_at,
        status = 'active',
        disconnected_at = NULL
    RETURNING id INTO v_account_id;

    INSERT INTO public.social_account_actions (actor_id, brand_id, action, target_id, detail)
    VALUES (v_user, p_brand_id, CASE WHEN v_existed THEN 'reconnect' ELSE 'connect' END, v_account_id,
        jsonb_build_object('network', p_network));

    RETURN jsonb_build_object('ok', true, 'account_id', v_account_id, 'idempotent', v_existed);
END $$;

REVOKE ALL ON FUNCTION public.record_social_multi_account_connection(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], BYTEA, BYTEA, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_social_multi_account_connection(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], BYTEA, BYTEA, TIMESTAMPTZ) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
