-- Generation hold for a standing strike (ADR-0083, with 0271).
--
-- The two admission functions from 0240, unchanged except for one check after
-- the Freeze: while users.hold_until is in the future the debit is refused
-- with ACCOUNT_ON_HOLD and the time the hold ends. Every paid or free
-- generation enters through these two (ledger_debit, submit_free_job,
-- admit_fal_dispatch), so the hold binds everywhere without touching the
-- routes. Buying credits, the Library and the account page are unaffected.
--
-- Idempotent: OR REPLACE, REVOKE re-run. The public wrappers in 0240 keep
-- calling these signatures.

CREATE OR REPLACE FUNCTION private.ledger_debit_for_admission(
    p_user_id UUID,
    p_idempotency_key TEXT,
    p_credits INTEGER,
    p_reason TEXT,
    p_model_id TEXT,
    p_inputs JSONB,
    p_limit_per_window INTEGER DEFAULT 0,
    p_window_seconds INTEGER DEFAULT 60,
    p_reserved BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing UUID;
    v_current_balance INTEGER;
    v_free_balance INTEGER;
    v_free_part INTEGER;
    v_sub_balance INTEGER;
    v_sub_expires TIMESTAMPTZ;
    v_sub_cycle INTEGER;
    v_sub_live INTEGER;
    v_sub_part INTEGER;
    v_spendable INTEGER;
    v_new_job_id UUID;
    v_count INTEGER;
    v_reset_seconds INTEGER;
    v_hold_until TIMESTAMPTZ;
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS',
                                   'message', format('credits must be a positive integer (got %s)', p_credits));
    END IF;

    SELECT balance, free_balance, subscription_balance, subscription_expires_at, subscription_cycle
    INTO v_current_balance, v_free_balance, v_sub_balance, v_sub_expires, v_sub_cycle
    FROM public.credit_balances
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF v_current_balance IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW',
                                   'message', format('no credit_balances row for user %s', p_user_id));
    END IF;

    -- Subscription Credits past their cycle end are not spendable; the sweep
    -- removes them. Everything below works on what can actually be spent.
    v_sub_live := CASE WHEN v_sub_expires > now() THEN v_sub_balance ELSE 0 END;
    v_spendable := v_current_balance - (v_sub_balance - v_sub_live);

    SELECT id INTO v_existing FROM public.jobs
    WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'job_id', v_existing,
                                   'idempotent', true, 'balance_after', v_spendable);
    END IF;

    -- Under the balance lock every Freeze also takes, so none races this.
    IF private.fal_admission_paused(p_model_id,p_reserved) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_ADMISSION_PAUSED', 'retry_after_seconds', 60);
    END IF;

    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.frozen_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;
    -- A standing strike's hold (0271): generation waits, buying and the Library do not.
    SELECT u.hold_until INTO v_hold_until FROM public.users u WHERE u.id = p_user_id AND u.hold_until > now();
    IF v_hold_until IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_ON_HOLD', 'hold_until', v_hold_until);
    END IF;

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

    IF v_spendable < p_credits THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_BALANCE',
                                   'message', format('insufficient balance: have %s, need %s', v_spendable, p_credits),
                                   'balance', v_spendable);
    END IF;

    BEGIN
        INSERT INTO public.jobs (user_id, idempotency_key, model_id, credits, inputs, state)
        VALUES (p_user_id, p_idempotency_key, p_model_id, p_credits, p_inputs, 'DEBITED')
        RETURNING id INTO v_new_job_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_existing FROM public.jobs
        WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
        RETURN jsonb_build_object('ok', true, 'job_id', v_existing,
                                   'idempotent', true, 'balance_after', v_spendable);
    END;

    -- ADR-0064 spend order: Subscription, then Free, then Pack.
    v_sub_part := LEAST(v_sub_live, p_credits);
    v_free_part := LEAST(v_free_balance, p_credits - v_sub_part);

    INSERT INTO public.ledger_entries (user_id, delta, free_delta, subscription_delta, subscription_cycle, reason, job_id)
    VALUES (p_user_id, -p_credits, -v_free_part, -v_sub_part,
            CASE WHEN v_sub_part > 0 THEN v_sub_cycle END, p_reason, v_new_job_id);

    UPDATE public.credit_balances
    SET balance = balance - p_credits, free_balance = free_balance - v_free_part,
        subscription_balance = subscription_balance - v_sub_part, updated_at = now()
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object('ok', true, 'job_id', v_new_job_id,
                               'idempotent', false, 'balance_after', v_spendable - p_credits);
END $$;

REVOKE ALL ON FUNCTION private.ledger_debit_for_admission(UUID,TEXT,INTEGER,TEXT,TEXT,JSONB,INTEGER,INTEGER,BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.submit_free_job_for_admission(
    p_user_id UUID,
    p_idempotency_key TEXT,
    p_model_id TEXT,
    p_inputs JSONB,
    p_limit_per_window INTEGER DEFAULT 0,
    p_window_seconds INTEGER DEFAULT 60,
    p_reserved BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_balance INTEGER;
    v_existing UUID;
    v_count INTEGER;
    v_reset_seconds INTEGER;
    v_take JSONB;
    v_new_job_id UUID;
    v_hold_until TIMESTAMPTZ;
BEGIN
    -- The same balance lock ledger_debit and every Freeze take, in the same order (balance first, then the
    -- allowance's per-model advisory lock inside free_allowance_take).
    SELECT balance INTO v_balance FROM public.credit_balances WHERE user_id = p_user_id FOR UPDATE;
    IF v_balance IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW');
    END IF;

    SELECT id INTO v_existing FROM public.jobs WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'taken', true, 'job_id', v_existing, 'idempotent', true);
    END IF;

    IF private.fal_admission_paused(p_model_id,p_reserved) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_ADMISSION_PAUSED', 'retry_after_seconds', 60);
    END IF;

    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.frozen_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;
    -- A standing strike's hold (0271): generation waits, buying and the Library do not.
    SELECT u.hold_until INTO v_hold_until FROM public.users u WHERE u.id = p_user_id AND u.hold_until > now();
    IF v_hold_until IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_ON_HOLD', 'hold_until', v_hold_until);
    END IF;

    IF p_limit_per_window IS NOT NULL AND p_limit_per_window > 0 THEN
        SELECT count(*) INTO v_count FROM public.jobs
        WHERE user_id = p_user_id AND created_at > now() - make_interval(secs => p_window_seconds);
        IF v_count >= p_limit_per_window THEN
            SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
                MIN(created_at) + make_interval(secs => p_window_seconds) - now()
            ))))::int INTO v_reset_seconds
            FROM public.jobs
            WHERE user_id = p_user_id AND created_at > now() - make_interval(secs => p_window_seconds);
            RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
                                       'count', v_count, 'limit', p_limit_per_window,
                                       'retry_after_seconds', COALESCE(v_reset_seconds, p_window_seconds));
        END IF;
    END IF;

    v_take := public.free_allowance_take(p_user_id, p_model_id, p_idempotency_key);
    IF v_take->>'ok' <> 'true' THEN
        RETURN v_take;
    END IF;
    IF v_take->>'taken' <> 'true' THEN
        -- No allowance left (or none offered): write nothing, the caller prices it normally.
        RETURN jsonb_build_object('ok', true, 'taken', false, 'code', v_take->>'code');
    END IF;

    INSERT INTO public.jobs (user_id, idempotency_key, model_id, credits, inputs, state, free_allowance)
    VALUES (p_user_id, p_idempotency_key, p_model_id, 0, p_inputs, 'DEBITED', true)
    RETURNING id INTO v_new_job_id;

    RETURN jsonb_build_object('ok', true, 'taken', true, 'job_id', v_new_job_id, 'idempotent', false,
                               'left', v_take->'left');
END $$;

REVOKE ALL ON FUNCTION private.submit_free_job_for_admission(UUID,TEXT,TEXT,JSONB,INTEGER,INTEGER,BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
