-- 0187_credit_subscription_money.sql — ADR-0064 (IMPLEMENTATION-PLAN C4):
-- where a Subscription (0186) meets the ledger (0183, 0184).
--
--   reverse_subscription_grant              ledger: take back what is left of
--                                           one invoice's cycle.
--   grant_credit_subscription_invoice       a paid invoice grants its cycle.
--   reverse_credit_subscription_invoice     a refund or a dispute on one.
--   cancel_credit_subscription_cooling_off  the 14-day cancellation.
--
-- Owner decisions, 2026-10-03: a refund removes that cycle's remaining
-- Subscription Credits and nothing else; a dispute does the same and Freezes
-- the account; the cooling-off refund is full, and only while none of that
-- cycle's credits have been spent.
--
-- Lock order in every function here: the subscription row, then the balance
-- row, as apply_dispute_event and the Cinema Pass do. Nothing calls these
-- until the webhook and routes ship behind SUBSCRIPTIONS_ENABLED (off).
-- Idempotent: CREATE OR REPLACE only.

-- ── reverse_subscription_grant: the ledger side of a refund ───────────────
-- Removes the Subscription Credits still unspent from the cycle that
-- p_grant_key (the paid invoice) granted, and ends that cycle now, so a later
-- Credit Refund of something it paid for is returned and expired in one call
-- (ledger_refund, 0183) and cannot put the credits back. A cycle that has
-- already been replaced or swept has nothing to take: {ok:true, taken:0}.
-- Pack and Free Credits are never touched.
CREATE OR REPLACE FUNCTION public.reverse_subscription_grant(
    p_user_id UUID,
    p_grant_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reason      TEXT;
    v_balance     INTEGER;
    v_sub         INTEGER;
    v_cycle       INTEGER;
    v_grant_cycle INTEGER;
    v_spendable   INTEGER;
BEGIN
    IF p_grant_key IS NULL OR p_grant_key !~ '^[A-Za-z0-9_]{1,100}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_GRANT_KEY');
    END IF;
    v_reason := 'grant:subscription:' || p_grant_key;

    -- Same lock as every other money function.
    SELECT balance, subscription_balance, subscription_cycle INTO v_balance, v_sub, v_cycle
    FROM public.credit_balances WHERE user_id = p_user_id FOR UPDATE;
    IF v_balance IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW');
    END IF;

    -- The second condition restates the partial index's predicate (0184).
    SELECT l.subscription_cycle INTO v_grant_cycle FROM public.ledger_entries l
    WHERE l.reason = v_reason AND l.reason LIKE 'grant:subscription:%' AND l.user_id = p_user_id;
    IF v_grant_cycle IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'GRANT_NOT_FOUND');
    END IF;

    IF v_grant_cycle <> v_cycle OR v_sub <= 0 THEN
        -- The cycle is the current one but empty: still end it, so nothing
        -- refunded later can land back in it.
        IF v_grant_cycle = v_cycle THEN
            UPDATE public.credit_balances
            SET subscription_expires_at = LEAST(subscription_expires_at, now()), updated_at = now()
            WHERE user_id = p_user_id;
        END IF;
        SELECT balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
        INTO v_spendable FROM public.credit_balances WHERE user_id = p_user_id;
        RETURN jsonb_build_object('ok', true, 'taken', 0, 'balance_after', v_spendable);
    END IF;

    INSERT INTO public.ledger_entries (user_id, delta, free_delta, subscription_delta, subscription_cycle, reason, job_id)
    VALUES (p_user_id, -v_sub, 0, -v_sub, v_cycle, 'reverse:subscription_refund', NULL);

    UPDATE public.credit_balances
    SET balance = balance - v_sub, subscription_balance = 0,
        subscription_expires_at = LEAST(subscription_expires_at, now()), updated_at = now()
    WHERE user_id = p_user_id
    RETURNING balance INTO v_spendable;

    RETURN jsonb_build_object('ok', true, 'taken', v_sub, 'balance_after', v_spendable);
END $$;

-- ── grant_credit_subscription_invoice: a paid invoice grants its cycle ────
-- The caller has re-read the invoice from Stripe and found it paid.
-- p_period_end is the end of the period that invoice paid for. The grant is
-- keyed by the invoice id (subscription_grant, 0184), so two events for one
-- invoice grant once. Returns {ok:true, idempotent, granted, expired,
-- balance_after, user_id} or {ok:false, code}:
--   SUBSCRIPTION_NOT_FOUND / SUBSCRIPTION_NOT_READY  the binding event has not
--     arrived yet; nothing is recorded and the caller must let Stripe retry.
--   anything else with refused:true  recorded in the event log for an
--     Operator; a retry cannot change it (ADR-0064, "Plan changes").
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
    v_sub   public.credit_subscriptions%ROWTYPE;
    v_event public.credit_subscription_events%ROWTYPE;
    v_grant JSONB;
    v_code  TEXT;
BEGIN
    IF p_event_id IS NULL OR p_event_id !~ '^(evt|cs)_[A-Za-z0-9_]{1,250}$' OR p_occurred_at IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT');
    END IF;
    IF p_stripe_subscription_id IS NULL OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9_]{1,250}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SUBSCRIPTION');
    END IF;
    -- 97 characters after "in_": the grant key holds 100.
    IF p_invoice_id IS NULL OR p_invoice_id !~ '^in_[A-Za-z0-9_]{1,97}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INVOICE');
    END IF;

    SELECT * INTO v_event FROM public.credit_subscription_events e WHERE e.stripe_event_id = p_event_id;
    IF FOUND THEN
        IF v_event.status = 'refused' THEN
            RETURN jsonb_build_object('ok', false, 'code', COALESCE(v_event.detail, 'REFUSED'),
                                      'refused', true, 'idempotent', true);
        END IF;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'granted', 0);
    END IF;

    SELECT * INTO v_sub FROM public.credit_subscriptions x
    WHERE x.stripe_subscription_id = p_stripe_subscription_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND');
    END IF;
    IF v_sub.status = 'pending' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_READY');
    END IF;

    v_code := CASE
        WHEN v_sub.status NOT IN ('active', 'past_due') THEN 'SUBSCRIPTION_NOT_LIVE'
        WHEN p_paid_cents IS NULL OR p_paid_cents <= 0 THEN 'INVOICE_NOT_PAID'
        ELSE NULL END;
    IF v_code IS NULL THEN
        v_grant := public.subscription_grant(v_sub.user_id, v_sub.credits, p_period_end, p_invoice_id);
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

    INSERT INTO public.credit_subscription_events (subscription_id, stripe_event_id, type, status, detail, period_end, occurred_at)
    VALUES (v_sub.id, p_event_id, 'invoice.paid', 'granted', p_invoice_id, p_period_end, p_occurred_at);

    RETURN jsonb_build_object('ok', true, 'idempotent', (v_grant->>'idempotent')::BOOLEAN,
        'granted', CASE WHEN (v_grant->>'idempotent')::BOOLEAN THEN 0 ELSE v_sub.credits END,
        'expired', (v_grant->>'expired')::INTEGER, 'balance_after', (v_grant->>'balance_after')::INTEGER,
        'subscription_id', v_sub.id, 'user_id', v_sub.user_id);
END $$;

-- ── reverse_credit_subscription_invoice: money came back ──────────────────
-- p_reason:
--   refunded            the whole charge was refunded: that cycle's remaining
--                       credits go. The subscription's status is left to the
--                       Stripe events, so one that keeps renewing keeps working.
--   partially_refunded  recorded only.
--   disputed            as refunded, and the subscription ends and the account
--                       is Frozen (ADR-0019: a dispute is a Chargeback whatever
--                       it is on). The caller stops the billing at Stripe.
-- Idempotent on the event id.
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
    IF EXISTS (SELECT 1 FROM public.credit_subscription_events e WHERE e.stripe_event_id = p_event_id) THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true);
    END IF;
    SELECT * INTO v_sub FROM public.credit_subscriptions x
    WHERE x.stripe_subscription_id = p_stripe_subscription_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND');
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

    IF p_reason = 'disputed' THEN
        IF v_sub.status <> 'ended' THEN
            UPDATE public.credit_subscriptions SET
                status = 'ended', ended_at = p_occurred_at, end_reason = 'disputed',
                last_event_at = GREATEST(COALESCE(last_event_at, p_occurred_at), p_occurred_at), updated_at = now()
            WHERE id = v_sub.id;
        END IF;
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

-- ── cancel_credit_subscription_cooling_off: the 14-day cancellation ───────
-- Allowed within 14 days of the subscription starting, and only while every
-- credit of the cycle is still there. The credits are removed and the row
-- ended HERE, before any money moves: the caller then cancels at Stripe and
-- refunds the invoice this returns. A repeat call returns the same ids, so a
-- Stripe call that failed can be tried again. Codes: SUBSCRIPTION_NOT_FOUND,
-- SUBSCRIPTION_NOT_LIVE, COOLING_OFF_OVER, CREDITS_SPENT.
CREATE OR REPLACE FUNCTION public.cancel_credit_subscription_cooling_off(p_auth_id TEXT, p_subscription_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sub     public.credit_subscriptions%ROWTYPE;
    v_bal     INTEGER;
    v_cycle   INTEGER;
    v_expires TIMESTAMPTZ;
    v_granted INTEGER;
    v_key     TEXT;
    v_reverse JSONB;
BEGIN
    SELECT x.* INTO v_sub FROM public.credit_subscriptions x JOIN public.users u ON u.id = x.user_id
    WHERE x.id = p_subscription_id AND u.auth_id = p_auth_id
    FOR UPDATE OF x;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND');
    END IF;
    IF v_sub.status = 'ended' AND v_sub.end_reason = 'cancelled_cooling_off' THEN
        SELECT e.detail INTO v_key FROM public.credit_subscription_events e
        WHERE e.subscription_id = v_sub.id AND e.status = 'granted' ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT 1;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'status', 'ended',
            'stripe_subscription_id', v_sub.stripe_subscription_id, 'invoice_id', v_key);
    END IF;
    IF v_sub.status NOT IN ('active', 'past_due') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_LIVE');
    END IF;
    IF v_sub.started_at IS NULL OR now() >= v_sub.started_at + interval '14 days' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'COOLING_OFF_OVER');
    END IF;

    SELECT subscription_balance, subscription_cycle, subscription_expires_at INTO v_bal, v_cycle, v_expires
    FROM public.credit_balances WHERE user_id = v_sub.user_id FOR UPDATE;
    -- The grant that opened the cycle the balance holds now.
    SELECT l.delta, substr(l.reason, length('grant:subscription:') + 1) INTO v_granted, v_key
    FROM public.ledger_entries l
    WHERE l.user_id = v_sub.user_id AND l.reason LIKE 'grant:subscription:%' AND l.subscription_cycle = v_cycle;
    IF v_granted IS NULL OR v_expires IS NULL OR v_expires <= now() OR v_bal <> v_granted THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CREDITS_SPENT');
    END IF;

    v_reverse := public.reverse_subscription_grant(v_sub.user_id, v_key);
    IF (v_reverse->>'ok')::BOOLEAN IS NOT TRUE THEN
        RETURN jsonb_build_object('ok', false, 'code', v_reverse->>'code');
    END IF;

    UPDATE public.credit_subscriptions SET
        status = 'ended', ended_at = now(), end_reason = 'cancelled_cooling_off',
        cancel_at_period_end = true, updated_at = now()
    WHERE id = v_sub.id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'status', 'ended',
        'taken', (v_reverse->>'taken')::INTEGER,
        'stripe_subscription_id', v_sub.stripe_subscription_id, 'invoice_id', v_key);
END $$;

-- ── grants ────────────────────────────────────────────────────────────────
DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.reverse_subscription_grant(UUID, TEXT)',
        'public.grant_credit_subscription_invoice(TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ)',
        'public.reverse_credit_subscription_invoice(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)',
        'public.cancel_credit_subscription_cooling_off(TEXT, UUID)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
