-- 0381 — Add the Lite monthly plan and set every monthly plan's credits to the most it can
-- hold while keeping a 50% margin on monthly AND yearly billing (ADR-0037 amendment 2, ADR-0064).
--
-- Worst case: every credit is spent on a row priced exactly at its cost cap ($0.01796 a credit).
-- Profit = price - 8% fee - $0.30 - credits * 0.01796, and 50% of the price must remain, so
-- credits <= (0.42 * price - 0.30) / 0.01796 on a monthly plan. A yearly plan (owner discounts of
-- 10%, 10%, 15% and 20%, built later) must hold the same credits a month, which lowers the limit
-- because the price per month falls and the fixed fee is spread over twelve months:
--
--   plan      monthly price  monthly limit  yearly price  yearly limit  credits set
--   Lite      $10            217            $108          209           209   (new)
--   Starter   $19            427            $205.20       398           398   (was 270)
--   Plus      $59            1363           $601.80       1171          1171  (was 1200)
--   Ultra     $129           3000           $1238.40      2412          2412  (was 3000)
--
-- Each credit is $0.0478, $0.0477, $0.0504 and $0.0535, all under the 7.5 cent rule of 0378 (a
-- subscription must cost less per credit than the best Pack). No subscription is live: the flag is
-- off, so no running subscription copies these credits (credit_subscriptions copies price and
-- credits when a checkout opens). Stripe prices are inline price_data, so no Stripe object changes.
--
-- Each UPDATE names the row's exact identity and accepts the old or the new credits, so a replay is
-- a no-op and drift stops the migration. Idempotent. Rollback: a forward migration with the old
-- credits (270, 1200, 3000) and Lite inactive.

BEGIN;

INSERT INTO public.credit_subscription_plans (id, billing_interval, price_usd_cents, credits)
VALUES ('lite-monthly', 'month', 1000, 209)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.credit_subscription_plans SET credits = 209, updated_at = now()
     WHERE id = 'lite-monthly' AND billing_interval = 'month' AND price_usd_cents = 1000 AND credits = 209;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expected the lite-monthly plan at $10, found %', affected; END IF;

    UPDATE public.credit_subscription_plans SET credits = 398, updated_at = now()
     WHERE id = 'starter-monthly' AND billing_interval = 'month' AND price_usd_cents = 1900 AND credits IN (270, 398);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expected the starter-monthly plan at $19, updated %', affected; END IF;

    UPDATE public.credit_subscription_plans SET credits = 1171, updated_at = now()
     WHERE id = 'plus-monthly' AND billing_interval = 'month' AND price_usd_cents = 5900 AND credits IN (1200, 1171);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expected the plus-monthly plan at $59, updated %', affected; END IF;

    UPDATE public.credit_subscription_plans SET credits = 2412, updated_at = now()
     WHERE id = 'ultra-monthly' AND billing_interval = 'month' AND price_usd_cents = 12900 AND credits IN (3000, 2412);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expected the ultra-monthly plan at $129, updated %', affected; END IF;

    -- Standing checks for every active monthly plan: under the best Pack rate (0378) and a 50%
    -- worst-case margin on the monthly price (cents x 1000: credits * 1796 <= 420 * price - 30000).
    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans
                WHERE active AND billing_interval = 'month'
                  AND price_usd_cents::bigint * 2 >= credits::bigint * 15) THEN
        RAISE EXCEPTION 'An active monthly plan does not beat the best Credit Pack rate';
    END IF;
    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans
                WHERE active AND billing_interval = 'month'
                  AND credits::bigint * 1796 > 420::bigint * price_usd_cents - 30000) THEN
        RAISE EXCEPTION 'An active monthly plan cannot keep a 50 percent margin in the worst case';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
