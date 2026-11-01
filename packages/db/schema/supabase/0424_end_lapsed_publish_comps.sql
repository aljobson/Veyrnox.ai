-- 0424: a complimentary Publish plan that has run out no longer blocks or flags a real subscription (ADR-0315 amendment 1).
-- 0423 left a lapsed comp row at status 'active', so a later Stripe start was refused (SUBSCRIPTION_ALREADY_ACTIVE) and a
-- later Stripe or store event stored the paid row as 'flagged' while the person had paid. A lapsed comp is now ended first,
-- inside the same transaction and under the same per-user lock, by the one helper below. The four function bodies are the
-- current ones (0293, 0346, 0423) plus one PERFORM line each.
BEGIN;

CREATE OR REPLACE FUNCTION public.end_lapsed_social_publish_comps(p_user_id UUID) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count INTEGER;
BEGIN
    UPDATE public.social_publish_subscriptions
       SET status = 'ended', ended_at = now(), end_reason = 'subscription_ended', updated_at = now()
     WHERE user_id = p_user_id AND comp_reason IS NOT NULL
       AND status IN ('active', 'past_due') AND current_period_end IS NOT NULL AND current_period_end <= now();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.end_lapsed_social_publish_comps(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_lapsed_social_publish_comps(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.start_social_publish_subscription(
    p_auth_id TEXT, p_plan_id TEXT, p_idempotency_key TEXT, p_consent_version TEXT,
    p_limit_per_window INTEGER, p_window_seconds INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID; v_frozen BOOLEAN; v_plan public.social_publish_plans%ROWTYPE;
    v_existing public.social_publish_subscriptions%ROWTYPE; v_count INTEGER; v_retry INTEGER; v_id UUID;
BEGIN
    IF p_limit_per_window IS NULL OR p_limit_per_window <= 0 OR p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_LIMIT');
    END IF;
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT u.id, u.frozen_at IS NOT NULL INTO v_user, v_frozen
    FROM public.users u JOIN auth.users a ON a.id = p_auth_id::UUID WHERE u.auth_id = p_auth_id
    FOR NO KEY UPDATE OF u;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    IF v_frozen THEN RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN'); END IF;
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED');
    END IF;
    PERFORM pg_advisory_xact_lock(293, hashtext(v_user::text));
    PERFORM public.end_lapsed_social_publish_comps(v_user);
    SELECT * INTO v_existing FROM public.social_publish_subscriptions s
      WHERE s.user_id = v_user AND s.idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_existing.plan_id <> p_plan_id THEN RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED'); END IF;
        SELECT * INTO v_plan FROM public.social_publish_plans p WHERE p.id = v_existing.plan_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'subscription_id', v_existing.id,
            'plan_id', v_existing.plan_id, 'billing_interval', v_plan.billing_interval,
            'price_usd_cents', v_existing.price_usd_cents, 'status', v_existing.status);
    END IF;
    IF p_consent_version IS NULL OR p_consent_version !~ '^[A-Za-z0-9._-]{1,48}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CONSENT_VERSION_REQUIRED');
    END IF;
    SELECT * INTO v_plan FROM public.social_publish_plans p WHERE p.id = p_plan_id AND p.active;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'PLAN_NOT_FOUND'); END IF;
    IF EXISTS (SELECT 1 FROM public.social_publish_subscriptions s
               WHERE s.user_id = v_user AND s.status IN ('active', 'past_due')) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_ALREADY_ACTIVE');
    END IF;
    SELECT count(*) INTO v_count FROM public.social_publish_subscriptions s
      WHERE s.user_id = v_user AND s.created_at > now() - make_interval(secs => p_window_seconds);
    IF v_count >= p_limit_per_window THEN
        SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (min(s.created_at) + make_interval(secs => p_window_seconds) - now()))))::int
          INTO v_retry FROM public.social_publish_subscriptions s
          WHERE s.user_id = v_user AND s.created_at > now() - make_interval(secs => p_window_seconds);
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'retry_after_seconds', COALESCE(v_retry, p_window_seconds));
    END IF;
    INSERT INTO public.social_publish_subscriptions
      (user_id, plan_id, idempotency_key, price_usd_cents, consent_version)
    VALUES (v_user, v_plan.id, p_idempotency_key, v_plan.price_usd_cents, p_consent_version)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'subscription_id', v_id,
      'plan_id', v_plan.id, 'billing_interval', v_plan.billing_interval,
      'price_usd_cents', v_plan.price_usd_cents, 'status', 'pending');
END $$;

CREATE OR REPLACE FUNCTION public.apply_social_publish_subscription_event(
    p_event_id TEXT, p_type TEXT, p_publish_subscription_id UUID, p_stripe_subscription_id TEXT,
    p_customer_id TEXT, p_status TEXT, p_period_end TIMESTAMPTZ,
    p_cancel_at_period_end BOOLEAN, p_occurred_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_sub public.social_publish_subscriptions%ROWTYPE;
    v_event public.social_publish_subscription_events%ROWTYPE;
    v_new TEXT; v_flagged BOOLEAN := false;
BEGIN
    IF p_event_id IS NULL OR p_event_id !~ '^(evt|cs)_[A-Za-z0-9_]{1,250}$'
       OR p_type IS NULL OR p_type !~ '^[a-z_.]{1,64}$'
       OR p_status IS NULL OR p_status NOT IN ('active', 'past_due', 'ended', 'incomplete')
       OR p_occurred_at IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT'); END IF;
    IF p_stripe_subscription_id IS NULL OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9_]{1,250}$'
       OR (p_customer_id IS NOT NULL AND p_customer_id !~ '^cus_[A-Za-z0-9_]{1,250}$') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SUBSCRIPTION');
    END IF;
    SELECT * INTO v_event FROM public.social_publish_subscription_events e WHERE e.stripe_event_id = p_event_id;
    IF FOUND THEN
        SELECT s.status INTO v_new FROM public.social_publish_subscriptions s WHERE s.id = v_event.subscription_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'subscription_id', v_event.subscription_id,
          'status', v_new, 'flagged', v_new = 'flagged');
    END IF;
    SELECT * INTO v_sub FROM public.social_publish_subscriptions s
      WHERE s.stripe_subscription_id = p_stripe_subscription_id FOR UPDATE;
    IF FOUND THEN
        IF p_publish_subscription_id IS NOT NULL AND p_publish_subscription_id <> v_sub.id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_MISMATCH');
        END IF;
    ELSE
        IF p_publish_subscription_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND'); END IF;
        SELECT * INTO v_sub FROM public.social_publish_subscriptions s
          WHERE s.id = p_publish_subscription_id AND s.status = 'pending' AND s.stripe_subscription_id IS NULL FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND'); END IF;
        UPDATE public.social_publish_subscriptions SET stripe_subscription_id = p_stripe_subscription_id, updated_at = now()
          WHERE id = v_sub.id;
        v_sub.stripe_subscription_id := p_stripe_subscription_id;
    END IF;
    IF (v_sub.last_event_at IS NOT NULL AND p_occurred_at < v_sub.last_event_at)
       OR v_sub.status IN ('ended', 'flagged')
       OR (p_status = 'incomplete' AND v_sub.status IN ('active', 'past_due')) THEN
        INSERT INTO public.social_publish_subscription_events
          (subscription_id, stripe_event_id, type, status, period_end, occurred_at)
        VALUES (v_sub.id, p_event_id, p_type, p_status, p_period_end, p_occurred_at);
        RETURN jsonb_build_object('ok', true, 'idempotent', false, 'stale', true,
          'subscription_id', v_sub.id, 'status', v_sub.status, 'flagged', v_sub.status = 'flagged');
    END IF;
    PERFORM public.end_lapsed_social_publish_comps(v_sub.user_id);
    v_new := CASE p_status WHEN 'incomplete' THEN 'pending' ELSE p_status END;
    IF v_new IN ('active', 'past_due') AND v_sub.status NOT IN ('active', 'past_due') AND EXISTS (
      SELECT 1 FROM public.social_publish_subscriptions other
      WHERE other.user_id = v_sub.user_id AND other.id <> v_sub.id AND other.status IN ('active', 'past_due')) THEN
        v_new := 'flagged'; v_flagged := true;
    END IF;
    UPDATE public.social_publish_subscriptions SET
      status = v_new, stripe_customer_id = COALESCE(p_customer_id, stripe_customer_id),
      current_period_end = COALESCE(p_period_end, current_period_end),
      cancel_at_period_end = COALESCE(p_cancel_at_period_end, cancel_at_period_end),
      started_at = CASE WHEN v_new IN ('active', 'past_due') THEN COALESCE(started_at, p_occurred_at) ELSE started_at END,
      ended_at = CASE WHEN v_new = 'ended' THEN COALESCE(ended_at, p_occurred_at) ELSE ended_at END,
      end_reason = CASE WHEN v_new = 'ended' THEN COALESCE(end_reason, 'subscription_ended')
                        WHEN v_new = 'flagged' THEN 'superseded' ELSE end_reason END,
      last_event_at = p_occurred_at, updated_at = now()
    WHERE id = v_sub.id;
    INSERT INTO public.social_publish_subscription_events
      (subscription_id, stripe_event_id, type, status, period_end, occurred_at)
    VALUES (v_sub.id, p_event_id, p_type, p_status, p_period_end, p_occurred_at);
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'stale', false,
      'flagged', v_flagged, 'subscription_id', v_sub.id, 'user_id', v_sub.user_id, 'status', v_new);
END $$;

CREATE OR REPLACE FUNCTION public.apply_store_publish_event(
    p_rc_customer_id TEXT,
    p_channel TEXT,
    p_store_product_id TEXT,
    p_original_transaction_id TEXT,
    p_event_id TEXT,
    p_action TEXT,
    p_type TEXT,
    p_period_end TIMESTAMPTZ,
    p_occurred_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_event_key TEXT;
    v_sub public.social_publish_subscriptions%ROWTYPE;
    v_plan public.social_publish_plans%ROWTYPE;
    v_event public.social_publish_subscription_events%ROWTYPE;
    v_new TEXT;
    v_flagged BOOLEAN := false;
BEGIN
    IF p_channel IS NULL OR p_channel NOT IN ('ios', 'android')
       OR p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9._-]{8,128}$'
       OR p_action IS NULL OR p_action NOT IN ('activate', 'cancel_at_period_end', 'past_due', 'expire', 'refund')
       OR p_type IS NULL OR p_type !~ '^[a-z_.]{1,64}$'
       OR p_original_transaction_id IS NULL OR char_length(p_original_transaction_id) NOT BETWEEN 1 AND 200
       OR p_store_product_id IS NULL OR p_store_product_id !~ '^[A-Za-z0-9._:-]{1,200}$'
       OR p_occurred_at IS NULL
       OR (p_action = 'activate' AND p_period_end IS NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT');
    END IF;

    IF p_rc_customer_id IS NULL OR p_rc_customer_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CUSTOMER_NOT_FOUND');
    END IF;
    SELECT sc.user_id INTO v_user_id FROM public.store_customers sc WHERE sc.rc_customer_id = p_rc_customer_id::uuid;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CUSTOMER_NOT_FOUND');
    END IF;

    v_event_key := 'rc_' || regexp_replace(p_event_id, '[^A-Za-z0-9_]', '_', 'g');
    PERFORM pg_advisory_xact_lock(hashtextextended(p_channel || ':' || p_original_transaction_id, 0));

    SELECT * INTO v_event FROM public.social_publish_subscription_events e WHERE e.stripe_event_id = v_event_key;
    IF FOUND THEN
        SELECT s.status INTO v_new FROM public.social_publish_subscriptions s WHERE s.id = v_event.subscription_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'subscription_id', v_event.subscription_id,
                                  'status', v_new, 'flagged', v_new = 'flagged');
    END IF;

    SELECT * INTO v_sub FROM public.social_publish_subscriptions s
    WHERE s.store_channel = p_channel AND s.store_original_transaction_id = p_original_transaction_id FOR UPDATE;
    IF v_sub.id IS NOT NULL AND v_sub.user_id <> v_user_id THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_OWNED_BY_OTHER');
    END IF;

    IF p_action = 'activate' THEN
        SELECT p.* INTO v_plan FROM public.social_publish_store_products sp
        JOIN public.social_publish_plans p ON p.id = sp.plan_id
        WHERE sp.channel = p_channel AND sp.store_product_id = p_store_product_id;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('ok', false, 'code', 'PLAN_NOT_FOUND');
        END IF;
    END IF;

    IF v_sub.id IS NULL THEN
        IF p_action <> 'activate' THEN
            RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND');
        END IF;
        INSERT INTO public.social_publish_subscriptions
            (user_id, plan_id, idempotency_key, price_usd_cents, consent_version, status,
             store_channel, store_original_transaction_id)
        VALUES (v_user_id, v_plan.id, public.store_order_id(p_channel, p_original_transaction_id), v_plan.price_usd_cents,
                'store-subscription-v1', 'pending', p_channel, p_original_transaction_id)
        RETURNING * INTO v_sub;
    END IF;

    -- An older event than the last one applied, a flagged row, or an event that cannot move an
    -- ended or pending row is recorded and changes nothing. Only a newer activation reopens an ended row
    -- (the store keeps one original transaction id across a re-subscription).
    IF (v_sub.last_event_at IS NOT NULL AND p_occurred_at < v_sub.last_event_at)
       OR v_sub.status = 'flagged'
       OR (v_sub.status IN ('ended', 'pending') AND p_action <> 'activate') THEN
        INSERT INTO public.social_publish_subscription_events (subscription_id, stripe_event_id, type, status, period_end, occurred_at)
        VALUES (v_sub.id, v_event_key, p_type, v_sub.status, p_period_end, p_occurred_at);
        RETURN jsonb_build_object('ok', true, 'idempotent', false, 'stale', true,
                                  'subscription_id', v_sub.id, 'user_id', v_sub.user_id, 'status', v_sub.status,
                                  'flagged', v_sub.status = 'flagged');
    END IF;

    PERFORM public.end_lapsed_social_publish_comps(v_sub.user_id);
    v_new := CASE p_action
        WHEN 'activate' THEN 'active'
        WHEN 'past_due' THEN 'past_due'
        WHEN 'expire' THEN 'ended'
        WHEN 'refund' THEN 'ended'
        ELSE v_sub.status
    END;
    IF v_new IN ('active', 'past_due') AND v_sub.status NOT IN ('active', 'past_due') AND EXISTS (
        SELECT 1 FROM public.social_publish_subscriptions other
        WHERE other.user_id = v_sub.user_id AND other.id <> v_sub.id AND other.status IN ('active', 'past_due')) THEN
        v_new := 'flagged';
        v_flagged := true;
    END IF;

    UPDATE public.social_publish_subscriptions SET
        status = v_new,
        plan_id = CASE WHEN p_action = 'activate' THEN v_plan.id ELSE plan_id END,
        price_usd_cents = CASE WHEN p_action = 'activate' THEN v_plan.price_usd_cents ELSE price_usd_cents END,
        current_period_end = CASE WHEN p_action = 'activate' THEN p_period_end ELSE COALESCE(p_period_end, current_period_end) END,
        cancel_at_period_end = CASE WHEN p_action = 'activate' THEN false
                                    WHEN p_action = 'cancel_at_period_end' THEN true
                                    ELSE cancel_at_period_end END,
        started_at = CASE WHEN v_new IN ('active', 'past_due') THEN COALESCE(started_at, p_occurred_at) ELSE started_at END,
        ended_at = CASE WHEN v_new = 'ended' THEN COALESCE(ended_at, p_occurred_at)
                        WHEN v_new IN ('active', 'past_due') THEN NULL
                        ELSE ended_at END,
        end_reason = CASE WHEN v_new = 'ended' THEN CASE WHEN p_action = 'refund' THEN 'refunded' ELSE 'subscription_ended' END
                          WHEN v_new = 'flagged' THEN 'superseded'
                          WHEN v_new IN ('active', 'past_due') THEN NULL
                          ELSE end_reason END,
        last_event_at = p_occurred_at,
        updated_at = now()
    WHERE id = v_sub.id;

    INSERT INTO public.social_publish_subscription_events (subscription_id, stripe_event_id, type, status, period_end, occurred_at)
    VALUES (v_sub.id, v_event_key, p_type, v_new, p_period_end, p_occurred_at);

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'stale', false, 'flagged', v_flagged,
                              'subscription_id', v_sub.id, 'user_id', v_sub.user_id, 'status', v_new);
END $$;

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
    PERFORM public.end_lapsed_social_publish_comps(v_user);

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

REVOKE ALL ON FUNCTION public.start_social_publish_subscription(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_social_publish_subscription(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.apply_social_publish_subscription_event(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_social_publish_subscription_event(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.apply_store_publish_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_store_publish_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.grant_social_publish_comp(TEXT, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_social_publish_comp(TEXT, TEXT, TEXT, INTEGER, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
