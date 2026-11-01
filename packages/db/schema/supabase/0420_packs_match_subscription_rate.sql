-- 0420 — One-off Credit Packs at the monthly subscription rate (ADR-0312, amends ADR-0064's
-- 2026-10-24 correction).
--
-- Owner, 2026-11-01: top-up packs get parity with the subscriptions. A pack now gives the same
-- credits per dollar as the best monthly plan (Starter, 398 credits for $19 = 0.20947 credits a
-- cent), rounded DOWN so a pack is never cheaper per credit than a plan:
--
--   now                    after
--   web-100   $10 /  100   web-209   $10 /  209   ($0.0478 a credit; Lite is the same rate)
--   web-300   $25 /  300   web-523   $25 /  523   ($0.0478)
--   web-1000  $75 / 1000   web-1571  $75 / 1571   ($0.0477)
--
-- This replaces 0382's rule that every plan is strictly cheaper than the best pack. A plan still
-- differs from a pack by what it is: Subscription Credits refresh each month and expire with the
-- billing period, Pack Credits never expire. Yearly plans stay cheaper (about $0.043 a credit).
--
-- 50% margin (owner's floor): each new pack keeps half of its price after an 8% + $0.30 fee when
-- every credit carries the catalog's worst-case provider cost of $0.01796:
--   price * 0.92 - 0.30 - credits * 0.01796 >= price * 0.50   ->   price*420 - 30000 >= credits*1796
-- web-209: 390000 >= 375364 (51.5%); web-523: 1020000 >= 939308 (53.2%); web-1571: 3120000 >= 2821516 (54.2%).
-- The rows also clear credit_packs_sticker_floor (0121, $0.043 a credit) and the legacy net floor (0041).
--
-- Same rule as 0121 and 0365: new ids carry the new credit counts so historical purchases and
-- pending checkout idempotency keys keep their meaning; the retired packs are deactivated, never
-- deleted or rewritten; a pending top-up keeps the price and credits it was opened with. iOS and
-- Android packs are not touched here (store fees are higher; see the ADR). Rollback: a forward
-- migration that reactivates web-100, web-300 and web-1000 and deactivates the three new ids.
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING, and absolute assignments.

BEGIN;

DO $$
DECLARE affected INTEGER;
BEGIN
    INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, active)
    VALUES ('web-209', 'web', 209, 1000, true),
           ('web-523', 'web', 523, 2500, true),
           ('web-1571', 'web', 1571, 7500, true)
    ON CONFLICT (id) DO NOTHING;
    IF (SELECT count(*) FROM public.credit_packs WHERE sales_channel = 'web'
        AND ((id = 'web-209' AND credits = 209 AND price_usd_cents = 1000)
          OR (id = 'web-523' AND credits = 523 AND price_usd_cents = 2500)
          OR (id = 'web-1571' AND credits = 1571 AND price_usd_cents = 7500))) <> 3 THEN
        RAISE EXCEPTION 'New credit pack rows missing or changed';
    END IF;

    -- Make the three new packs sellable on a replay too (absolute value).
    UPDATE public.credit_packs SET active = true, updated_at = now()
    WHERE sales_channel = 'web' AND id IN ('web-209', 'web-523', 'web-1571');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 3 THEN
        RAISE EXCEPTION 'Expected three new credit packs, updated %', affected;
    END IF;

    -- Retire the three packs they replace, guarded by their exact shape so drift cannot
    -- silently retire a different offer.
    UPDATE public.credit_packs SET active = false, updated_at = now()
    WHERE sales_channel = 'web' AND (
        (id = 'web-100' AND credits = 100 AND price_usd_cents = 1000) OR
        (id = 'web-300' AND credits = 300 AND price_usd_cents = 2500) OR
        (id = 'web-1000' AND credits = 1000 AND price_usd_cents = 7500));
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 3 THEN
        RAISE EXCEPTION 'Expected three flexible web pack rows, updated %', affected;
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
       IS DISTINCT FROM 'web-209:209:1000,web-523:523:2500,web-1571:1571:7500' THEN
        RAISE EXCEPTION 'Active web credit packs are not the expected three';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
