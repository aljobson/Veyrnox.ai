-- 0540 — One-off Credit Packs follow the new monthly plan rate (ADR-0343, amends ADR-0312).
--
-- Owner, 2026-11-15: packs follow the plans. 0539 moved the plans to 157 / 297 / 924 / 2,011 credits,
-- so the best monthly rate is Lite's, 157 credits for $10 (0.157 credits a cent). A web pack gives
-- that many credits per dollar, rounded DOWN so a pack is never cheaper per credit than a plan
-- (ADR-0312). Owner, 2026-11-15: iOS and Android sell at the same price as web. The App Store
-- has no $10.00 / $25.00 / $75.00 consumable points (it has 9.99, 24.99, 74.99), so the web moves to
-- those prices too (one cent lower) and the store packs of 0541 match them exactly:
--
--   now                    after
--   web-209   $10 /  209   web-156   $9.99 /  156   (6.40 cents a credit; Lite is 6.37)
--   web-523   $25 /  523   web-392   $24.99 / 392   (6.38)
--   web-1571  $75 / 1571   web-1177  $74.99 / 1177   (6.37)
--
-- Apply AFTER 0539: until then a pack of 209 is cheaper than every plan, which the guard below refuses.
--
-- 50% margin (owner's floor): after an 8% + $0.30 fee with every credit at the worst-case provider cost
-- $0.01796: price*420 - 30000 >= credits*1796. web-156: 389580 >= 280176 (61.0%); web-392: 1019580 >=
-- 704032 (62.6%); web-1177: 3119580 >= 2113892 (63.4%). The rows also clear credit_packs_sticker_floor
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
       IS DISTINCT FROM 'lite-monthly:157,plus-monthly:924,starter-monthly:297,ultra-monthly:2011' THEN
        RAISE EXCEPTION 'Apply 0539 (new plan credits) before the pack migration';
    END IF;

    INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, active)
    VALUES ('web-156', 'web', 156, 999, true),
           ('web-392', 'web', 392, 2499, true),
           ('web-1177', 'web', 1177, 7499, true)
    ON CONFLICT (id) DO NOTHING;
    IF (SELECT count(*) FROM public.credit_packs WHERE sales_channel = 'web'
        AND ((id = 'web-156' AND credits = 156 AND price_usd_cents = 999)
          OR (id = 'web-392' AND credits = 392 AND price_usd_cents = 2499)
          OR (id = 'web-1177' AND credits = 1177 AND price_usd_cents = 7499))) <> 3 THEN
        RAISE EXCEPTION 'New credit pack rows missing or changed';
    END IF;

    UPDATE public.credit_packs SET active = true, updated_at = now()
    WHERE sales_channel = 'web' AND id IN ('web-156', 'web-392', 'web-1177');
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
       IS DISTINCT FROM 'web-156:156:999,web-392:392:2499,web-1177:1177:7499' THEN
        RAISE EXCEPTION 'Active web credit packs are not the expected three';
    END IF;
END $$;

-- The admin panel may pause or resume only the web packs on this list (0430). Point it at the new ids so
-- the owner can still manage the packs that are sold; the retired ids drop off.
CREATE OR REPLACE FUNCTION public.admin_editable_pack_ids() RETURNS TEXT[]
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['web-156','web-392','web-1177']::text[];
$$;
REVOKE ALL ON FUNCTION public.admin_editable_pack_ids() FROM PUBLIC,anon,authenticated,service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
