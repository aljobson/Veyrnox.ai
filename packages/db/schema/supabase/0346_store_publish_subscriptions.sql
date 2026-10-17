-- 0346: Publish Plan subscriptions bought in the iOS and Android apps (ADR-0109).
--
-- A store subscription is a social_publish_subscriptions row like a Stripe one, so the entitlement
-- read (read_social_publish_entitlement), the one-live-subscription index and the web "already active"
-- refusal all keep working. Never the credit ledger (ADR-0062).
--
--   social_publish_subscriptions   gains store_channel and store_original_transaction_id (both or
--                  neither, unique together): the store's own subscription identity, the way
--                  stripe_subscription_id is Stripe's.
--   social_publish_subscription_events   the event id check also accepts 'rc_' ids: a RevenueCat
--                  event id with every character outside [A-Za-z0-9_] turned into '_'.
--   social_publish_store_products   store product id -> plan id, per channel. Seeded for iOS (the
--                  RevenueCat Test Store maps to iOS); Android waits for the Play listings.
--   apply_store_publish_event   one RevenueCat subscription event for the account that owns the
--                  secret customer id (0344). Actions: activate (purchase, renewal, plan change,
--                  un-cancel), cancel_at_period_end, past_due, expire, refund. Idempotent on the
--                  event id, order-safe (an older event than the last one changes nothing), and a
--                  second live subscription for the same account is FLAGGED, never entitled (the
--                  Stripe rule), so a store purchase made while the web plan is active needs an
--                  operator refund rather than silently stacking.
--
-- Unchanged: Stripe handling, plans and prices, read_social_publish_entitlement.
-- Idempotent: columns IF NOT EXISTS, constraints dropped and re-added, functions OR REPLACE.

BEGIN;

ALTER TABLE public.social_publish_subscriptions ADD COLUMN IF NOT EXISTS store_channel TEXT NULL;
ALTER TABLE public.social_publish_subscriptions ADD COLUMN IF NOT EXISTS store_original_transaction_id TEXT NULL;

ALTER TABLE public.social_publish_subscriptions DROP CONSTRAINT IF EXISTS social_publish_subscriptions_store_identity;
ALTER TABLE public.social_publish_subscriptions ADD CONSTRAINT social_publish_subscriptions_store_identity CHECK (
    (store_channel IS NULL AND store_original_transaction_id IS NULL)
    OR (store_channel IN ('ios', 'android')
        AND store_original_transaction_id IS NOT NULL
        AND char_length(store_original_transaction_id) BETWEEN 1 AND 200)
);

CREATE UNIQUE INDEX IF NOT EXISTS social_publish_subscriptions_store_key
    ON public.social_publish_subscriptions (store_channel, store_original_transaction_id)
    WHERE store_channel IS NOT NULL;

-- The event table's id check is an inline column constraint; replace whatever name it has.
DO $$
DECLARE c TEXT;
BEGIN
    FOR c IN SELECT con.conname FROM pg_constraint con
             WHERE con.conrelid = 'public.social_publish_subscription_events'::regclass
               AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE '%stripe_event_id%'
    LOOP
        EXECUTE format('ALTER TABLE public.social_publish_subscription_events DROP CONSTRAINT %I', c);
    END LOOP;
END $$;
ALTER TABLE public.social_publish_subscription_events ADD CONSTRAINT social_publish_subscription_events_event_id_format
    CHECK (stripe_event_id ~ '^(evt|cs|rc)_[A-Za-z0-9_]{1,250}$');

CREATE TABLE IF NOT EXISTS public.social_publish_store_products (
    channel          TEXT NOT NULL CHECK (channel IN ('ios', 'android')),
    store_product_id TEXT NOT NULL CHECK (store_product_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
    plan_id          TEXT NOT NULL REFERENCES public.social_publish_plans(id) ON DELETE RESTRICT,
    PRIMARY KEY (channel, store_product_id)
);
CREATE INDEX IF NOT EXISTS social_publish_store_products_plan ON public.social_publish_store_products (plan_id);
ALTER TABLE public.social_publish_store_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publish_store_products FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.social_publish_store_products FROM PUBLIC, anon, authenticated;

INSERT INTO public.social_publish_store_products (channel, store_product_id, plan_id)
SELECT 'ios', m.product, m.plan
FROM (VALUES ('ai.veyrnox.publish.weekly', 'publish-weekly'),
             ('ai.veyrnox.publish.monthly', 'publish'),
             ('ai.veyrnox.publish.annual', 'publish-annual')) AS m(product, plan)
WHERE EXISTS (SELECT 1 FROM public.social_publish_plans p WHERE p.id = m.plan)
ON CONFLICT (channel, store_product_id) DO NOTHING;

-- Returns {ok:true, idempotent, stale, flagged, subscription_id, user_id, status} or {ok:false, code}
-- with code INVALID_EVENT, CUSTOMER_NOT_FOUND, SUBSCRIPTION_OWNED_BY_OTHER, SUBSCRIPTION_NOT_FOUND
-- (an event for a subscription we never saw activated) or PLAN_NOT_FOUND (unmapped product).
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

REVOKE ALL ON FUNCTION public.apply_store_publish_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_store_publish_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.apply_store_publish_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_store_publish_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

COMMIT;
