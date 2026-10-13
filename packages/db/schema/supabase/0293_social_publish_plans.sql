-- 0293: Veyrnox Publish Plan. Basic scheduling and five connected accounts
-- remain free. A live $15 monthly Plan unlocks advanced analytics and
-- best-time recommendations. This entitlement never touches the credit ledger.
BEGIN;

CREATE TABLE IF NOT EXISTS public.social_publish_plans (
    id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,32}$'),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    billing_interval TEXT NOT NULL CHECK (billing_interval = 'month'),
    price_usd_cents INTEGER NOT NULL CHECK (price_usd_cents BETWEEN 100 AND 9999999),
    analytics_days INTEGER NOT NULL CHECK (analytics_days BETWEEN 30 AND 3660),
    best_time_enabled BOOLEAN NOT NULL DEFAULT false,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.social_publish_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publish_plans FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_publish_plans FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.social_publish_plans
    (id, name, billing_interval, price_usd_cents, analytics_days, best_time_enabled)
VALUES ('publish', 'Publish Plan', 'month', 1500, 366, true)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    billing_interval = EXCLUDED.billing_interval,
    price_usd_cents = EXCLUDED.price_usd_cents,
    analytics_days = EXCLUDED.analytics_days,
    best_time_enabled = EXCLUDED.best_time_enabled,
    updated_at = now();

CREATE TABLE IF NOT EXISTS public.social_publish_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    plan_id TEXT NOT NULL REFERENCES public.social_publish_plans(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,128}$'),
    price_usd_cents INTEGER NOT NULL CHECK (price_usd_cents > 0),
    consent_version TEXT NOT NULL CHECK (consent_version ~ '^[A-Za-z0-9._-]{1,48}$'),
    consent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'past_due', 'ended', 'flagged')),
    stripe_session_id TEXT NULL CHECK (stripe_session_id IS NULL OR stripe_session_id ~ '^cs_[A-Za-z0-9_]{1,251}$'),
    stripe_subscription_id TEXT NULL UNIQUE CHECK (stripe_subscription_id IS NULL OR stripe_subscription_id ~ '^sub_[A-Za-z0-9_]{1,250}$'),
    stripe_customer_id TEXT NULL CHECK (stripe_customer_id IS NULL OR stripe_customer_id ~ '^cus_[A-Za-z0-9_]{1,250}$'),
    current_period_end TIMESTAMPTZ NULL,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
    last_event_at TIMESTAMPTZ NULL,
    started_at TIMESTAMPTZ NULL,
    ended_at TIMESTAMPTZ NULL,
    end_reason TEXT NULL CHECK (end_reason IS NULL OR end_reason IN
        ('subscription_ended', 'refunded', 'disputed', 'cancelled', 'superseded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT social_publish_subscriptions_one_key UNIQUE (user_id, idempotency_key),
    CONSTRAINT social_publish_subscriptions_ended_pair CHECK ((status = 'ended') = (ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS social_publish_subscriptions_one_live
    ON public.social_publish_subscriptions (user_id) WHERE status IN ('active', 'past_due');
CREATE INDEX IF NOT EXISTS social_publish_subscriptions_user_created
    ON public.social_publish_subscriptions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS social_publish_subscriptions_plan
    ON public.social_publish_subscriptions (plan_id);
ALTER TABLE public.social_publish_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publish_subscriptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_publish_subscriptions FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.social_publish_subscription_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES public.social_publish_subscriptions(id) ON DELETE RESTRICT,
    stripe_event_id TEXT NOT NULL UNIQUE CHECK (stripe_event_id ~ '^(evt|cs)_[A-Za-z0-9_]{1,250}$'),
    type TEXT NOT NULL CHECK (type ~ '^[a-z_.]{1,64}$'),
    status TEXT NULL CHECK (status IS NULL OR status ~ '^[a-z_]{1,32}$'),
    period_end TIMESTAMPTZ NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_publish_subscription_events_subscription
    ON public.social_publish_subscription_events (subscription_id);
ALTER TABLE public.social_publish_subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publish_subscription_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_publish_subscription_events FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.social_publish_subscription_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'social_publish_subscription_events is append-only (attempted %)', TG_OP;
END $$;
DROP TRIGGER IF EXISTS social_publish_subscription_events_append_only ON public.social_publish_subscription_events;
CREATE TRIGGER social_publish_subscription_events_append_only
    BEFORE UPDATE OR DELETE ON public.social_publish_subscription_events
    FOR EACH ROW EXECUTE FUNCTION public.social_publish_subscription_events_append_only();
-- Row triggers never fire for TRUNCATE (0177).
DROP TRIGGER IF EXISTS social_publish_subscription_events_no_truncate ON public.social_publish_subscription_events;
CREATE TRIGGER social_publish_subscription_events_no_truncate
    BEFORE TRUNCATE ON public.social_publish_subscription_events
    FOR EACH STATEMENT EXECUTE FUNCTION public.social_publish_subscription_events_append_only();

CREATE OR REPLACE FUNCTION public.list_social_publish_plans()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'billing_interval', p.billing_interval,
        'price_usd_cents', p.price_usd_cents, 'analytics_days', p.analytics_days,
        'best_time_enabled', p.best_time_enabled) ORDER BY p.price_usd_cents), '[]'::jsonb)
    FROM public.social_publish_plans p WHERE p.active;
$$;

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

CREATE OR REPLACE FUNCTION public.record_social_publish_session(p_auth_id TEXT, p_subscription_id UUID, p_session_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_sub public.social_publish_subscriptions%ROWTYPE;
BEGIN
    IF p_session_id IS NULL OR p_session_id !~ '^cs_[A-Za-z0-9_]{1,251}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION_ID');
    END IF;
    SELECT s.* INTO v_sub FROM public.social_publish_subscriptions s
      JOIN public.users u ON u.id = s.user_id
      WHERE s.id = p_subscription_id AND u.auth_id = p_auth_id FOR UPDATE OF s;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND'); END IF;
    IF v_sub.stripe_session_id IS NOT NULL AND v_sub.stripe_session_id <> p_session_id AND v_sub.status <> 'pending' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SESSION_MISMATCH');
    END IF;
    UPDATE public.social_publish_subscriptions SET stripe_session_id = p_session_id, updated_at = now() WHERE id = v_sub.id;
    RETURN jsonb_build_object('ok', true, 'subscription_id', v_sub.id, 'status', v_sub.status);
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
      'account_limit', 5, 'analytics_days', CASE WHEN v_paid THEN v_plan.analytics_days ELSE 30 END,
      'best_time_enabled', v_paid AND v_plan.best_time_enabled,
      'subscription', CASE WHEN v_sub.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v_sub.id, 'plan_id', v_sub.plan_id, 'status', v_sub.status,
        'price_usd_cents', v_sub.price_usd_cents, 'current_period_end', v_sub.current_period_end,
        'cancel_at_period_end', v_sub.cancel_at_period_end, 'started_at', v_sub.started_at,
        'stripe_subscription_id', v_sub.stripe_subscription_id, 'stripe_customer_id', v_sub.stripe_customer_id) END);
END $$;

CREATE OR REPLACE FUNCTION public.mark_social_publish_cancelled(p_auth_id TEXT, p_subscription_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_sub public.social_publish_subscriptions%ROWTYPE;
BEGIN
    SELECT s.* INTO v_sub FROM public.social_publish_subscriptions s JOIN public.users u ON u.id = s.user_id
      WHERE s.id = p_subscription_id AND u.auth_id = p_auth_id FOR UPDATE OF s;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND'); END IF;
    IF v_sub.status NOT IN ('active', 'past_due') THEN RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_LIVE'); END IF;
    UPDATE public.social_publish_subscriptions SET cancel_at_period_end = true, updated_at = now() WHERE id = v_sub.id;
    RETURN jsonb_build_object('ok', true, 'current_period_end', v_sub.current_period_end);
END $$;

CREATE OR REPLACE FUNCTION public.end_social_publish_subscription(
    p_stripe_subscription_id TEXT, p_event_id TEXT, p_reason TEXT, p_reference TEXT, p_occurred_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_sub public.social_publish_subscriptions%ROWTYPE; v_frozen BOOLEAN := false;
BEGIN
    IF p_event_id IS NULL OR p_event_id !~ '^evt_[A-Za-z0-9_]{1,250}$'
       OR p_reason NOT IN ('refunded', 'disputed') OR p_occurred_at IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT'); END IF;
    IF p_stripe_subscription_id IS NULL OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9_]{1,250}$' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SUBSCRIPTION'); END IF;
    IF EXISTS (SELECT 1 FROM public.social_publish_subscription_events e WHERE e.stripe_event_id = p_event_id) THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true); END IF;
    SELECT * INTO v_sub FROM public.social_publish_subscriptions s
      WHERE s.stripe_subscription_id = p_stripe_subscription_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND'); END IF;
    IF v_sub.status <> 'ended' THEN
      UPDATE public.social_publish_subscriptions SET status = 'ended', ended_at = p_occurred_at,
        end_reason = p_reason, last_event_at = GREATEST(COALESCE(last_event_at, p_occurred_at), p_occurred_at), updated_at = now()
      WHERE id = v_sub.id;
    END IF;
    INSERT INTO public.social_publish_subscription_events
      (subscription_id, stripe_event_id, type, status, period_end, occurred_at)
    VALUES (v_sub.id, p_event_id, 'publish.' || p_reason, 'ended', NULL, p_occurred_at);
    IF p_reason = 'disputed' THEN
      PERFORM 1 FROM public.credit_balances b WHERE b.user_id = v_sub.user_id FOR UPDATE;
      PERFORM public.freeze_account(v_sub.user_id,
        left(format('Stripe dispute %s on Publish Plan subscription %s', COALESCE(NULLIF(btrim(p_reference), ''), 'without reference'), p_stripe_subscription_id), 500), NULL);
      v_frozen := true;
    END IF;
    RETURN jsonb_build_object('ok', true, 'subscription_id', v_sub.id, 'user_id', v_sub.user_id, 'frozen', v_frozen);
END $$;

DO $$ DECLARE fn TEXT; BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.list_social_publish_plans()',
    'public.start_social_publish_subscription(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER)',
    'public.record_social_publish_session(TEXT, UUID, TEXT)',
    'public.apply_social_publish_subscription_event(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ)',
    'public.read_social_publish_entitlement(TEXT)',
    'public.mark_social_publish_cancelled(TEXT, UUID)',
    'public.end_social_publish_subscription(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
  REVOKE ALL ON FUNCTION public.social_publish_subscription_events_append_only() FROM PUBLIC, anon, authenticated, service_role;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
