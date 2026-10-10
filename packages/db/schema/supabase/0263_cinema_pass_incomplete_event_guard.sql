-- ADR-0057 / S19: keep paid access when the initial incomplete snapshot arrives late.
-- Forward-only function replacement; no Pass, credit, price or launch-flag changes.
BEGIN;

CREATE OR REPLACE FUNCTION public.apply_cinema_pass_event(
    p_event_id TEXT,
    p_type TEXT,
    p_pass_id UUID,
    p_subscription_id TEXT,
    p_customer_id TEXT,
    p_status TEXT,
    p_period_end TIMESTAMPTZ,
    p_cancel_at_period_end BOOLEAN,
    p_occurred_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pass    public.cinema_passes%ROWTYPE;
    v_event   public.cinema_pass_events%ROWTYPE;
    v_new     TEXT;
    v_flagged BOOLEAN := false;
BEGIN
    IF p_event_id IS NULL OR p_event_id !~ '^(evt|cs)_[A-Za-z0-9_]{1,250}$'
       OR p_type IS NULL OR p_type !~ '^[a-z_.]{1,64}$'
       OR p_status IS NULL OR p_status NOT IN ('active', 'past_due', 'ended', 'incomplete')
       OR p_occurred_at IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT');
    END IF;
    IF p_subscription_id IS NULL OR p_subscription_id !~ '^sub_[A-Za-z0-9_]{1,250}$'
       OR (p_customer_id IS NOT NULL AND p_customer_id !~ '^cus_[A-Za-z0-9_]{1,250}$') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SUBSCRIPTION');
    END IF;

    SELECT * INTO v_event FROM public.cinema_pass_events e WHERE e.stripe_event_id = p_event_id;
    IF FOUND THEN
        -- A replay still reports the Pass's state so the caller can repeat a
        -- side effect it owns (cancelling a flagged subscription at Stripe).
        SELECT x.status INTO v_new FROM public.cinema_passes x WHERE x.id = v_event.pass_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'pass_id', v_event.pass_id,
                                  'status', v_new, 'flagged', v_new = 'flagged');
    END IF;

    SELECT * INTO v_pass FROM public.cinema_passes x WHERE x.stripe_subscription_id = p_subscription_id FOR UPDATE;
    IF FOUND THEN
        IF p_pass_id IS NOT NULL AND p_pass_id <> v_pass.id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'PASS_MISMATCH');
        END IF;
    ELSE
        IF p_pass_id IS NULL THEN
            RETURN jsonb_build_object('ok', false, 'code', 'PASS_NOT_FOUND');
        END IF;
        SELECT * INTO v_pass FROM public.cinema_passes x
        WHERE x.id = p_pass_id AND x.status = 'pending' AND x.stripe_subscription_id IS NULL
        FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('ok', false, 'code', 'PASS_NOT_FOUND');
        END IF;
        UPDATE public.cinema_passes SET stripe_subscription_id = p_subscription_id, updated_at = now()
        WHERE id = v_pass.id;
        v_pass.stripe_subscription_id := p_subscription_id;
    END IF;

    -- Order is Stripe's `created`; a redelivered or out-of-order older event
    -- cannot regress the Pass. Terminal states are never resurrected.
    -- Stripe's initial incomplete snapshot cannot revoke an established Pass,
    -- including when events share a created second or arrive with a later one.
    IF (v_pass.last_event_at IS NOT NULL AND p_occurred_at < v_pass.last_event_at)
       OR v_pass.status IN ('ended', 'flagged')
       OR (p_status = 'incomplete' AND v_pass.status IN ('active', 'past_due')) THEN
        INSERT INTO public.cinema_pass_events (pass_id, stripe_event_id, type, status, period_end, occurred_at)
        VALUES (v_pass.id, p_event_id, p_type, p_status, p_period_end, p_occurred_at);
        RETURN jsonb_build_object('ok', true, 'idempotent', false, 'stale', true, 'pass_id', v_pass.id,
                                  'user_id', v_pass.user_id, 'status', v_pass.status, 'flagged', v_pass.status = 'flagged');
    END IF;

    v_new := CASE p_status WHEN 'incomplete' THEN 'pending' ELSE p_status END;
    IF v_new IN ('active', 'past_due') AND v_pass.status NOT IN ('active', 'past_due') AND EXISTS (
        SELECT 1 FROM public.cinema_passes o
        WHERE o.user_id = v_pass.user_id AND o.id <> v_pass.id AND o.status IN ('active', 'past_due')
    ) THEN
        -- Paid twice while a Pass was live: never entitle, flag for an Operator refund.
        v_new := 'flagged';
        v_flagged := true;
    END IF;

    UPDATE public.cinema_passes SET
        status = v_new,
        stripe_customer_id = COALESCE(p_customer_id, stripe_customer_id),
        current_period_end = COALESCE(p_period_end, current_period_end),
        cancel_at_period_end = COALESCE(p_cancel_at_period_end, cancel_at_period_end),
        started_at = CASE WHEN v_new IN ('active', 'past_due') THEN COALESCE(started_at, p_occurred_at) ELSE started_at END,
        ended_at = CASE WHEN v_new = 'ended' THEN COALESCE(ended_at, p_occurred_at) ELSE ended_at END,
        end_reason = CASE WHEN v_new = 'ended' THEN COALESCE(end_reason, 'subscription_ended')
                          WHEN v_new = 'flagged' THEN 'superseded' ELSE end_reason END,
        last_event_at = p_occurred_at,
        updated_at = now()
    WHERE id = v_pass.id;

    INSERT INTO public.cinema_pass_events (pass_id, stripe_event_id, type, status, period_end, occurred_at)
    VALUES (v_pass.id, p_event_id, p_type, p_status, p_period_end, p_occurred_at);

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'stale', false, 'flagged', v_flagged,
                              'pass_id', v_pass.id, 'user_id', v_pass.user_id, 'status', v_new);
END $$;

REVOKE ALL ON FUNCTION public.apply_cinema_pass_event(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_cinema_pass_event(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ) TO service_role;

COMMIT;
