-- Staging only. Removes everything the unmerged Stripe branch (#108) applied
-- as 0035_stripe_credit_packs .. 0041_dispute_opened_freeze, so staging
-- matches main plus nothing else before #109/#111 are applied here. Restores
-- ledger_debit to its 0030 body (no freeze check).

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.purchases) OR EXISTS (SELECT 1 FROM public.account_freezes) THEN
        RAISE EXCEPTION 'refusing to revert: purchases or account_freezes hold rows';
    END IF;
END $$;

DROP FUNCTION IF EXISTS public.purchase_dispute_opened(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.operator_unfreeze(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.purchase_reverse(TEXT, TEXT, BIGINT, BIGINT);
DROP FUNCTION IF EXISTS public.purchase_fulfil(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.purchase_create(TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ledger_debit_capped(UUID, INTEGER, TEXT);

DROP TRIGGER IF EXISTS credit_packs_enforce_floors ON public.credit_packs;
DROP TRIGGER IF EXISTS sales_channels_enforce_floors ON public.sales_channels;
DROP FUNCTION IF EXISTS public.credit_packs_enforce_floors();
DROP FUNCTION IF EXISTS public.sales_channels_enforce_floors();
DROP FUNCTION IF EXISTS public.credit_pack_floor_violation(INTEGER, INTEGER, TEXT, INTEGER, INTEGER);

DROP TABLE IF EXISTS public.account_freezes;
DROP TABLE IF EXISTS public.purchases;
DROP TABLE IF EXISTS public.credit_packs;
DROP TABLE IF EXISTS public.sales_channels;

-- ledger_debit exactly as 0030_debit_rate_limit_reconcile_alert_catalog_watch.
CREATE OR REPLACE FUNCTION public.ledger_debit(
    p_user_id UUID,
    p_idempotency_key TEXT,
    p_credits INTEGER,
    p_reason TEXT,
    p_model_id TEXT,
    p_inputs JSONB,
    p_limit_per_window INTEGER DEFAULT 0,
    p_window_seconds INTEGER DEFAULT 60
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing UUID;
    v_current_balance INTEGER;
    v_new_job_id UUID;
    v_count INTEGER;
    v_reset_seconds INTEGER;
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS',
                                   'message', format('credits must be a positive integer (got %s)', p_credits));
    END IF;

    -- Row-lock the balance first: serialises concurrent debits, and makes
    -- both the idempotency probe and the window count race-free per user.
    SELECT balance INTO v_current_balance FROM public.credit_balances
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF v_current_balance IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW',
                                   'message', format('no credit_balances row for user %s', p_user_id));
    END IF;

    SELECT id INTO v_existing FROM public.jobs
    WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'job_id', v_existing,
                                   'idempotent', true, 'balance_after', v_current_balance);
    END IF;

    -- Authoritative sliding-window rate limit, under the same lock as the
    -- insert it guards. A replay (above) is never counted twice.
    IF p_limit_per_window IS NOT NULL AND p_limit_per_window > 0 THEN
        SELECT count(*) INTO v_count FROM public.jobs
        WHERE user_id = p_user_id
          AND created_at > now() - make_interval(secs => p_window_seconds);
        IF v_count >= p_limit_per_window THEN
            SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
                MIN(created_at) + make_interval(secs => p_window_seconds) - now()
            ))))::int INTO v_reset_seconds
            FROM public.jobs
            WHERE user_id = p_user_id
              AND created_at > now() - make_interval(secs => p_window_seconds);
            RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
                                       'count', v_count, 'limit', p_limit_per_window,
                                       'retry_after_seconds', COALESCE(v_reset_seconds, p_window_seconds));
        END IF;
    END IF;

    IF v_current_balance < p_credits THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_BALANCE',
                                   'message', format('insufficient balance: have %s, need %s', v_current_balance, p_credits),
                                   'balance', v_current_balance);
    END IF;

    BEGIN
        INSERT INTO public.jobs (user_id, idempotency_key, model_id, credits, inputs, state)
        VALUES (p_user_id, p_idempotency_key, p_model_id, p_credits, p_inputs, 'DEBITED')
        RETURNING id INTO v_new_job_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_existing FROM public.jobs
        WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
        RETURN jsonb_build_object('ok', true, 'job_id', v_existing,
                                   'idempotent', true, 'balance_after', v_current_balance);
    END;

    INSERT INTO public.ledger_entries (user_id, delta, reason, job_id)
    VALUES (p_user_id, -p_credits, p_reason, v_new_job_id);

    UPDATE public.credit_balances
    SET balance = balance - p_credits, updated_at = now()
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object('ok', true, 'job_id', v_new_job_id,
                               'idempotent', false, 'balance_after', v_current_balance - p_credits);
END $$;

REVOKE ALL ON FUNCTION public.ledger_debit(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ledger_debit(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.ledger_debit(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_debit(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB, INTEGER, INTEGER) TO service_role;
