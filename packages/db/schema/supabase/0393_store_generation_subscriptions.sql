-- 0393: App Store / Play Store AI Generation subscriptions.
-- RevenueCat remains the store authority; this function binds its secret customer id to the
-- existing credit-subscription ledger and grants one plan cycle only for a paid initial purchase
-- or renewal. Product changes and uncancellations change state but never mint credits.

BEGIN;

ALTER TABLE public.credit_subscriptions ADD COLUMN IF NOT EXISTS store_channel TEXT NULL;
ALTER TABLE public.credit_subscriptions ADD COLUMN IF NOT EXISTS store_original_transaction_id TEXT NULL;
ALTER TABLE public.credit_subscriptions DROP CONSTRAINT IF EXISTS credit_subscriptions_store_identity;
ALTER TABLE public.credit_subscriptions ADD CONSTRAINT credit_subscriptions_store_identity CHECK (
    (store_channel IS NULL AND store_original_transaction_id IS NULL)
    OR (store_channel IN ('ios', 'android') AND store_original_transaction_id IS NOT NULL
        AND char_length(store_original_transaction_id) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX IF NOT EXISTS credit_subscriptions_store_key
    ON public.credit_subscriptions (store_channel, store_original_transaction_id)
    WHERE store_channel IS NOT NULL;

DO $$
DECLARE c TEXT;
BEGIN
    FOR c IN SELECT con.conname FROM pg_constraint con
             WHERE con.conrelid = 'public.credit_subscription_events'::regclass
               AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE '%stripe_event_id%'
    LOOP
        EXECUTE format('ALTER TABLE public.credit_subscription_events DROP CONSTRAINT %I', c);
    END LOOP;
END $$;
ALTER TABLE public.credit_subscription_events ADD CONSTRAINT credit_subscription_events_event_id_format
    CHECK (stripe_event_id ~ '^(evt|cs|rc)_[A-Za-z0-9_]{1,250}$');

CREATE TABLE IF NOT EXISTS public.credit_subscription_store_products (
    channel          TEXT NOT NULL CHECK (channel IN ('ios', 'android')),
    store_product_id TEXT NOT NULL CHECK (store_product_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
    plan_id          TEXT NOT NULL REFERENCES public.credit_subscription_plans(id) ON DELETE RESTRICT,
    PRIMARY KEY (channel, store_product_id)
);
CREATE INDEX IF NOT EXISTS credit_subscription_store_products_plan
    ON public.credit_subscription_store_products (plan_id);
ALTER TABLE public.credit_subscription_store_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_subscription_store_products FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.credit_subscription_store_products FROM PUBLIC, anon, authenticated;

INSERT INTO public.credit_subscription_store_products (channel, store_product_id, plan_id)
SELECT channel, 'ai.veyrnox.generation.' || family || '.' || store_interval, family || '-' || plan_interval
FROM (VALUES ('lite','monthly','monthly'), ('starter','monthly','monthly'), ('plus','monthly','monthly'), ('ultra','monthly','monthly'),
             ('lite','annual','yearly'), ('starter','annual','yearly'), ('plus','annual','yearly'), ('ultra','annual','yearly'))
     AS plans(family, store_interval, plan_interval)
CROSS JOIN (VALUES ('ios'), ('android')) AS stores(channel)
WHERE EXISTS (SELECT 1 FROM public.credit_subscription_plans p WHERE p.id = family || '-' || plan_interval)
ON CONFLICT (channel, store_product_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.apply_store_generation_event(
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
    v_sub public.credit_subscriptions%ROWTYPE;
    v_plan public.credit_subscription_plans%ROWTYPE;
    v_event public.credit_subscription_events%ROWTYPE;
    v_new TEXT;
    v_flagged BOOLEAN := false;
    v_grant JSONB;
    v_reverse JSONB;
    v_grant_key TEXT;
    v_grant_end TIMESTAMPTZ;
    v_yearly BOOLEAN := false;
    v_granted INTEGER := 0;
BEGIN
    IF p_channel IS NULL OR p_channel NOT IN ('ios', 'android')
       OR p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9._-]{8,128}$'
       OR p_action IS NULL OR p_action NOT IN ('activate', 'cancel_at_period_end', 'past_due', 'expire', 'refund')
       OR p_type IS NULL OR p_type !~ '^[a-z_.]{1,64}$'
       OR p_original_transaction_id IS NULL OR char_length(p_original_transaction_id) NOT BETWEEN 1 AND 200
       OR p_store_product_id IS NULL OR p_store_product_id !~ '^ai\.veyrnox\.generation\.[A-Za-z0-9._:-]{1,170}$'
       OR p_occurred_at IS NULL OR p_occurred_at > now() + interval '5 minutes'
       OR (p_action = 'activate' AND p_period_end IS NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT');
    END IF;
    IF p_rc_customer_id IS NULL OR p_rc_customer_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CUSTOMER_NOT_FOUND');
    END IF;
    SELECT sc.user_id INTO v_user_id FROM public.store_customers sc WHERE sc.rc_customer_id = p_rc_customer_id::uuid;
    IF v_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'CUSTOMER_NOT_FOUND'); END IF;

    v_event_key := 'rc_' || regexp_replace(p_event_id, '[^A-Za-z0-9_]', '_', 'g');
    PERFORM pg_advisory_xact_lock(hashtextextended('generation:' || p_channel || ':' || p_original_transaction_id, 0));
    SELECT * INTO v_event FROM public.credit_subscription_events e WHERE e.stripe_event_id = v_event_key;
    IF FOUND THEN
        SELECT s.* INTO v_sub FROM public.credit_subscriptions s WHERE s.id = v_event.subscription_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'subscription_id', v_sub.id,
            'status', v_sub.status, 'flagged', v_sub.status = 'flagged', 'granted', 0);
    END IF;

    SELECT * INTO v_sub FROM public.credit_subscriptions s
     WHERE s.store_channel = p_channel AND s.store_original_transaction_id = p_original_transaction_id FOR UPDATE;
    IF v_sub.id IS NOT NULL AND v_sub.user_id <> v_user_id THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_OWNED_BY_OTHER');
    END IF;
    IF p_action = 'activate' THEN
        SELECT p.* INTO v_plan FROM public.credit_subscription_store_products sp
        JOIN public.credit_subscription_plans p ON p.id = sp.plan_id
        WHERE sp.channel = p_channel AND sp.store_product_id = p_store_product_id AND p.active;
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'PLAN_NOT_FOUND'); END IF;
    END IF;
    IF v_sub.id IS NULL THEN
        IF p_action <> 'activate' THEN RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND'); END IF;
        INSERT INTO public.credit_subscriptions
            (user_id, plan_id, idempotency_key, price_usd_cents, credits, consent_version, status,
             store_channel, store_original_transaction_id)
        VALUES (v_user_id, v_plan.id, 'rcgen_' || md5(p_channel || ':' || p_original_transaction_id),
                v_plan.price_usd_cents, v_plan.credits, 'store-subscription-v1', 'pending', p_channel, p_original_transaction_id)
        RETURNING * INTO v_sub;
    END IF;

    PERFORM 1 FROM public.credit_balances b WHERE b.user_id = v_sub.user_id FOR UPDATE;
    IF (v_sub.last_event_at IS NOT NULL AND p_occurred_at < v_sub.last_event_at)
       OR v_sub.status = 'flagged'
       OR (v_sub.status IN ('ended', 'pending') AND p_action <> 'activate') THEN
        INSERT INTO public.credit_subscription_events (subscription_id, stripe_event_id, type, status, period_end, occurred_at)
        VALUES (v_sub.id, v_event_key, p_type, v_sub.status, p_period_end, p_occurred_at);
        RETURN jsonb_build_object('ok', true, 'idempotent', false, 'stale', true,
            'subscription_id', v_sub.id, 'status', v_sub.status, 'flagged', v_sub.status = 'flagged', 'granted', 0);
    END IF;

    v_new := CASE p_action WHEN 'activate' THEN 'active' WHEN 'past_due' THEN 'past_due'
        WHEN 'expire' THEN 'ended' WHEN 'refund' THEN 'ended' ELSE v_sub.status END;
    IF v_new IN ('active', 'past_due') AND v_sub.status NOT IN ('active', 'past_due') AND EXISTS (
        SELECT 1 FROM public.credit_subscriptions other WHERE other.user_id = v_sub.user_id
          AND other.id <> v_sub.id AND other.status IN ('active', 'past_due')) THEN
        v_new := 'flagged'; v_flagged := true;
    END IF;

    UPDATE public.credit_subscriptions SET
        status = v_new,
        plan_id = CASE WHEN p_action = 'activate' THEN v_plan.id ELSE plan_id END,
        price_usd_cents = CASE WHEN p_action = 'activate' THEN v_plan.price_usd_cents ELSE price_usd_cents END,
        credits = CASE WHEN p_action = 'activate' THEN v_plan.credits ELSE credits END,
        current_period_end = CASE WHEN p_action = 'activate' THEN p_period_end ELSE COALESCE(p_period_end, current_period_end) END,
        cancel_at_period_end = CASE WHEN p_action = 'activate' THEN false WHEN p_action = 'cancel_at_period_end' THEN true ELSE cancel_at_period_end END,
        started_at = CASE WHEN v_new IN ('active','past_due') THEN COALESCE(started_at, p_occurred_at) ELSE started_at END,
        ended_at = CASE WHEN v_new = 'ended' THEN COALESCE(ended_at, p_occurred_at) WHEN v_new IN ('active','past_due') THEN NULL ELSE ended_at END,
        end_reason = CASE WHEN v_new = 'ended' THEN 'subscription_ended' WHEN v_new = 'flagged' THEN 'superseded'
                          WHEN v_new IN ('active','past_due') THEN NULL ELSE end_reason END,
        last_event_at = p_occurred_at, updated_at = now()
    WHERE id = v_sub.id RETURNING * INTO v_sub;

    IF p_action = 'activate' AND p_type IN ('initial_purchase', 'renewal') AND v_new = 'active' THEN
        SELECT p.billing_interval = 'year' INTO v_yearly FROM public.credit_subscription_plans p WHERE p.id = v_sub.plan_id;
        v_grant_key := 'rcg_' || md5(p_event_id || ':' || p_original_transaction_id);
        v_grant_end := CASE WHEN v_yearly THEN LEAST(p_period_end, p_occurred_at + interval '1 month') ELSE p_period_end END;
        v_grant := public.subscription_grant(v_sub.user_id, v_sub.credits, v_grant_end, v_grant_key);
        IF (v_grant->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'store generation grant refused: %', v_grant->>'code'; END IF;
        v_granted := CASE WHEN (v_grant->>'idempotent')::boolean THEN 0 ELSE v_sub.credits END;
        IF v_yearly THEN
            UPDATE public.credit_subscriptions SET cycles_granted = 1, cycle_anchor = p_occurred_at,
                cycle_key_base = 'ysub_' || replace(id::text, '-', '') || '_' || substr(md5(v_grant_key), 1, 12), updated_at = now()
            WHERE id = v_sub.id;
        END IF;
    ELSIF p_action = 'refund' THEN
        SELECT e.detail INTO v_grant_key FROM public.credit_subscription_events e
         WHERE e.subscription_id = v_sub.id AND e.status = 'granted' AND e.detail IS NOT NULL
         ORDER BY e.occurred_at DESC LIMIT 1;
        IF v_grant_key IS NOT NULL THEN
            v_reverse := public.reverse_subscription_grant(v_sub.user_id, v_grant_key);
            IF (v_reverse->>'ok')::boolean IS NOT TRUE AND v_reverse->>'code' <> 'GRANT_NOT_FOUND' THEN
                RAISE EXCEPTION 'store generation reversal refused: %', v_reverse->>'code';
            END IF;
        END IF;
    END IF;

    INSERT INTO public.credit_subscription_events (subscription_id, stripe_event_id, type, status, detail, period_end, occurred_at)
    VALUES (v_sub.id, v_event_key, p_type, CASE WHEN v_granted > 0 THEN 'granted' ELSE v_new END,
            CASE WHEN v_granted > 0 THEN v_grant_key ELSE NULL END, p_period_end, p_occurred_at);
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'stale', false, 'flagged', v_flagged,
        'subscription_id', v_sub.id, 'user_id', v_sub.user_id, 'status', v_new, 'granted', v_granted);
END $$;

REVOKE ALL ON FUNCTION public.apply_store_generation_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_store_generation_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
