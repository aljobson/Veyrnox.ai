-- 0407: yearly Generation prices on App Store price points (ADR-0108 amendment 3).
--
-- The App Store has no price point at $108.00, $205.20 or $601.80, and its highest subscription
-- price is $1,000.00. Owner, 2026-10-30: round the yearly prices UP to the next App Store point and
-- use the same price on the web, so the store and the database agree:
--
--   plan            was        now        credits a month   50% worst-case limit at the new price
--   lite-yearly     $108.00    $108.99    209               211
--   starter-yearly  $205.20    $209.00    398               405
--   plus-yearly     $601.80    $609.00    1171              1185
--
-- Ultra yearly ($1,238.40) is above the App Store maximum. Owner: not sold on iOS. Its iOS mapping
-- (0393) is removed; the plan stays on the web and Android mappings are unchanged. Nothing was ever
-- bought under that iOS product (sales were never open), so no event needs it to settle.
--
-- Running subscriptions keep their own price snapshot (0186). Replay sets the same absolute values.

BEGIN;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.credit_subscription_plans SET price_usd_cents = 10899, updated_at = now()
     WHERE id = 'lite-yearly' AND billing_interval = 'year' AND credits = 209;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expected the lite-yearly plan with 209 credits, updated %', affected; END IF;

    UPDATE public.credit_subscription_plans SET price_usd_cents = 20900, updated_at = now()
     WHERE id = 'starter-yearly' AND billing_interval = 'year' AND credits = 398;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expected the starter-yearly plan with 398 credits, updated %', affected; END IF;

    UPDATE public.credit_subscription_plans SET price_usd_cents = 60900, updated_at = now()
     WHERE id = 'plus-yearly' AND billing_interval = 'year' AND credits = 1171;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expected the plus-yearly plan with 1171 credits, updated %', affected; END IF;

    -- Standing checks from 0383 for every yearly plan: a 50% worst-case margin on the monthly share
    -- of the price and under the 7.5 cent best-Pack rate.
    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans WHERE billing_interval = 'year'
                  AND credits::bigint * 1796 * 12 > 420::bigint * price_usd_cents - 30000) THEN
        RAISE EXCEPTION 'A yearly plan cannot keep a 50 percent margin in the worst case';
    END IF;
    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans WHERE billing_interval = 'year'
                  AND price_usd_cents::bigint * 2 >= credits::bigint * 12 * 15) THEN
        RAISE EXCEPTION 'A yearly plan does not beat the best Credit Pack rate';
    END IF;

    DELETE FROM public.credit_subscription_store_products
     WHERE channel = 'ios' AND store_product_id = 'ai.veyrnox.generation.ultra.annual';
    IF EXISTS (SELECT 1 FROM public.credit_subscription_store_products
                WHERE channel = 'ios' AND plan_id = 'ultra-yearly') THEN
        RAISE EXCEPTION 'ultra-yearly must not be sold on iOS';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
