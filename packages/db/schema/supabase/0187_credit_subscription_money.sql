-- 0187_credit_subscription_money.sql — ADR-0064, IMPLEMENTATION-PLAN C4 (database).
--
-- The functions that move credits for a Subscription (0186): a paid invoice
-- grants one cycle, and money coming back takes the rest of it away.
-- grant_credit_subscription_invoice is the only caller of subscription_grant
-- (0184). Nothing calls these until the webhook ships (behind
-- CREDIT_SUBSCRIPTIONS_ENABLED, off). Additive and idempotent.

-- ── grant_credit_subscription_invoice: a paid invoice becomes one cycle ───
-- The only caller of subscription_grant. p_plan_id is the plan the invoice
-- was for, read from the subscription metadata our Worker signed; a higher
-- tier than the row's plan is an upgrade and moves the row to it. A lower or
-- equal tier is never applied here: those changes start at the period end,
-- when Stripe's own renewal invoice carries the new plan.
--
-- Keyed by the invoice id, here and in the ledger: a granted invoice replays
-- as a no-op, and a refused one may be retried (its Subscription may not have
-- been live yet). Each distinct outcome is recorded once. {ok:true, granted,
-- credits, expired, idempotent, user_id} or {ok:false, code}: INVALID_INVOICE,
-- SUBSCRIPTION_NOT_FOUND, SUBSCRIPTION_NOT_LIVE, PLAN_NOT_FOUND, or the
-- ledger's refusal (PERIOD_NOT_NEWER, GRANT_KEY_REUSED, INVALID_PERIOD_END),
-- which the webhook logs for an Operator and does not treat as granted.
CREATE OR REPLACE FUNCTION public.grant_credit_subscription_invoice(
    p_stripe_subscription_id TEXT,
    p_invoice_id TEXT,
    p_amount_paid_cents INTEGER,
    p_period_end TIMESTAMPTZ,
    p_plan_id TEXT,
    p_occurred_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sub    public.credit_subscriptions%ROWTYPE;
    v_event  public.credit_subscription_events%ROWTYPE;
    v_plan   public.credit_subscription_plans%ROWTYPE;
    v_tier   INTEGER;
    v_grant  JSONB;
    v_code   TEXT;
BEGIN
    IF p_occurred_at IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INVOICE');
    END IF;
    IF p_stripe_subscription_id IS NULL OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9_]{1,250}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND');
    END IF;
    -- A paid invoice has an id, money on it and a period that ends.
    IF p_invoice_id IS NULL OR p_invoice_id !~ '^in_[A-Za-z0-9_]{1,97}$'
       OR p_amount_paid_cents IS NULL OR p_amount_paid_cents <= 0 OR p_period_end IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INVOICE');
    END IF;

    SELECT * INTO v_sub FROM public.credit_subscriptions x
    WHERE x.stripe_subscription_id = p_stripe_subscription_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND');
    END IF;

    SELECT * INTO v_event FROM public.credit_subscription_events e
    WHERE e.invoice_id = p_invoice_id AND e.type = 'invoice.grant' AND e.outcome = 'GRANTED';
    IF FOUND THEN
        IF v_event.subscription_id <> v_sub.id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'GRANT_KEY_REUSED', 'granted', false);
        END IF;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'granted', true, 'credits', v_event.credits,
                                  'expired', 0, 'subscription_id', v_sub.id, 'user_id', v_sub.user_id);
    END IF;

    IF v_sub.status NOT IN ('active', 'past_due') THEN
        v_code := 'SUBSCRIPTION_NOT_LIVE';
    ELSE
        SELECT * INTO v_plan FROM public.credit_subscription_plans p WHERE p.id = COALESCE(p_plan_id, v_sub.plan_id);
        IF NOT FOUND THEN
            v_code := 'PLAN_NOT_FOUND';
        ELSE
            SELECT p.tier INTO v_tier FROM public.credit_subscription_plans p WHERE p.id = v_sub.plan_id;
            -- Only an upgrade changes the plan mid-flight; anything else keeps
            -- the credits this row was sold with.
            IF v_plan.id <> v_sub.plan_id AND v_plan.tier > v_tier THEN
                UPDATE public.credit_subscriptions SET plan_id = v_plan.id, price_usd_cents = v_plan.price_usd_cents,
                    credits_per_cycle = v_plan.credits_per_cycle, updated_at = now()
                WHERE id = v_sub.id;
                v_sub.credits_per_cycle := v_plan.credits_per_cycle;
            END IF;
            v_grant := public.subscription_grant(v_sub.user_id, v_sub.credits_per_cycle, p_period_end, p_invoice_id);
            IF NOT COALESCE((v_grant->>'ok')::BOOLEAN, false) THEN
                v_code := COALESCE(v_grant->>'code', 'GRANT_REFUSED');
            END IF;
        END IF;
    END IF;

    INSERT INTO public.credit_subscription_events
        (subscription_id, type, status, period_end, invoice_id, credits, outcome, occurred_at)
    VALUES (v_sub.id, 'invoice.grant', v_sub.status, p_period_end, p_invoice_id,
            CASE WHEN v_code IS NULL THEN v_sub.credits_per_cycle ELSE 0 END,
            COALESCE(v_code, 'GRANTED'), p_occurred_at)
    ON CONFLICT (invoice_id, outcome) WHERE type = 'invoice.grant' DO NOTHING;

    IF v_code IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', v_code, 'granted', false, 'idempotent', false,
                                  'subscription_id', v_sub.id, 'user_id', v_sub.user_id);
    END IF;
    RETURN jsonb_build_object('ok', true, 'granted', true, 'idempotent', COALESCE((v_grant->>'idempotent')::BOOLEAN, false),
                              'credits', v_sub.credits_per_cycle, 'expired', COALESCE((v_grant->>'expired')::INTEGER, 0),
                              'balance_after', (v_grant->>'balance_after')::INTEGER,
                              'subscription_id', v_sub.id, 'user_id', v_sub.user_id);
END $$;

-- ── revoke_subscription_credits: money came back, so the cycle goes ───────
-- Internal, called by end_credit_subscription under the balance lock. Removes
-- whatever is left in the Subscription bucket; what was already spent is not
-- chased (a dispute Freezes instead).
CREATE OR REPLACE FUNCTION public.revoke_subscription_credits(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sub   INTEGER;
    v_cycle INTEGER;
BEGIN
    SELECT subscription_balance, subscription_cycle INTO v_sub, v_cycle
    FROM public.credit_balances WHERE user_id = p_user_id FOR UPDATE;
    IF v_sub IS NULL OR v_sub <= 0 THEN
        RETURN 0;
    END IF;
    INSERT INTO public.ledger_entries (user_id, delta, free_delta, subscription_delta, subscription_cycle, reason, job_id)
    VALUES (p_user_id, -v_sub, 0, -v_sub, v_cycle, 'expire:subscription', NULL);
    -- The end date moves to now, so a refund of an earlier job cannot return
    -- credits to a cycle that was taken back.
    UPDATE public.credit_balances
    SET balance = balance - v_sub, subscription_balance = 0,
        subscription_expires_at = LEAST(subscription_expires_at, now()), updated_at = now()
    WHERE user_id = p_user_id;
    RETURN v_sub;
END $$;

-- ── end_credit_subscription: money came back ──────────────────────────────
-- 'refunded' ends the Subscription and removes its remaining credits.
-- 'disputed' does the same and Freezes the account (ADR-0019). Idempotent on
-- the event id; a row already ended keeps its first reason.
CREATE OR REPLACE FUNCTION public.end_credit_subscription(
    p_stripe_subscription_id TEXT,
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
    v_frozen  BOOLEAN := false;
    v_revoked INTEGER := 0;
BEGIN
    IF p_event_id IS NULL OR p_event_id !~ '^(evt|cs)_[A-Za-z0-9_]{1,250}$'
       OR p_reason IS NULL OR p_reason NOT IN ('refunded', 'disputed') OR p_occurred_at IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT');
    END IF;
    IF p_stripe_subscription_id IS NULL OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9_]{1,250}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SUBSCRIPTION');
    END IF;
    IF EXISTS (SELECT 1 FROM public.credit_subscription_events e WHERE e.stripe_event_id = p_event_id) THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true);
    END IF;
    SELECT * INTO v_sub FROM public.credit_subscriptions x
    WHERE x.stripe_subscription_id = p_stripe_subscription_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND');
    END IF;

    -- Same lock order as ledger_debit and apply_dispute_event.
    PERFORM 1 FROM public.credit_balances b WHERE b.user_id = v_sub.user_id FOR UPDATE;

    IF v_sub.status <> 'ended' THEN
        UPDATE public.credit_subscriptions SET
            status = 'ended', ended_at = p_occurred_at, end_reason = p_reason,
            last_event_at = GREATEST(COALESCE(last_event_at, p_occurred_at), p_occurred_at), updated_at = now()
        WHERE id = v_sub.id;
    END IF;
    -- Take back what is left of the cycle, unless the credits in the bucket
    -- belong to someone else's payment: a flagged row never granted, and a
    -- refund on an old Subscription must not empty the one now live.
    IF v_sub.status <> 'flagged' AND NOT EXISTS (
        SELECT 1 FROM public.credit_subscriptions o
        WHERE o.user_id = v_sub.user_id AND o.id <> v_sub.id AND o.status IN ('active', 'past_due')) THEN
        v_revoked := public.revoke_subscription_credits(v_sub.user_id);
    END IF;
    INSERT INTO public.credit_subscription_events (subscription_id, stripe_event_id, type, status, credits, outcome, occurred_at)
    VALUES (v_sub.id, p_event_id, 'subscription.' || p_reason, 'ended', v_revoked, 'REVOKED', p_occurred_at);

    IF p_reason = 'disputed' THEN
        PERFORM public.freeze_account(v_sub.user_id,
            left(format('Stripe dispute %s on credit Subscription %s',
                        COALESCE(NULLIF(btrim(p_reference), ''), 'without reference'), p_stripe_subscription_id), 500),
            NULL);
        v_frozen := true;
    END IF;
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'subscription_id', v_sub.id, 'user_id', v_sub.user_id,
                              'revoked', v_revoked, 'frozen', v_frozen);
END $$;

-- ── reconcile_credit_subscriptions: must return zero rows ────────────────
-- Every Subscription grant in the ledger has the logged invoice that caused
-- it, for the same user and the same credits, and every logged grant is in
-- the ledger.
CREATE OR REPLACE FUNCTION public.reconcile_credit_subscriptions()
RETURNS TABLE (problem TEXT, invoice_id TEXT, user_id UUID, credits INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT 'ledger grant without a logged invoice'::TEXT, substr(l.reason, 20), l.user_id, l.delta
    FROM public.ledger_entries l
    WHERE l.reason LIKE 'grant:subscription:%'
      AND NOT EXISTS (
        SELECT 1 FROM public.credit_subscription_events e
        JOIN public.credit_subscriptions s ON s.id = e.subscription_id
        WHERE e.invoice_id = substr(l.reason, 20) AND e.outcome = 'GRANTED'
          AND s.user_id = l.user_id AND e.credits = l.delta)
    UNION ALL
    SELECT 'logged grant missing from the ledger'::TEXT, e.invoice_id, s.user_id, e.credits
    FROM public.credit_subscription_events e
    JOIN public.credit_subscriptions s ON s.id = e.subscription_id
    WHERE e.outcome = 'GRANTED'
      AND NOT EXISTS (
        SELECT 1 FROM public.ledger_entries l
        WHERE l.reason = 'grant:subscription:' || e.invoice_id AND l.reason LIKE 'grant:subscription:%'
          AND l.user_id = s.user_id AND l.delta = e.credits);
$$;

-- ── Grants ──────────────────────────────────────────────────────────────
DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.grant_credit_subscription_invoice(TEXT, TEXT, INTEGER, TIMESTAMPTZ, TEXT, TIMESTAMPTZ)',
        'public.end_credit_subscription(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)',
        'public.reconcile_credit_subscriptions()'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
    -- Internal: only end_credit_subscription calls it.
    REVOKE ALL ON FUNCTION public.revoke_subscription_credits(UUID) FROM PUBLIC, anon, authenticated, service_role;
END $$;

-- ── cron: the nightly reconcile gains a sixth check ─────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN;
    END IF;

    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'veyrnox-reconcile-balances';

    -- Same job name and schedule as 0184; the body gains the sixth check.
    PERFORM cron.schedule(
        'veyrnox-reconcile-balances',
        '17 3 * * *',
        $cmd$ DO $body$ DECLARE n INTEGER; f INTEGER; t INTEGER; u INTEGER; s INTEGER; g INTEGER; BEGIN SELECT count(*) INTO n FROM public.reconcile_balances(); SELECT count(*) INTO f FROM public.reconcile_free_credits(); SELECT count(*) INTO t FROM public.reconcile_top_ups(); SELECT count(*) INTO u FROM public.reconcile_failed_refunds(); SELECT count(*) INTO s FROM public.reconcile_subscription_credits(); SELECT count(*) INTO g FROM public.reconcile_credit_subscriptions(); IF n > 0 OR f > 0 OR t > 0 OR u > 0 OR s > 0 OR g > 0 THEN RAISE EXCEPTION 'ledger reconcile drift: % balance, % free-credit users, % top-up problems, % unpaid failures, % subscription-credit users, % subscription grants', n, f, t, u, s, g; END IF; END $body$; $cmd$
    );
END $$;
