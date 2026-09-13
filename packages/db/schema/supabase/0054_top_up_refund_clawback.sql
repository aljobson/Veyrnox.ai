-- Top-up Refund clawback (#96, ADR-0018 decision 7).
-- Applied name: 0054_top_up_refund_clawback.
-- Numbered 0054: 0052 is credit_top_up (#93) and 0053 is job_submit_rejected (#117).
--
-- When money comes back on a Top-up (an Operator refund in the LemonSqueezy
-- dashboard, or LemonSqueezy's own), a proportional share of that Top-up's
-- Pack Credits is taken back.
--
-- top_ups gains  refunded_cents       cumulative refunded amount last applied,
--                                     in the order currency (USD, #93)
--                clawed_back_credits  credits actually taken back
--
-- apply_top_up_refund(order id, cumulative refunded cents, order total cents)
--
--   share  = floor(credits * refunded / total). LemonSqueezy's refunded_amount
--            is measured against the order total, tax included, so the ratio
--            uses the total, not the pre-tax price.
--   owed   = share now - share at the last applied amount. Only the increase
--            is taken, so successive partial refunds add up to the full share.
--   taken  = LEAST(owed, balance - free_balance). A clawback takes Pack
--            Credits only (ADR-0013): Free Credits and the zero floor are
--            both respected. Whatever can't be taken is reported as
--            `shortfall` and is not collected later from other Top-ups'
--            credits; a refund after spending is a Chargeback (#97).
--
-- A refund can be delivered before order_created has credited the Top-up.
-- Given the Top-up id from the order's custom data, a still-pending Top-up
-- returns NOT_CREDITED_YET so the webhook retries; crediting an already
-- refunded order applies the refund right after (route).
--
-- Replaying an amount already applied, or an older one, is a no-op. The
-- Top-up row is locked first and the balance row second, the same order as
-- credit_top_up, so concurrent deliveries serialise.
--
-- No browser access: service_role only.

ALTER TABLE public.top_ups ADD COLUMN IF NOT EXISTS refunded_cents      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.top_ups ADD COLUMN IF NOT EXISTS clawed_back_credits INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'top_ups_refund_amounts') THEN
        ALTER TABLE public.top_ups ADD CONSTRAINT top_ups_refund_amounts CHECK (
            refunded_cents >= 0 AND clawed_back_credits >= 0 AND clawed_back_credits <= credits
            AND (status = 'credited' OR (refunded_cents = 0 AND clawed_back_credits = 0))
        );
    END IF;
END $$;

-- Returns {ok:true, idempotent, top_up_id, user_id, share, taken, shortfall,
-- balance_after} or {ok:true, flagged:true, taken:0} for a paid order that was
-- flagged and never granted, or {ok:false, code} with code INVALID_ORDER_ID,
-- INVALID_AMOUNT, NOT_CREDITED_YET (retry) or ORDER_NOT_FOUND.
CREATE OR REPLACE FUNCTION public.apply_top_up_refund(
    p_order_id TEXT,
    p_refunded_cents BIGINT,
    p_total_cents BIGINT,
    p_top_up_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_top_up public.top_ups%ROWTYPE;
    v_balance INTEGER;
    v_free INTEGER;
    v_share INTEGER;
    v_owed INTEGER;
    v_taken INTEGER;
BEGIN
    IF p_order_id IS NULL OR p_order_id !~ '^[0-9]{1,20}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ORDER_ID');
    END IF;
    IF p_total_cents IS NULL OR p_total_cents <= 0 OR p_refunded_cents IS NULL
       OR p_refunded_cents < 0 OR p_refunded_cents > p_total_cents OR p_total_cents > 2147483647 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_AMOUNT');
    END IF;

    SELECT * INTO v_top_up FROM public.top_ups t WHERE t.order_id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        -- A flagged order was never granted, so there is nothing to take back.
        IF EXISTS (SELECT 1 FROM public.top_up_flagged_orders f WHERE f.order_id = p_order_id) THEN
            RETURN jsonb_build_object('ok', true, 'idempotent', false, 'flagged', true, 'taken', 0, 'shortfall', 0);
        END IF;
        IF EXISTS (SELECT 1 FROM public.top_ups t WHERE t.id = p_top_up_id AND t.status = 'pending') THEN
            RETURN jsonb_build_object('ok', false, 'code', 'NOT_CREDITED_YET');
        END IF;
        RETURN jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
    END IF;

    IF p_refunded_cents <= v_top_up.refunded_cents THEN
        SELECT b.balance INTO v_balance FROM public.credit_balances b WHERE b.user_id = v_top_up.user_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'top_up_id', v_top_up.id,
                                  'user_id', v_top_up.user_id, 'taken', 0, 'shortfall', 0,
                                  'balance_after', v_balance);
    END IF;

    v_share := (v_top_up.credits::BIGINT * p_refunded_cents / p_total_cents)::INTEGER;
    v_owed := v_share - (v_top_up.credits::BIGINT * v_top_up.refunded_cents / p_total_cents)::INTEGER;

    SELECT b.balance, b.free_balance INTO v_balance, v_free
    FROM public.credit_balances b WHERE b.user_id = v_top_up.user_id FOR UPDATE;
    v_taken := GREATEST(0, LEAST(v_owed, v_balance - v_free));

    IF v_taken > 0 THEN
        INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id)
        VALUES (v_top_up.user_id, -v_taken, 0, 'reverse:topup_refund', NULL);
        UPDATE public.credit_balances
        SET balance = balance - v_taken, updated_at = now()
        WHERE user_id = v_top_up.user_id;
    END IF;

    UPDATE public.top_ups
    SET refunded_cents = p_refunded_cents::INTEGER,
        clawed_back_credits = clawed_back_credits + v_taken
    WHERE id = v_top_up.id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'top_up_id', v_top_up.id,
                              'user_id', v_top_up.user_id, 'share', v_share,
                              'taken', v_taken, 'shortfall', v_owed - v_taken,
                              'balance_after', v_balance - v_taken);
END $$;

REVOKE ALL ON FUNCTION public.apply_top_up_refund(TEXT, BIGINT, BIGINT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_top_up_refund(TEXT, BIGINT, BIGINT, UUID) TO service_role;
