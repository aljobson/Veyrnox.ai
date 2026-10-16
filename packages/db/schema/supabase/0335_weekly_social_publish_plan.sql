-- Add a weekly Veyrnox Publish option without changing existing $15 monthly contracts.
BEGIN;

ALTER TABLE public.social_publish_plans
    DROP CONSTRAINT IF EXISTS social_publish_plans_billing_interval_check;
ALTER TABLE public.social_publish_plans
    ADD CONSTRAINT social_publish_plans_billing_interval_check
    CHECK (billing_interval IN ('week', 'month'));

INSERT INTO public.social_publish_plans
    (id, name, billing_interval, price_usd_cents, analytics_days, best_time_enabled, active)
VALUES ('publish-weekly', 'Publish Plan', 'week', 499, 366, true, true)
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
