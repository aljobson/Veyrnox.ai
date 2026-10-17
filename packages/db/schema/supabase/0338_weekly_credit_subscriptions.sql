-- Add weekly Credit subscriptions without changing existing monthly contracts.
-- Each plan remains a server-owned price/allotment snapshot at checkout.
BEGIN;

ALTER TABLE public.credit_subscription_plans
    DROP CONSTRAINT IF EXISTS credit_subscription_plans_billing_interval_check;
ALTER TABLE public.credit_subscription_plans
    ADD CONSTRAINT credit_subscription_plans_billing_interval_check
    CHECK (billing_interval IN ('week', 'month'));

INSERT INTO public.credit_subscription_plans
    (id, billing_interval, price_usd_cents, credits, active)
VALUES
    ('starter-weekly', 'week', 499, 60, true),
    ('plus-weekly', 'week', 1499, 275, true),
    ('ultra-weekly', 'week', 3299, 700, true)
ON CONFLICT (id) DO UPDATE SET
    billing_interval = EXCLUDED.billing_interval,
    price_usd_cents = EXCLUDED.price_usd_cents,
    credits = EXCLUDED.credits,
    active = EXCLUDED.active,
    updated_at = now();

-- Invoice validation needs the interval from the durable server-owned plan,
-- not from Stripe metadata or a browser request.
CREATE OR REPLACE FUNCTION public.read_credit_subscription_binding(p_stripe_subscription_id TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT jsonb_build_object(
        'id', s.id, 'plan_id', s.plan_id, 'billing_interval', p.billing_interval,
        'price_usd_cents', s.price_usd_cents, 'credits', s.credits,
        'status', s.status, 'stripe_subscription_id', s.stripe_subscription_id,
        'stripe_customer_id', s.stripe_customer_id)
    FROM public.credit_subscriptions s
    JOIN public.credit_subscription_plans p ON p.id = s.plan_id
    WHERE s.stripe_subscription_id = p_stripe_subscription_id;
$$;
REVOKE ALL ON FUNCTION public.read_credit_subscription_binding(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_credit_subscription_binding(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
