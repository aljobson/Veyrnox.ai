-- 0244_cinema_pass_monthly_only_999_ceiling_1500.sql
-- ADR-0057, amendment proposed 2026-10-10: the monthly Cinema Pass is $9.99,
-- the weekly and yearly plans are withdrawn, and the Pass viewing ceiling is
-- 1,500 delivered minutes per calendar month.
--
-- Data only: one plan price, two plans taken off sale and one ceiling value.
-- No function, grant or ledger change. A withdrawn plan keeps its row, because
-- cinema_passes references it; list_cinema_pass_plans stops offering it and
-- start_cinema_pass answers PLAN_NOT_FOUND for a new start. A Pass already
-- sold keeps its plan and the price on its own row
-- (cinema_passes.price_usd_cents) and at Stripe. The ceiling applies to every
-- live Pass from the next heartbeat.
--
-- Absolute values and no filter on the old value, so a replay matches the same
-- rows each time. Each UPDATE must change exactly the rows named or the block
-- rolls back.

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.cinema_pass_plans
       SET price_usd_cents = 999, updated_at = now()
     WHERE id = 'pass-monthly';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one pass-monthly plan row, updated %', affected;
    END IF;

    UPDATE public.cinema_pass_plans
       SET active = false, updated_at = now()
     WHERE id IN ('pass-weekly', 'pass-yearly');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 2 THEN
        RAISE EXCEPTION 'Expected the pass-weekly and pass-yearly plan rows, updated %', affected;
    END IF;

    UPDATE public.cinema_prices
       SET value = 1500, updated_at = now()
     WHERE key = 'pass_ceiling_minutes';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one pass_ceiling_minutes row, updated %', affected;
    END IF;
END $$;
