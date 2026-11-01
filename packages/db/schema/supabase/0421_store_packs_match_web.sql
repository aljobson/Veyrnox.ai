-- 0421 — iOS and Android Credit Packs carry the same credits as the web packs (ADR-0312, amendment 1).
--
-- 0420 moved the web packs to 209 / 523 / 1,571 credits. Owner, 2026-11-01: the store packs must be
-- aligned, and the 50% worst-case margin must hold after the store's fee. At the Small Business
-- rate (15%) the old 9.99 / 24.99 / 74.99 prices cannot carry those credits, so the store prices
-- rise to the next App Store points that hold it:
--
--   store product              now (0394)            after
--   ai.veyrnox.credits.100     100 cr  $9.99         ai.veyrnox.credits.209   209 cr  $10.99
--   ai.veyrnox.credits.300     300 cr  $24.99        ai.veyrnox.credits.523   523 cr  $26.99
--   ai.veyrnox.credits.1000    1000 cr $74.99        ai.veyrnox.credits.1571  1571 cr $89.99
--
-- A store product id is permanent, so the new sizes are new products. The three old rows stay in
-- the table, inactive, so RevenueCat refunds and delayed events for an old transaction still resolve.
--
-- 50% margin at a 15% store fee, every credit at the catalog's worst-case provider cost $0.01796
-- (no flat fee): price*0.85 - credits*0.01796 >= price*0.50, i.e. price_cents*350 >= credits*1796.
--   $10.99: 384650 >= 375364 (50.9%)   $26.99: 944650 >= 939308 (50.2%)   $89.99: 3149650 >= 2821516 (54.9%)
-- Needs the Small Business Program (15%). At the 30% standard rate none of these meets 50%; the
-- existing net floor (credit_packs_net_floor, 0344) is checked at 30% and each row clears it.
-- Rollback: a forward migration that reactivates the three old rows and deactivates the new ones.
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING and absolute assignments.

BEGIN;

DO $$
DECLARE affected INTEGER;
BEGIN
    INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, store_product_id, active)
    VALUES ('ios-209', 'ios', 209, 1099, 'ai.veyrnox.credits.209', true),
           ('ios-523', 'ios', 523, 2699, 'ai.veyrnox.credits.523', true),
           ('ios-1571', 'ios', 1571, 8999, 'ai.veyrnox.credits.1571', true),
           ('android-209', 'android', 209, 1099, 'ai.veyrnox.credits.209', true),
           ('android-523', 'android', 523, 2699, 'ai.veyrnox.credits.523', true),
           ('android-1571', 'android', 1571, 8999, 'ai.veyrnox.credits.1571', true)
    ON CONFLICT (id) DO NOTHING;
    IF (SELECT count(*) FROM public.credit_packs
        WHERE (sales_channel, credits, price_usd_cents, store_product_id) IN (
            ('ios', 209, 1099, 'ai.veyrnox.credits.209'), ('ios', 523, 2699, 'ai.veyrnox.credits.523'),
            ('ios', 1571, 8999, 'ai.veyrnox.credits.1571'), ('android', 209, 1099, 'ai.veyrnox.credits.209'),
            ('android', 523, 2699, 'ai.veyrnox.credits.523'), ('android', 1571, 8999, 'ai.veyrnox.credits.1571'))) <> 6 THEN
        RAISE EXCEPTION 'New store credit pack rows missing or changed';
    END IF;

    UPDATE public.credit_packs SET active = true, updated_at = now()
    WHERE store_product_id IN ('ai.veyrnox.credits.209', 'ai.veyrnox.credits.523', 'ai.veyrnox.credits.1571')
      AND sales_channel IN ('ios', 'android');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 6 THEN
        RAISE EXCEPTION 'Expected six new store credit packs, updated %', affected;
    END IF;

    -- Retire the six rows they replace, guarded by exact shape. A row an environment created
    -- under another id is matched by channel and store product id, as 0394 does.
    UPDATE public.credit_packs SET active = false, updated_at = now()
    WHERE sales_channel IN ('ios', 'android') AND (
        (store_product_id = 'ai.veyrnox.credits.100' AND credits = 100 AND price_usd_cents = 999) OR
        (store_product_id = 'ai.veyrnox.credits.300' AND credits = 300 AND price_usd_cents = 2499) OR
        (store_product_id = 'ai.veyrnox.credits.1000' AND credits = 1000 AND price_usd_cents = 7499));
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
       IS DISTINCT FROM 'android:209:1099:ai.veyrnox.credits.209,android:523:2699:ai.veyrnox.credits.523,android:1571:8999:ai.veyrnox.credits.1571,ios:209:1099:ai.veyrnox.credits.209,ios:523:2699:ai.veyrnox.credits.523,ios:1571:8999:ai.veyrnox.credits.1571' THEN
        RAISE EXCEPTION 'Active store credit packs are not the expected six';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
