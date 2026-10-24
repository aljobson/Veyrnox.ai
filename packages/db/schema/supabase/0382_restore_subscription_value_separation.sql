-- 0382 (renumbered from 0378, which sat below production's latest and blocked apply-migrations) — Restore the value separation accepted in ADR-0064.
--
-- 0365 made one-off packs cheaper than Starter and Plus subscriptions and
-- equal to Ultra. That reversed the product contract: recurring, expiring
-- Subscription Credits must cost less per credit than flexible Pack Credits.
-- Restore the original flexible tiers, which keep every active subscription
-- below the best Pack rate while preserving all historical pack rows.

BEGIN;

DO $$
DECLARE affected INTEGER;
BEGIN
    UPDATE public.credit_packs
       SET active = false, updated_at = now()
     WHERE sales_channel = 'web' AND (
        (id = 'web-160' AND credits = 160 AND price_usd_cents = 1000) OR
        (id = 'web-330' AND credits = 330 AND price_usd_cents = 1900) OR
        (id = 'web-1300' AND credits = 1300 AND price_usd_cents = 5900) OR
        (id = 'web-270' AND credits = 270 AND price_usd_cents = 1900) OR
        (id = 'web-1200' AND credits = 1200 AND price_usd_cents = 5900) OR
        (id = 'web-3000' AND credits = 3000 AND price_usd_cents = 12900)
     );
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 6 THEN
        RAISE EXCEPTION 'Expected six superseded web pack rows, updated %', affected;
    END IF;

    UPDATE public.credit_packs
       SET active = true, updated_at = now()
     WHERE sales_channel = 'web' AND (
        (id = 'web-100' AND credits = 100 AND price_usd_cents = 1000) OR
        (id = 'web-300' AND credits = 300 AND price_usd_cents = 2500) OR
        (id = 'web-1000' AND credits = 1000 AND price_usd_cents = 7500)
     );
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 3 THEN
        RAISE EXCEPTION 'Expected three flexible web pack rows, updated %', affected;
    END IF;

    IF (SELECT string_agg(id || ':' || credits || ':' || price_usd_cents, ',' ORDER BY credits)
          FROM public.credit_packs
         WHERE sales_channel = 'web' AND active)
       IS DISTINCT FROM 'web-100:100:1000,web-300:300:2500,web-1000:1000:7500' THEN
        RAISE EXCEPTION 'Active web Credit Pack catalog is not the approved flexible set';
    END IF;

    -- Best active Pack rate is 7.5 cents per Credit. Every active monthly
    -- subscription must be strictly cheaper than that rate.
    IF EXISTS (
        SELECT 1
          FROM public.credit_subscription_plans
         WHERE active
           AND price_usd_cents::bigint * 2 >= credits::bigint * 15
    ) THEN
        RAISE EXCEPTION 'An active subscription does not beat the best Credit Pack rate';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
