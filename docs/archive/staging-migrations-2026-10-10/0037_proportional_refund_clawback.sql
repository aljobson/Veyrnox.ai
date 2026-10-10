-- Proportional Top-up Refund clawback (ADR-0018 decision 7, ADR-0019).
--
-- A refund, full or partial and whoever issued it, takes back
-- floor(pack credits × refunded / charged) of that Top-up's credits, never
-- taking the balance below zero.
--
-- Stripe reports refunds cumulatively (charge.amount_refunded), so the
-- purchase keeps two running totals:
--   refunded_credits — the share owed back so far (the target, rounded down)
--   reversed_credits — what was actually taken; less than refunded_credits
--                      when the credits had already been spent
-- Each event moves refunded_credits up to its new target and takes only the
-- difference. A replay, or an older event delivered late, has a target at or
-- below the recorded one and changes nothing — which is ADR-0018's "dedupe on
-- order id plus refunded amount". A shortfall is not chased on later refunds:
-- those credits are gone, and later Top-ups are not this Top-up's credits.
--
-- The 2-argument purchase_reverse from 0035 is dropped.
--
-- Idempotent: IF NOT EXISTS, SET DEFAULT/NOT NULL re-run, DROP IF EXISTS,
-- OR REPLACE; REVOKE/GRANT re-run.

ALTER TABLE public.purchases
    ADD COLUMN IF NOT EXISTS refunded_credits INTEGER NOT NULL DEFAULT 0
        CONSTRAINT purchases_refunded_credits_nonneg CHECK (refunded_credits >= 0);

UPDATE public.purchases SET reversed_credits = 0 WHERE reversed_credits IS NULL;
ALTER TABLE public.purchases ALTER COLUMN reversed_credits SET DEFAULT 0;
ALTER TABLE public.purchases ALTER COLUMN reversed_credits SET NOT NULL;

DROP FUNCTION IF EXISTS public.purchase_reverse(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.purchase_reverse(
    p_payment_intent TEXT,
    p_reason TEXT,
    p_amount_refunded BIGINT,
    p_amount BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_p public.purchases%ROWTYPE;
    v_target INTEGER;
    v_owed INTEGER;
    v_debit JSONB;
    v_taken INTEGER;
BEGIN
    IF p_reason NOT IN ('reversal:refund', 'reversal:dispute') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REASON');
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount_refunded IS NULL
       OR p_amount_refunded < 0 OR p_amount_refunded > p_amount THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_AMOUNT');
    END IF;

    SELECT * INTO v_p FROM public.purchases
    WHERE stripe_payment_intent = p_payment_intent FOR UPDATE;
    IF v_p.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PURCHASE_NOT_FOUND');
    END IF;
    IF v_p.state = 'PENDING' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_PAID');
    END IF;

    -- Non-negative integer division rounds down.
    v_target := LEAST(v_p.credits, (v_p.credits::BIGINT * p_amount_refunded / p_amount)::INTEGER);

    IF v_target <= v_p.refunded_credits THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true,
            'refunded_credits', v_p.refunded_credits, 'reversed_credits', v_p.reversed_credits,
            'taken', 0, 'shortfall', 0);
    END IF;

    v_owed := v_target - v_p.refunded_credits;
    v_debit := public.ledger_debit_capped(v_p.user_id, v_owed, p_reason);
    IF (v_debit->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'ledger_debit_capped rejected purchase %: %', v_p.id, v_debit->>'code';
    END IF;
    v_taken := (v_debit->>'debited')::INTEGER;

    UPDATE public.purchases
    SET refunded_credits = v_target,
        reversed_credits = reversed_credits + v_taken,
        state = CASE WHEN v_target = v_p.credits THEN 'REVERSED' ELSE 'PAID' END,
        updated_at = now()
    WHERE id = v_p.id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false,
        'user_id', v_p.user_id,
        'refunded_credits', v_target, 'reversed_credits', v_p.reversed_credits + v_taken,
        'taken', v_taken, 'shortfall', v_owed - v_taken);
END $$;

REVOKE ALL ON FUNCTION public.purchase_reverse(TEXT, TEXT, BIGINT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purchase_reverse(TEXT, TEXT, BIGINT, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.purchase_reverse(TEXT, TEXT, BIGINT, BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_reverse(TEXT, TEXT, BIGINT, BIGINT) TO service_role;
