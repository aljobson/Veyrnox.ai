-- 0394: Mobile store catalog parity.
-- Credit packs mirror the public web catalog's 100, 300 and 1000-credit sizes.
-- Store price points are the nearest standard USD points to the web's $10, $25 and $75 prices.
-- Retired products remain in the table so RevenueCat refunds and delayed events can still resolve them.
-- Google Play subscription identifiers include the base plan after a colon in RevenueCat.

BEGIN;

UPDATE public.credit_packs
SET active = false, updated_at = now()
WHERE sales_channel IN ('ios', 'android')
  AND store_product_id NOT IN (
      'ai.veyrnox.credits.100',
      'ai.veyrnox.credits.300',
      'ai.veyrnox.credits.1000'
  );

DO $$
DECLARE pack RECORD;
BEGIN
    FOR pack IN SELECT * FROM (VALUES
        ('ios-100', 'ios', 100, 999, 'ai.veyrnox.credits.100'),
        ('ios-300', 'ios', 300, 2499, 'ai.veyrnox.credits.300'),
        ('ios-1000', 'ios', 1000, 7499, 'ai.veyrnox.credits.1000'),
        ('android-100', 'android', 100, 999, 'ai.veyrnox.credits.100'),
        ('android-300', 'android', 300, 2499, 'ai.veyrnox.credits.300'),
        ('android-1000', 'android', 1000, 7499, 'ai.veyrnox.credits.1000')
    ) AS expected(id, channel, credits, price, product_id)
    LOOP
        -- M6 environments may already have the product under a manually chosen row id.
        -- Keep that identity so historical foreign keys never change.
        UPDATE public.credit_packs SET
            credits = pack.credits,
            price_usd_cents = pack.price,
            active = true,
            updated_at = now()
        WHERE sales_channel = pack.channel AND store_product_id = pack.product_id;

        IF NOT FOUND THEN
            INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, store_product_id, active)
            VALUES (pack.id, pack.channel, pack.credits, pack.price, pack.product_id, true)
            ON CONFLICT (id) DO UPDATE SET
                sales_channel = EXCLUDED.sales_channel,
                credits = EXCLUDED.credits,
                price_usd_cents = EXCLUDED.price_usd_cents,
                store_product_id = EXCLUDED.store_product_id,
                active = true,
                updated_at = now();
        END IF;
    END LOOP;

    IF (SELECT count(*) FROM public.credit_packs
        WHERE active AND sales_channel IN ('ios', 'android')
          AND (sales_channel, credits, price_usd_cents, store_product_id) IN (
              ('ios', 100, 999, 'ai.veyrnox.credits.100'),
              ('ios', 300, 2499, 'ai.veyrnox.credits.300'),
              ('ios', 1000, 7499, 'ai.veyrnox.credits.1000'),
              ('android', 100, 999, 'ai.veyrnox.credits.100'),
              ('android', 300, 2499, 'ai.veyrnox.credits.300'),
              ('android', 1000, 7499, 'ai.veyrnox.credits.1000')
          )) <> 6 THEN
        RAISE EXCEPTION 'Mobile credit-pack parity rows are missing or changed';
    END IF;
    IF EXISTS (SELECT 1 FROM public.credit_packs
               WHERE active AND sales_channel IN ('ios', 'android')
                 AND store_product_id NOT IN ('ai.veyrnox.credits.100', 'ai.veyrnox.credits.300', 'ai.veyrnox.credits.1000')) THEN
        RAISE EXCEPTION 'An unexpected mobile credit pack is still active';
    END IF;
END $$;

INSERT INTO public.credit_subscription_store_products (channel, store_product_id, plan_id)
SELECT 'android', mapping.product_id, mapping.plan_id
FROM (VALUES
    ('ai.veyrnox.generation.lite.monthly:monthly', 'lite-monthly'),
    ('ai.veyrnox.generation.starter.monthly:monthly', 'starter-monthly'),
    ('ai.veyrnox.generation.plus.monthly:monthly', 'plus-monthly'),
    ('ai.veyrnox.generation.ultra.monthly:monthly', 'ultra-monthly'),
    ('ai.veyrnox.generation.lite.annual:annual', 'lite-yearly'),
    ('ai.veyrnox.generation.starter.annual:annual', 'starter-yearly'),
    ('ai.veyrnox.generation.plus.annual:annual', 'plus-yearly'),
    ('ai.veyrnox.generation.ultra.annual:annual', 'ultra-yearly')
) AS mapping(product_id, plan_id)
WHERE EXISTS (SELECT 1 FROM public.credit_subscription_plans p WHERE p.id = mapping.plan_id)
ON CONFLICT (channel, store_product_id) DO UPDATE SET plan_id = EXCLUDED.plan_id;

INSERT INTO public.social_publish_store_products (channel, store_product_id, plan_id)
SELECT 'android', mapping.product_id, mapping.plan_id
FROM (VALUES
    ('ai.veyrnox.publish.weekly:weekly', 'publish-weekly'),
    ('ai.veyrnox.publish.monthly:monthly', 'publish'),
    ('ai.veyrnox.publish.annual:annual', 'publish-annual')
) AS mapping(product_id, plan_id)
WHERE EXISTS (SELECT 1 FROM public.social_publish_plans p WHERE p.id = mapping.plan_id)
ON CONFLICT (channel, store_product_id) DO UPDATE SET plan_id = EXCLUDED.plan_id;

COMMIT;
