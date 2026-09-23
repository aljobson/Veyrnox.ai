-- 0098_dispute_reason_provider_neutral.sql
--
-- apply_dispute_event writes the account_actions reason that an auditor reads
-- back when a chargeback is argued. It still says "LemonSqueezy dispute …",
-- written when LemonSqueezy was the processor; Stripe has been the processor
-- since ADR-0031, and the first real dispute (2026-09-23) logged the wrong
-- provider against a Stripe PaymentIntent.
--
-- The processor is not recorded on top_ups, and naming one in the text is what
-- went stale, so the reason is now provider-neutral: the order id already
-- identifies the processor to anyone reading the row.
--
-- Body only. Same signature, so the existing ACL carries over; the grants are
-- restated anyway (CLAUDE.md, Database).

CREATE OR REPLACE FUNCTION public.apply_dispute_event(p_order_id text, p_event text, p_reference text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_top_up public.top_ups%ROWTYPE;
    v_reason TEXT;
    v_already BOOLEAN;
BEGIN
    IF p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9_]{1,64}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ORDER_ID');
    END IF;
    IF p_event IS NULL OR p_event NOT IN ('created', 'resolved') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT');
    END IF;

    SELECT * INTO v_top_up FROM public.top_ups t WHERE t.order_id = p_order_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TOP_UP_NOT_FOUND');
    END IF;

    v_reason := left(format('Card dispute %s on order %s',
                            COALESCE(NULLIF(btrim(p_reference), ''), 'without reference'), p_order_id), 500);

    -- Same lock order as ledger_debit.
    PERFORM 1 FROM public.credit_balances b WHERE b.user_id = v_top_up.user_id FOR UPDATE;

    IF p_event = 'created' THEN
        v_already := public.freeze_account(v_top_up.user_id, v_reason, v_top_up.id);
        RETURN jsonb_build_object('ok', true, 'user_id', v_top_up.user_id, 'top_up_id', v_top_up.id,
                                  'already_frozen', v_already);
    END IF;

    INSERT INTO public.account_actions (user_id, action, actor, reason, top_up_id)
    VALUES (v_top_up.user_id, 'dispute_resolved', 'system', v_reason, v_top_up.id);
    RETURN jsonb_build_object('ok', true, 'user_id', v_top_up.user_id, 'top_up_id', v_top_up.id);
END $function$;

REVOKE ALL ON FUNCTION public.apply_dispute_event(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_dispute_event(text, text, text) TO service_role;
