-- 0539 — Every yearly Credit Subscription plan gets about 20% off, rounded UP to the next App Store
-- price point, and every plan keeps a 50% worst-case margin on both monthly and yearly billing
-- (ADR-0343, owner 2026-11-15).
--
-- Today the yearly discounts are 10% (Lite, Starter), 15% (Plus) and 20% (Ultra), which makes the
-- monthly price per credit rise with plan size (4.78, 4.77, 5.04, 5.35 cents). A uniform 20% fixes the
-- curve. Credits are the most the exact 20% price can hold at 50% (credits <= (0.42 * yearly price -
-- 0.30) / (12 * 0.01796)); the monthly plan carries the same credits a month. As in 0407 the yearly
-- price is then rounded UP to the next App Store point and charged the same on the web, so the store
-- and the database agree (owner, 2026-11-15). Credits are not raised for the extra cents, so the
-- margin is a little higher than 50% and the discount a little under 20%.
--
--   plan     monthly   yearly exact 20%   yearly sold   discount   credits a month   was
--   Lite     $10       $96.00             $96.99        19.2%      185               209 (yearly $108.99)
--   Starter  $19       $182.40            $182.99       19.7%      354               398 (yearly $209.00)
--   Plus     $59       $566.40            $569.00       19.6%      1102              1171 (yearly $609.00)
--   Ultra    $129      $1238.40           $1238.40      20.0%      2411              2411 (not sold on iOS, 0407)
--
-- UNVERIFIED: $96.99, $182.99 and $569.00 are the owner-confirmed rule (next App Store point up) applied
-- to points I could not read from App Store Connect. Confirm each point exists there, and on Play,
-- before this applies; if one differs, change it here (it must stay >= the exact 20% price).
--
-- Running subscriptions keep their own price and credits snapshot (0186): nobody's current plan changes.
-- Stripe prices are inline price_data, so no Stripe object changes. App Store and Play yearly prices are
-- set in the stores, not here (see ADR-0343); the store plan rows follow the same ids, so until the owner
-- changes the store prices a store buyer pays the old yearly price for the new credits (a higher margin).
-- Packs are NOT touched here (ADR-0312 parity decision is open in ADR-0343).
--
-- Each UPDATE names the row's exact identity, accepts the old or the new figures, and asserts one row, so
-- a replay is a no-op and drift stops the migration. Rollback: a forward migration with the old figures
-- (209 / 398 / 1171, yearly 10899 / 20900 / 60900).

BEGIN;

DO $$
DECLARE
    plan RECORD;
    affected BIGINT;
BEGIN
    FOR plan IN SELECT * FROM (VALUES
        ('lite-monthly',    'month', 1000,   185, 209),
        ('starter-monthly', 'month', 1900,   354, 398),
        ('plus-monthly',    'month', 5900,   1102, 1171),
        ('ultra-monthly',   'month', 12900,  2411, 2411)) AS v(id, bi, price, credits, old_credits)
    LOOP
        UPDATE public.credit_subscription_plans SET credits = plan.credits, updated_at = now()
         WHERE id = plan.id AND billing_interval = plan.bi AND price_usd_cents = plan.price
           AND credits IN (plan.credits, plan.old_credits);
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN RAISE EXCEPTION 'Expected the % plan at % cents, updated %', plan.id, plan.price, affected; END IF;
    END LOOP;

    FOR plan IN SELECT * FROM (VALUES
        ('lite-yearly',    9699,   10899,  185, 209),
        ('starter-yearly', 18299,  20900,  354, 398),
        ('plus-yearly',    56900,  60900,  1102, 1171),
        ('ultra-yearly',   123840, 123840, 2411, 2411)) AS v(id, price, old_price, credits, old_credits)
    LOOP
        UPDATE public.credit_subscription_plans SET price_usd_cents = plan.price, credits = plan.credits, updated_at = now()
         WHERE id = plan.id AND billing_interval = 'year'
           AND price_usd_cents IN (plan.price, plan.old_price) AND credits IN (plan.credits, plan.old_credits);
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN RAISE EXCEPTION 'Expected the % plan, updated %', plan.id, affected; END IF;
    END LOOP;

    -- Standing checks. Monthly: 50% worst case (credits * 1796 <= 420 * price - 30000, cents x 1000) and
    -- under the best Pack rate of 0378 (price * 2 < credits * 15 fails it).
    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans WHERE billing_interval = 'month'
                  AND credits::bigint * 1796 > 420::bigint * price_usd_cents - 30000) THEN
        RAISE EXCEPTION 'A monthly plan cannot keep a 50 percent margin in the worst case';
    END IF;
    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans WHERE billing_interval = 'month' AND active
                  AND price_usd_cents::bigint * 2 >= credits::bigint * 15) THEN
        RAISE EXCEPTION 'An active monthly plan does not beat the best Credit Pack rate';
    END IF;
    -- Yearly: 50% on the monthly share of the price (0383) and the Pack-rate rule.
    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans WHERE billing_interval = 'year'
                  AND credits::bigint * 1796 * 12 > 420::bigint * price_usd_cents - 30000) THEN
        RAISE EXCEPTION 'A yearly plan cannot keep a 50 percent margin in the worst case';
    END IF;
    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans WHERE billing_interval = 'year'
                  AND price_usd_cents::bigint * 2 >= credits::bigint * 12 * 15) THEN
        RAISE EXCEPTION 'A yearly plan does not beat the best Credit Pack rate';
    END IF;
    -- Uniform discount: each yearly price is at least 80% of twelve monthly payments (the exact 20%
    -- price) and under 81% (so it is never rounded up by more than the next store point), same credits.
    IF EXISTS (
        SELECT 1 FROM public.credit_subscription_plans y
          JOIN public.credit_subscription_plans m ON m.id = replace(y.id, '-yearly', '-monthly')
         WHERE y.billing_interval = 'year' AND y.id IN ('lite-yearly', 'starter-yearly', 'plus-yearly', 'ultra-yearly')
           AND (y.price_usd_cents::bigint * 1000 < m.price_usd_cents::bigint * 12 * 800
                OR y.price_usd_cents::bigint * 1000 > m.price_usd_cents::bigint * 12 * 810
                OR y.credits <> m.credits)) THEN
        RAISE EXCEPTION 'A yearly plan is not 20 percent off twelve monthly payments (rounded up to a store point) at the same credits';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
