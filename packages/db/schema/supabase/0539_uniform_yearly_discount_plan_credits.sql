-- 0539 — One set of plan credits and prices on web, iOS and Android: every yearly Credit Subscription
-- plan gets about 20% off (rounded UP to an App Store point), and every plan keeps a 50% worst-case
-- margin on BOTH the web fee and the 15% store fee (ADR-0343, owner 2026-11-15).
--
-- Owner rules: web and mobile pricing are identical (price AND credits); the stores hold 50% too; yearly
-- is 20% off. The binding limit is the store yearly plan: after a 15% fee with every credit at the
-- worst-case provider cost $0.01796, credits a month <= price * 0.35 / (12 * 0.01796). The monthly plan
-- carries the same credits a month as the yearly plan (a discounted plan never gives fewer credits).
--
--   plan     monthly   yearly sold   discount   credits a month   was (monthly / yearly)
--   Lite     $10       $96.99        19.2%      157               209 / 209  (yearly $108.99)
--   Starter  $19       $182.99       19.7%      297               398 / 398  (yearly $209.00)
--   Plus     $59       $569.00       19.6%      924               1171 / 1171 (yearly $609.00)
--   Ultra    $129      $1238.40      20.0%      2011              2411 / 2411 (not sold on iOS, 0407)
--
--   worst-case margin    web monthly   web yearly   store monthly   store yearly (15% fee)
--   Lite                 60.8%         56.8%        56.8%           50.1%
--   Starter              62.3%         56.9%        56.9%           50.0%
--   Plus                 63.4%         56.9%        56.9%           50.0%
--   Ultra                63.8%         57.0%        57.0%           50.0%
--
-- The price per credit is about 6.4 cents monthly and 5.1 cents yearly on every channel: the cost of
-- holding 50% in the stores at an identical price. UNVERIFIED: $96.99, $182.99 and $569.00 are the next
-- App Store points up as in 0407, which I could not read from App Store Connect; confirm each exists
-- there and on Play before this applies. Running subscriptions keep their own price and credits snapshot
-- (0186); stores use the same plan rows, so only new purchases get the new credits. Needs the Small
-- Business Program (15%); at 30% nothing here holds 50%. Stripe prices are inline, so none change.
--
-- Each UPDATE names the row's exact identity, accepts the old or the new figures and asserts one row, so a
-- replay is a no-op and drift stops the migration. Rollback: a forward migration with the old figures
-- (209 / 398 / 1171 / 2411 credits, yearly 10899 / 20900 / 60900).

BEGIN;

DO $$
DECLARE
    plan RECORD;
    affected BIGINT;
BEGIN
    FOR plan IN SELECT * FROM (VALUES
        ('lite-monthly',    1000,   157,  209),
        ('starter-monthly', 1900,   297,  398),
        ('plus-monthly',    5900,   924,  1171),
        ('ultra-monthly',   12900,  2011, 2411)) AS v(id, price, credits, old_credits)
    LOOP
        UPDATE public.credit_subscription_plans SET credits = plan.credits, updated_at = now()
         WHERE id = plan.id AND billing_interval = 'month' AND price_usd_cents = plan.price
           AND credits IN (plan.credits, plan.old_credits);
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN RAISE EXCEPTION 'Expected the % plan at % cents, updated %', plan.id, plan.price, affected; END IF;
    END LOOP;

    FOR plan IN SELECT * FROM (VALUES
        ('lite-yearly',    9699,   10899,  157,  209),
        ('starter-yearly', 18299,  20900,  297,  398),
        ('plus-yearly',    56900,  60900,  924,  1171),
        ('ultra-yearly',   123840, 123840, 2011, 2411)) AS v(id, price, old_price, credits, old_credits)
    LOOP
        UPDATE public.credit_subscription_plans SET price_usd_cents = plan.price, credits = plan.credits, updated_at = now()
         WHERE id = plan.id AND billing_interval = 'year'
           AND price_usd_cents IN (plan.price, plan.old_price) AND credits IN (plan.credits, plan.old_credits);
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN RAISE EXCEPTION 'Expected the % plan, updated %', plan.id, affected; END IF;
    END LOOP;

    -- Web margin, monthly: 50% worst case (credits * 1796 <= 420 * price - 30000, cents x 1000) and under the
    -- best Pack rate of 0378.
    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans WHERE billing_interval = 'month'
                  AND credits::bigint * 1796 > 420::bigint * price_usd_cents - 30000) THEN
        RAISE EXCEPTION 'A monthly plan cannot keep a 50 percent margin in the worst case';
    END IF;
    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans WHERE billing_interval = 'month' AND active
                  AND price_usd_cents::bigint * 2 >= credits::bigint * 15) THEN
        RAISE EXCEPTION 'An active monthly plan does not beat the best Credit Pack rate';
    END IF;
    -- Web margin, yearly: 50% on the monthly share of the price (0383) and the Pack-rate rule.
    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans WHERE billing_interval = 'year'
                  AND credits::bigint * 1796 * 12 > 420::bigint * price_usd_cents - 30000) THEN
        RAISE EXCEPTION 'A yearly plan cannot keep a 50 percent margin in the worst case';
    END IF;
    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans WHERE billing_interval = 'year'
                  AND price_usd_cents::bigint * 2 >= credits::bigint * 12 * 15) THEN
        RAISE EXCEPTION 'A yearly plan does not beat the best Credit Pack rate';
    END IF;
    -- Store margin: the same plan rows are sold in the stores at a 15% fee, no flat fee, so a monthly plan
    -- needs credits * 1796 <= price * 350 and a yearly plan credits * 1796 * 12 <= price * 350.
    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans WHERE id IN
                  ('lite-monthly', 'starter-monthly', 'plus-monthly', 'ultra-monthly')
                  AND credits::bigint * 1796 > price_usd_cents::bigint * 350)
       OR EXISTS (SELECT 1 FROM public.credit_subscription_plans WHERE id IN
                  ('lite-yearly', 'starter-yearly', 'plus-yearly', 'ultra-yearly')
                  AND credits::bigint * 1796 * 12 > price_usd_cents::bigint * 350) THEN
        RAISE EXCEPTION 'A plan falls below 50 percent after the 15 percent store fee';
    END IF;
    -- Uniform discount: each yearly price is at least 80% of twelve monthly payments (the exact 20% price)
    -- and under 81% (never rounded up by more than the next store point), same credits as the monthly plan.
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
