-- 0542 — App Store and Play yearly Generation plans keep a 50% worst-case margin after the 15% store
-- fee (ADR-0343, owner 2026-11-15: "store margin ... I need to be at 50%").
--
-- 0539 sets web yearly prices of $96.99 / $182.99 / $569.00 / $1,238.40 with 185 / 354 / 1,102 / 2,411
-- credits a month. The web keeps 50% under an 8% + $0.30 fee, but a store keeps only about 43% under a
-- 15% fee. Store buyers pay the SAME price as web buyers (owner), so the credits are what moves:
--
--   store credits a month <= price * 0.35 / (12 * 0.01796)     (price_cents * 350 >= credits * 1796 * 12)
--
--   plan                   price      store credits   web credits   store margin
--   lite-yearly-store      $96.99     157             185           50.2%
--   starter-yearly-store   $182.99    297             354           50.0%
--   plus-yearly-store      $569.00    924             1102          50.0%
--   ultra-yearly-store     $1,238.40  2011            2411          50.0%   (Android only; not sold on iOS, 0407)
--
-- The credits live on the plan row, and the store product reads its plan row, so store yearly products
-- get their own plan rows and the four annual store products are re-pointed to them. The web checkout
-- only offers the plans named in lib/subscriptions/api.js (LAUNCH_PLANS), so these rows never appear on
-- the web. Monthly store plans already hold 50% at 15% (185, 354, 1102, 2411 credits against limits of
-- 194, 370, 1149, 2514) and are not touched. Running store subscriptions keep their own price and credits
-- snapshot (0186); only new purchases get the store credits. Needs the Small Business Program (15%): at a
-- 30% fee nothing here holds 50%.
--
-- Apply after 0539. Idempotent: ON CONFLICT DO NOTHING and absolute assignments. Rollback: a forward
-- migration re-pointing the four annual products to the web yearly plans and deactivating these rows.

BEGIN;

DO $$
DECLARE affected BIGINT;
BEGIN
    IF (SELECT string_agg(id || ':' || price_usd_cents || ':' || credits, ',' ORDER BY id) FROM public.credit_subscription_plans
         WHERE id IN ('lite-yearly', 'starter-yearly', 'plus-yearly', 'ultra-yearly'))
       IS DISTINCT FROM 'lite-yearly:9699:185,plus-yearly:56900:1102,starter-yearly:18299:354,ultra-yearly:123840:2411' THEN
        RAISE EXCEPTION 'Apply 0539 (new yearly plans) before the store yearly plans';
    END IF;

    INSERT INTO public.credit_subscription_plans (id, billing_interval, price_usd_cents, credits, active)
    VALUES ('lite-yearly-store', 'year', 9699, 157, true), ('starter-yearly-store', 'year', 18299, 297, true),
           ('plus-yearly-store', 'year', 56900, 924, true), ('ultra-yearly-store', 'year', 123840, 2011, true)
    ON CONFLICT (id) DO NOTHING;
    IF (SELECT count(*) FROM public.credit_subscription_plans WHERE billing_interval = 'year' AND active
        AND (id, price_usd_cents, credits) IN (('lite-yearly-store', 9699, 157), ('starter-yearly-store', 18299, 297),
                                               ('plus-yearly-store', 56900, 924), ('ultra-yearly-store', 123840, 2011))) <> 4 THEN
        RAISE EXCEPTION 'Store yearly plan rows missing or changed';
    END IF;

    -- Re-point the annual store products (iOS has no Ultra annual, 0407).
    UPDATE public.credit_subscription_store_products SET plan_id = replace(plan_id, '-yearly', '-yearly-store')
     WHERE store_product_id IN ('ai.veyrnox.generation.lite.annual', 'ai.veyrnox.generation.starter.annual',
                                'ai.veyrnox.generation.plus.annual', 'ai.veyrnox.generation.ultra.annual')
       AND plan_id IN ('lite-yearly', 'starter-yearly', 'plus-yearly', 'ultra-yearly');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected NOT IN (0, 7) THEN RAISE EXCEPTION 'Expected seven annual store products to re-point, updated %', affected; END IF;
    IF (SELECT count(*) FROM public.credit_subscription_store_products
         WHERE store_product_id LIKE 'ai.veyrnox.generation.%.annual' AND plan_id LIKE '%-yearly-store') <> 7 THEN
        RAISE EXCEPTION 'The seven annual store products are not on the store yearly plans';
    END IF;

    -- Store margin guard: every store-mapped monthly and yearly plan keeps 50% at the 15% store fee.
    IF EXISTS (SELECT 1 FROM public.credit_subscription_store_products sp
                 JOIN public.credit_subscription_plans p ON p.id = sp.plan_id
                WHERE (p.billing_interval = 'month' AND p.credits::bigint * 1796 > p.price_usd_cents::bigint * 350)
                   OR (p.billing_interval = 'year' AND p.credits::bigint * 1796 * 12 > p.price_usd_cents::bigint * 350)) THEN
        RAISE EXCEPTION 'A store subscription plan falls below 50 percent after the 15 percent store fee';
    END IF;
    -- A store buyer pays what a web buyer pays.
    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans s JOIN public.credit_subscription_plans w ON w.id = replace(s.id, '-store', '')
                WHERE s.id LIKE '%-yearly-store' AND s.price_usd_cents <> w.price_usd_cents) THEN
        RAISE EXCEPTION 'A store yearly plan does not cost the same as the web yearly plan';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
