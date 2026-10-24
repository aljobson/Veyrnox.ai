-- 0385 — Activate the four yearly Credit Subscription plans (owner, 2026-10-24: "activate yearly").
--
-- Plans (0383): lite-yearly $108, starter-yearly $205.20, plus-yearly $601.80, ultra-yearly $1,238.40,
-- each granting the credits of one month (209, 398, 1,171, 2,411) month by month. The checkout (0384 and
-- the app change before it) is deployed. Nothing becomes buyable until SUBSCRIPTIONS_ENABLED is "true":
-- the plans list and the checkout both answer 503 while it is off, and it is off.
--
-- Each UPDATE names the plan's exact identity (id, interval, price, credits) and asserts one row, so
-- drift in any figure stops the migration. A replay is a no-op. Rollback: a forward migration setting
-- active = false (running subscriptions keep their own price and credits snapshot, 0186).

BEGIN;

DO $$
DECLARE
    plan RECORD;
    affected BIGINT;
BEGIN
    FOR plan IN SELECT * FROM (VALUES
        ('lite-yearly', 10800, 209), ('starter-yearly', 20520, 398),
        ('plus-yearly', 60180, 1171), ('ultra-yearly', 123840, 2411)) AS v(id, price, credits)
    LOOP
        UPDATE public.credit_subscription_plans SET active = true, updated_at = now()
         WHERE id = plan.id AND billing_interval = 'year' AND price_usd_cents = plan.price AND credits = plan.credits;
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN RAISE EXCEPTION 'Expected the % plan at % cents and % credits, updated %', plan.id, plan.price, plan.credits, affected; END IF;
    END LOOP;

    IF (SELECT count(*) FROM public.credit_subscription_plans WHERE active AND billing_interval = 'year') <> 4 THEN
        RAISE EXCEPTION 'Expected exactly four active yearly plans';
    END IF;
    -- The sweep that grants months 2 to 12 must exist before anything yearly can be bought.
    IF to_regprocedure('public.grant_due_yearly_cycles(timestamp with time zone, integer)') IS NULL THEN
        RAISE EXCEPTION 'grant_due_yearly_cycles is missing';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
