-- 0541 — iOS and Android Credit Packs carry the same credits as the new web packs (ADR-0343,
-- amends ADR-0312 amendment 1).
--
-- 0540 moved the web packs to 156 / 392 / 1,177 credits. The store packs follow, with the 50% worst-case
-- margin held after the store's fee. At the Small Business rate (15%) the credits now fit the ordinary
-- App Store points again, so the store prices fall back from 0421's $10.99 / $26.99 / $89.99:
--
--   store product              now (0421)             after
--   ai.veyrnox.credits.209     209 cr  $10.99         ai.veyrnox.credits.156   156 cr  $9.99
--   ai.veyrnox.credits.523     523 cr  $26.99         ai.veyrnox.credits.392   392 cr  $24.99
--   ai.veyrnox.credits.1571    1571 cr $89.99         ai.veyrnox.credits.1177  1177 cr $74.99
--
-- A store product id is permanent and the app reads the credit count from it, so these are new products
-- that must also exist in App Store Connect, Play Console and RevenueCat before an app build offers them.
-- The old rows stay, inactive, so a refund or delayed event for an old transaction still resolves.
--
-- 50% at a 15% fee, every credit at the worst-case provider cost $0.01796 (no flat fee):
-- price_cents*350 >= credits*1796:  $9.99: 349650 >= 280176 (57.0%)   $24.99: 874650 >= 704032 (56.8%)
-- $74.99: 2624650 >= 2113892 (56.8%). Needs the Small Business Program; at 30% none of the three meets 50%.
-- They clear credit_packs_net_floor (0344, written at 30%) and the sticker floor (0121).
-- Rollback: a forward migration that reactivates the old three and deactivates these.
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING and absolute assignments.

BEGIN;

DO $$
DECLARE affected INTEGER;
BEGIN
    INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, store_product_id, active)
    VALUES ('ios-156', 'ios', 156, 999, 'ai.veyrnox.credits.156', true),
           ('ios-392', 'ios', 392, 2499, 'ai.veyrnox.credits.392', true),
           ('ios-1177', 'ios', 1177, 7499, 'ai.veyrnox.credits.1177', true),
           ('android-156', 'android', 156, 999, 'ai.veyrnox.credits.156', true),
           ('android-392', 'android', 392, 2499, 'ai.veyrnox.credits.392', true),
           ('android-1177', 'android', 1177, 7499, 'ai.veyrnox.credits.1177', true)
    ON CONFLICT (id) DO NOTHING;
    IF (SELECT count(*) FROM public.credit_packs
        WHERE (sales_channel, credits, price_usd_cents, store_product_id) IN (
            ('ios', 156, 999, 'ai.veyrnox.credits.156'), ('ios', 392, 2499, 'ai.veyrnox.credits.392'),
            ('ios', 1177, 7499, 'ai.veyrnox.credits.1177'), ('android', 156, 999, 'ai.veyrnox.credits.156'),
            ('android', 392, 2499, 'ai.veyrnox.credits.392'), ('android', 1177, 7499, 'ai.veyrnox.credits.1177'))) <> 6 THEN
        RAISE EXCEPTION 'New store credit pack rows missing or changed';
    END IF;

    UPDATE public.credit_packs SET active = true, updated_at = now()
    WHERE store_product_id IN ('ai.veyrnox.credits.156', 'ai.veyrnox.credits.392', 'ai.veyrnox.credits.1177')
      AND sales_channel IN ('ios', 'android');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 6 THEN
        RAISE EXCEPTION 'Expected six new store credit packs, updated %', affected;
    END IF;

    -- Retire the six rows they replace, guarded by exact shape.
    UPDATE public.credit_packs SET active = false, updated_at = now()
    WHERE sales_channel IN ('ios', 'android') AND (
        (store_product_id = 'ai.veyrnox.credits.209' AND credits = 209 AND price_usd_cents = 1099) OR
        (store_product_id = 'ai.veyrnox.credits.523' AND credits = 523 AND price_usd_cents = 2699) OR
        (store_product_id = 'ai.veyrnox.credits.1571' AND credits = 1571 AND price_usd_cents = 8999));
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 6 THEN
        RAISE EXCEPTION 'Expected six superseded store pack rows, updated %', affected;
    END IF;

    -- Store margin guard: every active store pack keeps 50% at the 15% Small Business rate.
    IF EXISTS (SELECT 1 FROM public.credit_packs WHERE sales_channel IN ('ios', 'android') AND active
               AND price_usd_cents::bigint * 350 < credits::bigint * 1796) THEN
        RAISE EXCEPTION 'An active store credit pack falls below the 50 percent contribution scenario';
    END IF;

    -- Alignment guard: the active credit sizes are the same on every channel.
    IF (SELECT string_agg(credits::text, ',' ORDER BY credits) FROM public.credit_packs WHERE sales_channel = 'web' AND active)
       IS DISTINCT FROM (SELECT string_agg(credits::text, ',' ORDER BY credits) FROM public.credit_packs WHERE sales_channel = 'ios' AND active)
       OR (SELECT string_agg(credits::text, ',' ORDER BY credits) FROM public.credit_packs WHERE sales_channel = 'ios' AND active)
       IS DISTINCT FROM (SELECT string_agg(credits::text, ',' ORDER BY credits) FROM public.credit_packs WHERE sales_channel = 'android' AND active) THEN
        RAISE EXCEPTION 'Active credit pack sizes differ between web, iOS and Android';
    END IF;

    IF (SELECT string_agg(sales_channel || ':' || credits || ':' || price_usd_cents || ':' || store_product_id, ',' ORDER BY sales_channel, credits)
        FROM public.credit_packs WHERE sales_channel IN ('ios', 'android') AND active)
       IS DISTINCT FROM 'android:156:999:ai.veyrnox.credits.156,android:392:2499:ai.veyrnox.credits.392,android:1177:7499:ai.veyrnox.credits.1177,ios:156:999:ai.veyrnox.credits.156,ios:392:2499:ai.veyrnox.credits.392,ios:1177:7499:ai.veyrnox.credits.1177' THEN
        RAISE EXCEPTION 'Active store credit packs are not the expected six';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
