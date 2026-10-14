-- 0298: align Publish entitlements with the product boundary. Free keeps one
-- connected account and Post now. A live Publish Plan allows five accounts;
-- scheduling and analytics are enforced by the application routes.
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
    v_limit      INTEGER := 1;
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
    IF EXISTS (
        SELECT 1 FROM public.social_publish_subscriptions s
        WHERE s.user_id = v_user AND s.status IN ('active', 'past_due')
          AND s.current_period_end IS NOT NULL AND s.current_period_end > now()
    ) THEN
        v_limit := 5;
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


CREATE OR REPLACE FUNCTION public.read_social_publish_entitlement(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_sub public.social_publish_subscriptions%ROWTYPE; v_plan public.social_publish_plans%ROWTYPE; v_paid BOOLEAN := false;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id = p_auth_id::UUID WHERE u.auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    SELECT * INTO v_sub FROM public.social_publish_subscriptions s WHERE s.user_id = v_user
      ORDER BY (s.status IN ('active', 'past_due')) DESC, s.created_at DESC LIMIT 1;
    IF FOUND THEN
      SELECT * INTO v_plan FROM public.social_publish_plans p WHERE p.id = v_sub.plan_id;
      v_paid := v_sub.status IN ('active', 'past_due') AND v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end > now();
    END IF;
    RETURN jsonb_build_object('ok', true, 'tier', CASE WHEN v_paid THEN 'publish' ELSE 'free' END,
      'account_limit', CASE WHEN v_paid THEN 5 ELSE 1 END,
      'analytics_days', CASE WHEN v_paid THEN v_plan.analytics_days ELSE 0 END,
      'best_time_enabled', v_paid AND v_plan.best_time_enabled,
      'subscription', CASE WHEN v_sub.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v_sub.id, 'plan_id', v_sub.plan_id, 'status', v_sub.status,
        'price_usd_cents', v_sub.price_usd_cents, 'current_period_end', v_sub.current_period_end,
        'cancel_at_period_end', v_sub.cancel_at_period_end, 'started_at', v_sub.started_at,
        'stripe_subscription_id', v_sub.stripe_subscription_id, 'stripe_customer_id', v_sub.stripe_customer_id) END);
END $$;
REVOKE ALL ON FUNCTION public.read_social_publish_entitlement(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_social_publish_entitlement(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
