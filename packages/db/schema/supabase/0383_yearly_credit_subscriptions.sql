-- 0383 — Yearly Credit Subscriptions: one payment a year, credits granted month by month.
--
-- Yearly plans carry the YEARLY price in price_usd_cents and the credits of ONE MONTH in `credits`
-- (owner, 2026-10-24: discounts 10% Lite and Starter, 15% Plus, 20% Ultra; the same credits a month as
-- the monthly plan, no rollover). The paid yearly invoice grants month 1 at once. An hourly sweep
-- (grant_due_yearly_cycles) grants months 2 to 12 as each month starts, through subscription_grant, so
-- the existing no-rollover rule (the previous month's remainder expires with the new grant) and every
-- reconcile function hold unchanged. A refund or dispute ends the subscription, which stops the sweep.
--
--   plan           yearly price   credits a month   $ a credit   worst-case margin (yearly)
--   lite-yearly    $108.00        209               4.3 cents    50%
--   starter-yearly $205.20        398               4.3 cents    50%
--   plus-yearly    $601.80        1171              4.3 cents    50%
--   ultra-yearly   $1238.40       2411              4.3 cents    50%
--
-- Ultra's yearly limit is 2411.99 credits a month, so 2412 (set on the monthly plan by 0381) misses 50% by
-- a hair; this migration sets both Ultra plans to 2411.
--
-- Yearly rows are inserted INACTIVE: the checkout, webhook and page code ship in a following change,
-- which activates them. No subscription is live (the flag is off).
--
-- Cycle k (1 to 12) of a yearly subscription is granted at anchor + (k - 1) months and ends at
-- anchor + k months, where the anchor is the moment the yearly invoice was granted. Month 1 keeps the
-- invoice id as its grant key (so a refund of the invoice finds it); later months use
-- 'ysub_<sub id>_<invoice digest>_c<k>' (at most 100 characters, the grant key limit).
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT DO NOTHING.
-- Rollback: a forward migration deactivating the yearly plans; existing columns stay.

BEGIN;

ALTER TABLE public.credit_subscription_plans DROP CONSTRAINT IF EXISTS credit_subscription_plans_billing_interval_check;
ALTER TABLE public.credit_subscription_plans
    ADD CONSTRAINT credit_subscription_plans_billing_interval_check CHECK (billing_interval IN ('week', 'month', 'year'));

INSERT INTO public.credit_subscription_plans (id, billing_interval, price_usd_cents, credits, active)
VALUES ('lite-yearly', 'year', 10800, 209, false), ('starter-yearly', 'year', 20520, 398, false),
       ('plus-yearly', 'year', 60180, 1171, false), ('ultra-yearly', 'year', 123840, 2411, false)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.credit_subscription_plans SET credits = 2411, updated_at = now()
     WHERE id = 'ultra-monthly' AND billing_interval = 'month' AND price_usd_cents = 12900 AND credits IN (2412, 2411);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Expected the ultra-monthly plan at $129, updated %', affected; END IF;

    SELECT count(*) INTO affected FROM public.credit_subscription_plans
     WHERE billing_interval = 'year' AND (id, price_usd_cents, credits) IN
           (('lite-yearly', 10800, 209), ('starter-yearly', 20520, 398), ('plus-yearly', 60180, 1171), ('ultra-yearly', 123840, 2411));
    IF affected <> 4 THEN RAISE EXCEPTION 'Expected four yearly plan rows, found %', affected; END IF;

    -- Standing checks for every yearly plan: a 50% worst-case margin on the monthly share of the price
    -- (credits * 1796 * 12 <= 420 * price - 30000, cents x 1000) and under the 7.5 cent best-Pack rate.
    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans WHERE billing_interval = 'year'
                  AND credits::bigint * 1796 * 12 > 420::bigint * price_usd_cents - 30000) THEN
        RAISE EXCEPTION 'A yearly plan cannot keep a 50 percent margin in the worst case';
    END IF;
    IF EXISTS (SELECT 1 FROM public.credit_subscription_plans WHERE billing_interval = 'year'
                  AND price_usd_cents::bigint * 2 >= credits::bigint * 12 * 15) THEN
        RAISE EXCEPTION 'A yearly plan does not beat the best Credit Pack rate';
    END IF;
END $$;

-- ── The cycle state of a yearly subscription ──────────────────────────────
ALTER TABLE public.credit_subscriptions
    ADD COLUMN IF NOT EXISTS cycles_granted INTEGER     NOT NULL DEFAULT 0 CHECK (cycles_granted BETWEEN 0 AND 12),
    ADD COLUMN IF NOT EXISTS cycle_anchor   TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS cycle_key_base TEXT        NULL CHECK (cycle_key_base IS NULL OR cycle_key_base ~ '^[A-Za-z0-9_]{1,90}$');
CREATE INDEX IF NOT EXISTS credit_subscriptions_yearly_due_idx
    ON public.credit_subscriptions (cycle_anchor) WHERE cycles_granted BETWEEN 1 AND 11 AND status IN ('active', 'past_due');

-- ── grant_credit_subscription_invoice: yearly plans grant one month ───────
-- Same contract as 0187. For a yearly plan the cycle ends one month after the grant (not at the
-- invoice's period end, a year away) and the schedule for months 2 to 12 is recorded. A renewal
-- invoice (a new invoice id on a yearly plan) starts a new year at month 1.
CREATE OR REPLACE FUNCTION public.grant_credit_subscription_invoice(
    p_stripe_subscription_id TEXT,
    p_invoice_id TEXT,
    p_event_id TEXT,
    p_paid_cents INTEGER,
    p_period_end TIMESTAMPTZ,
    p_occurred_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sub    public.credit_subscriptions%ROWTYPE;
    v_event  public.credit_subscription_events%ROWTYPE;
    v_grant  JSONB;
    v_code   TEXT;
    v_yearly BOOLEAN;
    v_end    TIMESTAMPTZ;
    v_now    TIMESTAMPTZ := now();
BEGIN
    IF p_event_id IS NULL OR p_event_id !~ '^(evt|cs)_[A-Za-z0-9_]{1,250}$' OR p_occurred_at IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT');
    END IF;
    IF p_stripe_subscription_id IS NULL OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9_]{1,250}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SUBSCRIPTION');
    END IF;
    IF p_invoice_id IS NULL OR p_invoice_id !~ '^in_[A-Za-z0-9_]{1,97}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INVOICE');
    END IF;

    SELECT * INTO v_sub FROM public.credit_subscriptions x
    WHERE x.stripe_subscription_id = p_stripe_subscription_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND');
    END IF;

    SELECT * INTO v_event FROM public.credit_subscription_events e WHERE e.stripe_event_id = p_event_id;
    IF FOUND THEN
        IF v_event.type = 'invoice.paid' AND v_event.status = 'refused' THEN
            RETURN jsonb_build_object('ok', false, 'code', COALESCE(v_event.detail, 'REFUSED'),
                                      'refused', true, 'idempotent', true);
        END IF;
        IF v_event.type = 'invoice.paid' AND v_event.status = 'granted' THEN
            RETURN jsonb_build_object('ok', true, 'idempotent', true, 'granted', 0);
        END IF;
        RETURN jsonb_build_object('ok', false, 'code', 'EVENT_ID_ALREADY_USED');
    END IF;
    IF v_sub.status = 'pending' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_READY');
    END IF;

    SELECT p.billing_interval = 'year' INTO v_yearly FROM public.credit_subscription_plans p WHERE p.id = v_sub.plan_id;
    v_yearly := COALESCE(v_yearly, false);
    -- A yearly cycle is one month long; a monthly or weekly one ends where Stripe says.
    v_end := CASE WHEN v_yearly THEN v_now + interval '1 month' ELSE p_period_end END;

    v_code := CASE
        WHEN v_sub.status NOT IN ('active', 'past_due') THEN 'SUBSCRIPTION_NOT_LIVE'
        WHEN p_paid_cents IS NULL OR p_paid_cents <= 0 THEN 'INVOICE_NOT_PAID'
        ELSE NULL END;
    IF v_code IS NULL THEN
        v_grant := public.subscription_grant(v_sub.user_id, v_sub.credits, v_end, p_invoice_id);
        IF (v_grant->>'ok')::BOOLEAN IS NOT TRUE THEN
            v_code := COALESCE(v_grant->>'code', 'GRANT_REFUSED');
        END IF;
    END IF;

    IF v_code IS NOT NULL THEN
        INSERT INTO public.credit_subscription_events (subscription_id, stripe_event_id, type, status, detail, period_end, occurred_at)
        VALUES (v_sub.id, p_event_id, 'invoice.paid', 'refused', v_code, p_period_end, p_occurred_at);
        RETURN jsonb_build_object('ok', false, 'code', v_code, 'refused', true, 'idempotent', false,
                                  'subscription_id', v_sub.id, 'user_id', v_sub.user_id);
    END IF;

    -- A fresh yearly grant (not a replay of the same invoice) opens month 1 of a year.
    IF v_yearly AND (v_grant->>'idempotent')::BOOLEAN IS NOT TRUE THEN
        UPDATE public.credit_subscriptions SET
            cycles_granted = 1, cycle_anchor = v_now,
            cycle_key_base = 'ysub_' || replace(id::TEXT, '-', '') || '_' || substr(md5(p_invoice_id), 1, 12),
            updated_at = now()
        WHERE id = v_sub.id;
    END IF;

    INSERT INTO public.credit_subscription_events (subscription_id, stripe_event_id, type, status, detail, period_end, occurred_at)
    VALUES (v_sub.id, p_event_id, 'invoice.paid', 'granted', p_invoice_id, p_period_end, p_occurred_at);

    RETURN jsonb_build_object('ok', true, 'idempotent', (v_grant->>'idempotent')::BOOLEAN,
        'granted', CASE WHEN (v_grant->>'idempotent')::BOOLEAN THEN 0 ELSE v_sub.credits END,
        'expired', (v_grant->>'expired')::INTEGER, 'balance_after', (v_grant->>'balance_after')::INTEGER,
        'subscription_id', v_sub.id, 'user_id', v_sub.user_id);
END $$;

REVOKE ALL ON FUNCTION public.grant_credit_subscription_invoice(TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_credit_subscription_invoice(TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

-- ── grant_due_yearly_cycles: months 2 to 12, one grant per subscription per call ─
-- A subscription that missed whole months (an outage) is granted the month it is in now: the months
-- already gone would have expired unspent anyway. p_as_of exists so tests can run it "later".
CREATE OR REPLACE FUNCTION public.grant_due_yearly_cycles(
    p_as_of TIMESTAMPTZ DEFAULT now(),
    p_limit INTEGER DEFAULT 200
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    s        public.credit_subscriptions%ROWTYPE;
    v_n      INTEGER;
    v_months INTEGER;
    v_grant  JSONB;
    v_granted INTEGER := 0;
    v_refused INTEGER := 0;
BEGIN
    FOR s IN
        SELECT x.* FROM public.credit_subscriptions x
        WHERE x.cycles_granted BETWEEN 1 AND 11 AND x.status = 'active' AND x.cycle_anchor IS NOT NULL
          AND x.cycle_anchor + make_interval(months => x.cycles_granted) <= p_as_of
        ORDER BY x.cycle_anchor
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
        FOR UPDATE SKIP LOCKED
    LOOP
        -- Whole months elapsed since the anchor; the month now running is number elapsed + 1.
        v_months := (extract(year FROM age(p_as_of, s.cycle_anchor))::INTEGER * 12) + extract(month FROM age(p_as_of, s.cycle_anchor))::INTEGER;
        v_n := LEAST(12, v_months + 1);
        IF v_n <= s.cycles_granted THEN CONTINUE; END IF;
        v_grant := public.subscription_grant(s.user_id, s.credits,
                       s.cycle_anchor + make_interval(months => v_n), s.cycle_key_base || '_c' || v_n);
        IF (v_grant->>'ok')::BOOLEAN IS TRUE THEN
            UPDATE public.credit_subscriptions SET cycles_granted = v_n, updated_at = now() WHERE id = s.id;
            v_granted := v_granted + 1;
        ELSE
            v_refused := v_refused + 1;
            RAISE WARNING 'yearly cycle % of subscription % refused: %', v_n, s.id, v_grant->>'code';
        END IF;
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'granted', v_granted, 'refused', v_refused);
END $$;

REVOKE ALL ON FUNCTION public.grant_due_yearly_cycles(TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_due_yearly_cycles(TIMESTAMPTZ, INTEGER) TO service_role;

-- ── reverse_credit_subscription_invoice: a yearly refund also takes the current month ──
CREATE OR REPLACE FUNCTION public.reverse_credit_subscription_invoice(
    p_stripe_subscription_id TEXT,
    p_invoice_id TEXT,
    p_event_id TEXT,
    p_reason TEXT,
    p_reference TEXT,
    p_occurred_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sub     public.credit_subscriptions%ROWTYPE;
    v_reverse JSONB;
    v_reverse2 JSONB;
    v_taken   INTEGER := 0;
    v_frozen  BOOLEAN := false;
BEGIN
    IF p_event_id IS NULL OR p_event_id !~ '^(evt|cs)_[A-Za-z0-9_]{1,250}$'
       OR p_reason IS NULL OR p_reason NOT IN ('refunded', 'partially_refunded', 'disputed')
       OR p_occurred_at IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT');
    END IF;
    IF p_stripe_subscription_id IS NULL OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9_]{1,250}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SUBSCRIPTION');
    END IF;
    IF p_invoice_id IS NULL OR p_invoice_id !~ '^in_[A-Za-z0-9_]{1,97}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INVOICE');
    END IF;
    SELECT * INTO v_sub FROM public.credit_subscriptions x
    WHERE x.stripe_subscription_id = p_stripe_subscription_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND');
    END IF;
    -- Replay, checked under the row lock so a concurrent duplicate is a no-op.
    IF EXISTS (SELECT 1 FROM public.credit_subscription_events e WHERE e.stripe_event_id = p_event_id) THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true);
    END IF;

    IF p_reason IN ('refunded', 'disputed') THEN
        v_reverse := public.reverse_subscription_grant(v_sub.user_id, p_invoice_id);
        -- An invoice that never granted (a flagged or refused one) has nothing to take.
        IF (v_reverse->>'ok')::BOOLEAN IS TRUE THEN
            v_taken := (v_reverse->>'taken')::INTEGER;
        ELSIF v_reverse->>'code' <> 'GRANT_NOT_FOUND' THEN
            RETURN jsonb_build_object('ok', false, 'code', v_reverse->>'code');
        END IF;
    END IF;

    -- A yearly subscription holds the credits of the month it is in, granted under that month's own key:
    -- take what is left of that month too (the invoice key above found month 1 only).
    IF p_reason IN ('refunded', 'disputed') AND v_sub.cycles_granted > 1 AND v_sub.cycle_key_base IS NOT NULL THEN
        v_reverse2 := public.reverse_subscription_grant(v_sub.user_id, v_sub.cycle_key_base || '_c' || v_sub.cycles_granted);
        IF (v_reverse2->>'ok')::BOOLEAN IS TRUE THEN
            v_taken := v_taken + (v_reverse2->>'taken')::INTEGER;
        ELSIF v_reverse2->>'code' <> 'GRANT_NOT_FOUND' THEN
            RETURN jsonb_build_object('ok', false, 'code', v_reverse2->>'code');
        END IF;
    END IF;

    -- End full refunds atomically, including a reversal ahead of its grant.
    -- Otherwise a racing invoice can grant after a refund before Stripe's
    -- cancellation webhook arrives. Partial refunds remain audit-only.
    IF p_reason IN ('refunded', 'disputed') AND v_sub.status <> 'ended' THEN
        UPDATE public.credit_subscriptions SET
            status = 'ended', ended_at = p_occurred_at,
            end_reason = CASE WHEN p_reason = 'disputed' THEN 'disputed' ELSE 'subscription_ended' END,
            last_event_at = GREATEST(COALESCE(last_event_at, p_occurred_at), p_occurred_at), updated_at = now()
        WHERE id = v_sub.id;
    END IF;

    IF p_reason = 'disputed' THEN
        PERFORM 1 FROM public.credit_balances b WHERE b.user_id = v_sub.user_id FOR UPDATE;
        PERFORM public.freeze_account(v_sub.user_id,
            left(format('Stripe dispute %s on Subscription %s',
                        COALESCE(NULLIF(btrim(p_reference), ''), 'without reference'), p_stripe_subscription_id), 500),
            NULL);
        v_frozen := true;
    END IF;

    INSERT INTO public.credit_subscription_events (subscription_id, stripe_event_id, type, status, detail, period_end, occurred_at)
    VALUES (v_sub.id, p_event_id, 'invoice.' || p_reason, 'reversed', p_invoice_id, NULL, p_occurred_at);

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'subscription_id', v_sub.id, 'user_id', v_sub.user_id,
                              'taken', v_taken, 'frozen', v_frozen);
END $$;


REVOKE ALL ON FUNCTION public.reverse_credit_subscription_invoice(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_credit_subscription_invoice(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
