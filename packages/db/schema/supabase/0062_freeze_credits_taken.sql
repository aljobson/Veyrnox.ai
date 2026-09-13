-- Record the credits an inferred Freeze took back and wrote off (#136, #97).
--
-- Production applied 0059_chargeback_freeze on 2026-09-13 before #136 edited
-- that file in place, so production has account_actions without
-- credits_taken / credits_shortfall and the three-argument freeze_account.
-- A re-edited migration never runs again, so this file carries #136's change
-- to production. On a database built from the current 0059 it changes nothing.
--
-- account_actions   gains credits_taken and credits_shortfall (nullable,
--                   >= 0). The inferred Freeze in apply_top_up_refund writes
--                   both; a dispute Freeze leaves them NULL.
-- freeze_account    now (UUID, TEXT, UUID, INTEGER, INTEGER). The three-argument
--                   version is dropped first: left in place, apply_dispute_event's
--                   three-argument call would be ambiguous ("function is not
--                   unique"). plpgsql binds at call time, so that call resolves
--                   to the new version through its defaults.
-- apply_top_up_refund  current 0059 body: passes taken and shortfall.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP FUNCTION IF EXISTS,
-- CREATE OR REPLACE.

ALTER TABLE public.account_actions ADD COLUMN IF NOT EXISTS credits_taken     INTEGER NULL CHECK (credits_taken >= 0);
ALTER TABLE public.account_actions ADD COLUMN IF NOT EXISTS credits_shortfall INTEGER NULL CHECK (credits_shortfall >= 0);

DROP FUNCTION IF EXISTS public.freeze_account(UUID, TEXT, UUID);

-- ── freeze_account: the shared Freeze. Internal, called by definer functions.
-- The caller must hold the user's credit_balances row lock. p_taken and
-- p_shortfall are set by the inferred Freeze only (NULL for a dispute).
CREATE OR REPLACE FUNCTION public.freeze_account(
    p_user_id UUID,
    p_reason TEXT,
    p_top_up_id UUID,
    p_taken INTEGER DEFAULT NULL,
    p_shortfall INTEGER DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_already BOOLEAN;
BEGIN
    SELECT u.frozen_at IS NOT NULL INTO v_already FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
    IF NOT v_already THEN
        UPDATE public.users SET frozen_at = now() WHERE id = p_user_id;
    END IF;
    INSERT INTO public.account_actions (user_id, action, actor, reason, top_up_id, credits_taken, credits_shortfall)
    VALUES (p_user_id, 'freeze', 'system', p_reason, p_top_up_id, p_taken, p_shortfall);
    RETURN v_already;
END $$;

-- No EXECUTE grant on purpose: apply_top_up_refund and apply_dispute_event call
-- it through the owner's privilege, so all three must keep the same owner.
REVOKE ALL ON FUNCTION public.freeze_account(UUID, TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated, service_role;

-- ── apply_top_up_refund: 0058 body, plus the inferred Chargeback Freeze ───
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

    -- Chargeback: generated since this Top-up was credited, and the job did
    -- not end in a Credit Refund.
    IF EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.user_id = v_top_up.user_id
          AND j.created_at > v_top_up.credited_at
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
