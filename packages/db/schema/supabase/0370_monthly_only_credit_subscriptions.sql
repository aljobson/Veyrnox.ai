-- The owner approved a monthly-only Credit Subscription launch on 24 October
-- 2026. Keep the earlier weekly rows for historical settlement and audit, but
-- never offer them for a new checkout.
BEGIN;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.credit_subscription_plans
       SET active = false,
           updated_at = now()
     WHERE id IN ('starter-weekly', 'plus-weekly', 'ultra-weekly');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 3 THEN
        RAISE EXCEPTION 'Expected three weekly Credit Subscription plan rows, updated %', affected;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.credit_subscription_plans
        WHERE billing_interval = 'week'
          AND active
    ) THEN
        RAISE EXCEPTION 'Monthly-only launch cannot retain active weekly Credit Subscription plans';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
