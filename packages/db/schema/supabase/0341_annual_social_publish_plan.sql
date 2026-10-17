-- Add a $126 annual Veyrnox Publish option: 30% off twelve $15 monthly payments.
BEGIN;

ALTER TABLE public.social_publish_plans
    DROP CONSTRAINT IF EXISTS social_publish_plans_billing_interval_check;
ALTER TABLE public.social_publish_plans
    ADD CONSTRAINT social_publish_plans_billing_interval_check
    CHECK (billing_interval IN ('week', 'month', 'year'));

INSERT INTO public.social_publish_plans
    (id, name, billing_interval, price_usd_cents, analytics_days, best_time_enabled, active)
VALUES ('publish-annual', 'Publish Plan', 'year', 12600, 366, true, true)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    billing_interval = EXCLUDED.billing_interval,
    price_usd_cents = EXCLUDED.price_usd_cents,
    analytics_days = EXCLUDED.analytics_days,
    best_time_enabled = EXCLUDED.best_time_enabled,
    active = EXCLUDED.active,
    updated_at = now();

NOTIFY pgrst, 'reload schema';
COMMIT;
