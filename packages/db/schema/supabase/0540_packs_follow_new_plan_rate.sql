-- 0540 — One-off Credit Packs follow the new monthly plan rate (ADR-0343, amends ADR-0312).
--
-- Owner, 2026-11-15: packs follow the plans. 0539 moved the plans to 185 / 354 / 1,102 / 2,411 credits,
-- so the best monthly rate is Ultra's, 2411 credits for $129 (0.186899 credits a cent). A web pack gives
-- that many credits per dollar, rounded DOWN so a pack is never cheaper per credit than a plan
-- (ADR-0312). Owner, 2026-11-15: iOS and Android sell at the same price as web. The App Store
-- has no $10.00 / $25.00 / $75.00 consumable points (it has 9.99, 24.99, 74.99), so the web moves to
-- those prices too (one cent lower) and the store packs of 0541 match them exactly:
--
--   now                    after
--   web-209   $10 /  209   web-186   $9.99 /  186   (5.37 cents a credit; Ultra is 5.35)
--   web-523   $25 /  523   web-467   $24.99 / 467   (5.35)
--   web-1571  $75 / 1571   web-1401  $74.99 / 1401   (5.35)
--
-- Apply AFTER 0539: until then a pack of 209 is cheaper than every plan, which the guard below refuses.
--
-- 50% margin (owner's floor): after an 8% + $0.30 fee with every credit at the worst-case provider cost
-- $0.01796: price*420 - 30000 >= credits*1796. web-186: 389580 >= 334056 (55.6%); web-467: 1019580 >=
-- 838732 (57.3%); web-1401: 3119580 >= 2516196 (58.1%). The rows also clear credit_packs_sticker_floor
-- (0121, $0.043 a credit) and the legacy net floor (0041).
--
-- Same rule as 0121, 0365 and 0420: new ids carry the new credit counts; the retired packs are
-- deactivated, never deleted or rewritten; a pending top-up keeps the price and credits it opened with.
-- Store packs are 0541. Rollback: a forward migration that reactivates web-209, web-523 and web-1571.
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING and absolute assignments.

BEGIN;

DO $$
DECLARE affected INTEGER;
BEGIN
    -- 0539 must be in: the new pack sizes are only right against the new plan credits.
    IF (SELECT string_agg(id || ':' || credits, ',' ORDER BY id) FROM public.credit_subscription_plans
         WHERE id IN ('lite-monthly', 'starter-monthly', 'plus-monthly', 'ultra-monthly'))
       IS DISTINCT FROM 'lite-monthly:185,plus-monthly:1102,starter-monthly:354,ultra-monthly:2411' THEN
        RAISE EXCEPTION 'Apply 0539 (new plan credits) before the pack migration';
    END IF;

    INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, active)
    VALUES ('web-186', 'web', 186, 999, true),
           ('web-467', 'web', 467, 2499, true),
           ('web-1401', 'web', 1401, 7499, true)
    ON CONFLICT (id) DO NOTHING;
    IF (SELECT count(*) FROM public.credit_packs WHERE sales_channel = 'web'
        AND ((id = 'web-186' AND credits = 186 AND price_usd_cents = 999)
          OR (id = 'web-467' AND credits = 467 AND price_usd_cents = 2499)
          OR (id = 'web-1401' AND credits = 1401 AND price_usd_cents = 7499))) <> 3 THEN
        RAISE EXCEPTION 'New credit pack rows missing or changed';
    END IF;

    UPDATE public.credit_packs SET active = true, updated_at = now()
    WHERE sales_channel = 'web' AND id IN ('web-186', 'web-467', 'web-1401');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 3 THEN
        RAISE EXCEPTION 'Expected three new credit packs, updated %', affected;
    END IF;

    UPDATE public.credit_packs SET active = false, updated_at = now()
    WHERE sales_channel = 'web' AND (
        (id = 'web-209' AND credits = 209 AND price_usd_cents = 1000) OR
        (id = 'web-523' AND credits = 523 AND price_usd_cents = 2500) OR
        (id = 'web-1571' AND credits = 1571 AND price_usd_cents = 7500));
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 3 THEN
        RAISE EXCEPTION 'Expected three superseded web pack rows, updated %', affected;
    END IF;

    -- Per-pack margin guard: every active web pack keeps the 50% worst-case contribution.
    IF EXISTS (SELECT 1 FROM public.credit_packs WHERE sales_channel = 'web' AND active
               AND price_usd_cents::bigint * 420 - 30000 < credits::bigint * 1796) THEN
        RAISE EXCEPTION 'An active credit pack falls below the 50 percent contribution scenario';
    END IF;

    -- Parity guard: each active web pack sits at the rate of some active monthly plan, within 1%
    -- and never cheaper per credit than it (cross-multiplied: no division, no rounding).
    IF EXISTS (
        SELECT 1 FROM public.credit_packs p
         WHERE p.sales_channel = 'web' AND p.active
           AND NOT EXISTS (
               SELECT 1 FROM public.credit_subscription_plans s
                WHERE s.active AND s.billing_interval = 'month'
                  AND p.price_usd_cents::bigint * s.credits >= p.credits::bigint * s.price_usd_cents
                  AND p.price_usd_cents::bigint * s.credits * 100 <= p.credits::bigint * s.price_usd_cents * 101)
    ) THEN
        RAISE EXCEPTION 'An active web credit pack is not at the monthly subscription rate';
    END IF;

    -- Exactly these three web packs are sellable.
    IF (SELECT string_agg(id || ':' || credits || ':' || price_usd_cents, ',' ORDER BY credits)
        FROM public.credit_packs WHERE sales_channel = 'web' AND active)
       IS DISTINCT FROM 'web-186:186:999,web-467:467:2499,web-1401:1401:7499' THEN
        RAISE EXCEPTION 'Active web credit packs are not the expected three';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
