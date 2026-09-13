-- Inferred Chargeback Freeze counts generation since the Top-up was bought.
-- Applied name: 0066_freeze_since_purchase.
-- Numbered 0066: 0064 (#148) and 0065 (#150) are claimed by open PRs.
--
-- apply_top_up_refund (0062) Froze only when a job was created after
-- top_ups.credited_at. credit_top_up_with_refund (0063) credits a backfilled
-- order and claws its refund back in one transaction, so credited_at is set
-- moments before the check and no job can be later: a buyer who paid,
-- generated and refunded, and whose order_created webhook was lost, was never
-- Frozen. The check now uses top_ups.created_at, when the checkout started,
-- for both the webhook and the backfill. Jobs between starting checkout and
-- the credit now count too; spending before a refund is what the Freeze is for.
--
-- Everything else is 0062's body unchanged. Idempotent: CREATE OR REPLACE.

-- ── apply_top_up_refund: 0062 body, Freeze window from created_at ─────────
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
    v_frozen BOOLEAN := false;
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
        IF EXISTS (SELECT 1 FROM public.top_up_flagged_orders f WHERE f.order_id = p_order_id) THEN
            RETURN jsonb_build_object('ok', true, 'idempotent', false, 'flagged', true, 'taken', 0, 'shortfall', 0,
                                      'frozen', false);
        END IF;
        IF EXISTS (SELECT 1 FROM public.top_ups t WHERE t.id = p_top_up_id AND t.status = 'pending') THEN
            RETURN jsonb_build_object('ok', false, 'code', 'NOT_CREDITED_YET');
        END IF;
        RETURN jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
    END IF;

    -- A replay or an older amount changes nothing, so it can never re-Freeze
    -- an account an Operator has unfrozen.
    IF p_refunded_cents <= v_top_up.refunded_cents THEN
        SELECT b.balance INTO v_balance FROM public.credit_balances b WHERE b.user_id = v_top_up.user_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'top_up_id', v_top_up.id,
                                  'user_id', v_top_up.user_id, 'taken', 0, 'shortfall', 0,
                                  'balance_after', v_balance, 'frozen', false);
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

    -- Chargeback: generated since this Top-up was bought, and the job did not
    -- end in a Credit Refund. "Bought" is the pending row's created_at, not
    -- credited_at: the backfill credits and claws back in one transaction
    -- (0063), so credited_at is always later than every job.
    IF EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.user_id = v_top_up.user_id
          AND j.created_at > v_top_up.created_at
          AND j.state <> 'REFUNDED'
    ) THEN
        PERFORM public.freeze_account(v_top_up.user_id,
            format('Top-up Refund of %s cents on order %s after generating', p_refunded_cents, p_order_id),
            v_top_up.id, v_taken, v_owed - v_taken);
        v_frozen := true;
    END IF;

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'top_up_id', v_top_up.id,
                              'user_id', v_top_up.user_id, 'share', v_share,
                              'taken', v_taken, 'shortfall', v_owed - v_taken,
                              'balance_after', v_balance - v_taken, 'frozen', v_frozen);
END $$;

REVOKE ALL ON FUNCTION public.apply_top_up_refund(TEXT, BIGINT, BIGINT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_top_up_refund(TEXT, BIGINT, BIGINT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.apply_top_up_refund(TEXT, BIGINT, BIGINT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_top_up_refund(TEXT, BIGINT, BIGINT, UUID) TO service_role;
