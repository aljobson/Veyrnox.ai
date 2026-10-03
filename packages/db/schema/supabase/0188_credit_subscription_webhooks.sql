-- ADR-0064: service-only snapshot for webhook routing and invoice validation.
-- The lookup grants no table privileges. Stripe metadata may be removed after
-- checkout; the durable binding remains authoritative for later deliveries.
CREATE OR REPLACE FUNCTION public.read_credit_subscription_binding(p_stripe_subscription_id TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT jsonb_build_object(
        'id', s.id, 'plan_id', s.plan_id, 'price_usd_cents', s.price_usd_cents,
        'credits', s.credits, 'status', s.status,
        'stripe_subscription_id', s.stripe_subscription_id,
        'stripe_customer_id', s.stripe_customer_id)
    FROM public.credit_subscriptions s
    WHERE s.stripe_subscription_id = p_stripe_subscription_id;
$$;
REVOKE ALL ON FUNCTION public.read_credit_subscription_binding(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_credit_subscription_binding(TEXT) TO service_role;

-- A cancellation retry must address the original row even if the user has
-- since bought a replacement. Never pick whichever subscription is newest.
CREATE OR REPLACE FUNCTION public.read_own_credit_subscription_by_id(p_auth_id TEXT, p_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT jsonb_build_object('ok', true, 'subscription', jsonb_build_object(
        'id', s.id, 'plan_id', s.plan_id, 'status', s.status,
        'price_usd_cents', s.price_usd_cents, 'credits', s.credits,
        'current_period_end', s.current_period_end, 'cancel_at_period_end', s.cancel_at_period_end,
        'started_at', s.started_at, 'ended_at', s.ended_at, 'end_reason', s.end_reason,
        'stripe_subscription_id', s.stripe_subscription_id, 'stripe_customer_id', s.stripe_customer_id))
    FROM public.credit_subscriptions s JOIN public.users u ON u.id = s.user_id
    JOIN auth.users a ON a.id::TEXT = u.auth_id
    WHERE s.id = p_id AND u.auth_id = p_auth_id;
$$;
REVOKE ALL ON FUNCTION public.read_own_credit_subscription_by_id(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_own_credit_subscription_by_id(TEXT, UUID) TO service_role;

-- Full refunds must end the binding before a later invoice can grant.
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
