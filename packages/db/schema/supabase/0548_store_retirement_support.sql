-- ADR-0346. Support only: no plan is deactivated and retired_at remains NULL until 0549.
-- Apply before deploying the webhook that forwards purchased_at_ms; old callers omit the defaulted arg.
BEGIN;
ALTER TABLE public.credit_subscription_plans ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;
DROP FUNCTION IF EXISTS public.apply_store_generation_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.apply_store_generation_event(
    p_rc_customer_id TEXT,
    p_channel TEXT,
    p_store_product_id TEXT,
    p_original_transaction_id TEXT,
    p_event_id TEXT,
    p_action TEXT,
    p_type TEXT,
    p_period_end TIMESTAMPTZ,
    p_occurred_at TIMESTAMPTZ,
    p_purchased_at TIMESTAMPTZ DEFAULT NULL
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
    v_starter JSONB;
    v_starter_n INTEGER := 0;
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
        WHERE sp.channel = p_channel AND sp.store_product_id = p_store_product_id;
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'PLAN_NOT_FOUND'); END IF;
        -- Resolve the event's target, not just the stored plan: inactive targets cannot be bought.
        -- PRODUCT_CHANGE can describe a scheduled change. Only its effective purchase/renewal
        -- is evidence for the cutoff exception (ADR-0346). Only a still-live (active/past_due) subscription
        -- on its own retired plan continues without it: a lapsed one that resubscribes is a new purchase. occurred_at is ordering, not purchase time.
        IF NOT v_plan.active
           AND NOT (v_sub.id IS NOT NULL AND v_plan.id = v_sub.plan_id AND v_sub.status IN ('active', 'past_due'))
           AND NOT (v_plan.retired_at IS NOT NULL AND p_purchased_at IS NOT NULL
                    AND p_purchased_at < v_plan.retired_at
                    AND p_type IN ('initial_purchase', 'initial_purchase_trial', 'renewal')) THEN
            RETURN jsonb_build_object('ok', false, 'code', 'PLAN_NOT_FOUND');
        END IF;
        -- A retired same-product renewal/uncancel keeps its own historical price and credits.
        -- Active plans retain the original behavior; a real product change takes the new snapshot.
        IF NOT v_plan.active AND v_sub.id IS NOT NULL AND v_plan.id = v_sub.plan_id THEN
            v_plan.price_usd_cents := v_sub.price_usd_cents;
            v_plan.credits := v_sub.credits;
        END IF;
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

    IF p_action = 'activate' AND p_type = 'initial_purchase_trial' AND v_new = 'active' THEN
        -- 0422 amendment: a store free trial entitles the account but mints no plan credits (nothing was paid);
        -- it carries the one-time starter credits. The paid RENEWAL that ends the trial grants the plan.
        v_starter := public.grant_starter_credits(v_sub.user_id);
        v_starter_n := COALESCE((v_starter->>'granted')::INTEGER, 0);
    ELSIF p_action = 'activate' AND p_type IN ('initial_purchase', 'renewal') AND v_new = 'active' THEN
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
        'subscription_id', v_sub.id, 'user_id', v_sub.user_id, 'status', v_new, 'granted', v_granted,
        'starter_granted', v_starter_n);
END $$;

REVOKE ALL ON FUNCTION public.apply_store_generation_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_store_generation_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;


-- Owned subscriptions retain an interval even when absent from the public catalog.
CREATE OR REPLACE FUNCTION public.read_own_credit_subscription(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user UUID;
    v_sub  public.credit_subscriptions%ROWTYPE;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id = p_auth_id::UUID WHERE u.auth_id = p_auth_id;
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT * INTO v_sub FROM public.credit_subscriptions x WHERE x.user_id = v_user
    ORDER BY (x.status IN ('active', 'past_due')) DESC, x.created_at DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', true, 'subscription', NULL);
    END IF;
    RETURN jsonb_build_object('ok', true, 'subscription', jsonb_build_object(
        'id', v_sub.id, 'plan_id', v_sub.plan_id, 'status', v_sub.status,
        'billing_interval', (SELECT p.billing_interval FROM public.credit_subscription_plans p WHERE p.id = v_sub.plan_id),
        'price_usd_cents', v_sub.price_usd_cents, 'credits', v_sub.credits,
        'current_period_end', v_sub.current_period_end, 'cancel_at_period_end', v_sub.cancel_at_period_end,
        'started_at', v_sub.started_at, 'ended_at', v_sub.ended_at, 'end_reason', v_sub.end_reason,
        'created_at', v_sub.created_at,
        'stripe_subscription_id', v_sub.stripe_subscription_id, 'stripe_customer_id', v_sub.stripe_customer_id));
END $$;
REVOKE ALL ON FUNCTION public.read_own_credit_subscription(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_own_credit_subscription(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
