-- 0423: a time-boxed, audited complimentary Publish Plan (ADR-0315).
-- Nothing calls this from the app. service_role only; a person with the
-- database runs it once, naming who decided in p_reason. The grant lapses by
-- itself: read_social_publish_entitlement treats a subscription as paid only
-- while current_period_end is in the future.
BEGIN;

ALTER TABLE public.social_publish_subscriptions
    ADD COLUMN IF NOT EXISTS comp_reason TEXT NULL
        CHECK (comp_reason IS NULL OR char_length(comp_reason) BETWEEN 20 AND 500);
ALTER TABLE public.social_publish_subscriptions
    ADD COLUMN IF NOT EXISTS comp_days INTEGER NULL
        CHECK (comp_days IS NULL OR comp_days BETWEEN 1 AND 14);

CREATE OR REPLACE FUNCTION public.grant_social_publish_comp(
    p_auth_id TEXT, p_plan_id TEXT, p_idempotency_key TEXT, p_days INTEGER, p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID; v_frozen BOOLEAN; v_plan public.social_publish_plans%ROWTYPE;
    v_existing public.social_publish_subscriptions%ROWTYPE; v_id UUID; v_end TIMESTAMPTZ;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED');
    END IF;
    IF p_days IS NULL OR p_days < 1 OR p_days > 14 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_DAYS');
    END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) < 20 OR char_length(p_reason) > 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
    END IF;
    SELECT u.id, u.frozen_at IS NOT NULL INTO v_user, v_frozen
    FROM public.users u JOIN auth.users a ON a.id = p_auth_id::UUID WHERE u.auth_id = p_auth_id
    FOR NO KEY UPDATE OF u;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    IF v_frozen THEN RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN'); END IF;
    PERFORM pg_advisory_xact_lock(293, hashtext(v_user::text));

    SELECT * INTO v_existing FROM public.social_publish_subscriptions s
      WHERE s.user_id = v_user AND s.idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_existing.comp_reason IS NULL
           OR v_existing.plan_id IS DISTINCT FROM p_plan_id
           OR v_existing.comp_days IS DISTINCT FROM p_days
           OR v_existing.comp_reason IS DISTINCT FROM btrim(p_reason) THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
        END IF;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'subscription_id', v_existing.id,
            'status', v_existing.status, 'current_period_end', v_existing.current_period_end);
    END IF;

    SELECT * INTO v_plan FROM public.social_publish_plans p WHERE p.id = p_plan_id AND p.active;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'PLAN_NOT_FOUND'); END IF;
    IF EXISTS (SELECT 1 FROM public.social_publish_subscriptions s
               WHERE s.user_id = v_user AND s.status IN ('active', 'past_due')) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_ALREADY_ACTIVE');
    END IF;

    v_end := now() + make_interval(days => p_days);
    INSERT INTO public.social_publish_subscriptions
      (user_id, plan_id, idempotency_key, price_usd_cents, consent_version, status,
       current_period_end, cancel_at_period_end, last_event_at, started_at, comp_reason, comp_days)
    VALUES (v_user, v_plan.id, p_idempotency_key, v_plan.price_usd_cents, 'admin-comp', 'active',
       v_end, true, now(), now(), btrim(p_reason), p_days)
    RETURNING id INTO v_id;
    INSERT INTO public.social_publish_subscription_events
      (subscription_id, stripe_event_id, type, status, period_end, occurred_at)
    VALUES (v_id, 'evt_comp_' || replace(v_id::text, '-', '_'),
       'publish.admin_comp', 'active', v_end, now());
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'subscription_id', v_id,
        'status', 'active', 'current_period_end', v_end);
END $$;

-- Same body as 0298, plus 'complimentary' (no reason is exposed) so the app can tell a comp from a store plan.
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
        'stripe_subscription_id', v_sub.stripe_subscription_id, 'stripe_customer_id', v_sub.stripe_customer_id,
        'complimentary', v_sub.comp_reason IS NOT NULL) END);
END $$;
REVOKE ALL ON FUNCTION public.read_social_publish_entitlement(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_social_publish_entitlement(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.grant_social_publish_comp(TEXT, TEXT, TEXT, INTEGER, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_social_publish_comp(TEXT, TEXT, TEXT, INTEGER, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
