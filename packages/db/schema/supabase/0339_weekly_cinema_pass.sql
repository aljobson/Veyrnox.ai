-- Restore a weekly Cinema Pass alongside the existing $9.99 monthly Pass.
BEGIN;

ALTER TABLE public.cinema_pass_plans
    DROP CONSTRAINT IF EXISTS cinema_pass_plans_price_usd_cents_check;
ALTER TABLE public.cinema_pass_plans
    ADD CONSTRAINT cinema_pass_plans_price_usd_cents_check
    CHECK (price_usd_cents BETWEEN 100 AND 9999999);

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.cinema_pass_plans
       SET billing_interval = 'week',
           price_usd_cents = 299,
           intro_price_usd_cents = NULL,
           active = true,
           updated_at = now()
     WHERE id = 'pass-weekly';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one pass-weekly plan row, updated %', affected;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
