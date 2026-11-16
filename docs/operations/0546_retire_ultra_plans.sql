-- ADR-0346. Apply only AFTER store sale closure, 0545, and the purchase-time-aware deployment.
-- Keep plan rows and store mappings for historical subscriptions, settlement and audit.
-- Mapping deactivation means refusing new purchases through the plan's active flag.
BEGIN;
DO $$
DECLARE affected INTEGER;
BEGIN
    UPDATE public.credit_subscription_plans
       SET active = false, retired_at = COALESCE(retired_at, now()), updated_at = now()
     WHERE id IN ('ultra-monthly', 'ultra-yearly');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 2 THEN RAISE EXCEPTION '0546: expected 2 Ultra plans, got %', affected; END IF;

    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans WHERE active AND id LIKE 'ultra-%') THEN
        RAISE EXCEPTION '0546: Ultra remains active';
    END IF;
    IF (SELECT count(*) FROM public.credit_subscription_plans WHERE active) <> 6
       OR (SELECT count(*) FROM public.credit_subscription_plans p
           JOIN (VALUES
               ('lite-monthly', 'month', 1000, 157), ('lite-yearly', 'year', 9699, 157),
               ('starter-monthly', 'month', 1900, 297), ('starter-yearly', 'year', 18299, 297),
               ('plus-monthly', 'month', 5900, 924), ('plus-yearly', 'year', 56900, 924)
           ) AS expected(id, billing_interval, price, credits)
           ON p.id = expected.id AND p.billing_interval = expected.billing_interval
              AND p.price_usd_cents = expected.price AND p.credits = expected.credits
           WHERE p.active) <> 6 THEN
        RAISE EXCEPTION '0546: active catalog differs from the six ADR-0343 Lite/Starter/Plus plans';
    END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
