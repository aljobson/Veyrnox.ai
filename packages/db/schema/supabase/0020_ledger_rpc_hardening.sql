-- Security audit 2026-09-11, L4 + L5.
--
-- ledger_refund trusted every argument: no check that the job belongs to
-- p_user_id, that p_credits <= jobs.credits, or that the job is not already
-- a terminal success; and the one-refund-per-job probe ran without a lock,
-- so two concurrent callers could both insert. Lock the job row first and
-- validate against it.
--
-- ledger_debit probed the idempotency key before taking the balance lock, so
-- two concurrent submits with the same key raced to the UNIQUE constraint
-- and the loser surfaced as an exception (502 to the client) instead of the
-- documented idempotent no-op. Catch unique_violation and return the winner.
--
-- Idempotent: CREATE OR REPLACE with the same signatures.

CREATE OR REPLACE FUNCTION public.ledger_refund(
    p_job_id UUID,
    p_user_id UUID,
    p_credits INTEGER,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job public.jobs%ROWTYPE;
    v_existing UUID;
    v_entry_id UUID;
    v_new_balance INTEGER;
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS',
                                   'message', format('refund credits must be a positive integer (got %s)', p_credits));
    END IF;

    -- Lock the job row: serialises concurrent refunds and pins the facts
    -- we validate against.
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
    IF v_job.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND');
    END IF;
    IF v_job.user_id <> p_user_id THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_MISMATCH');
    END IF;
    IF p_credits > v_job.credits THEN
        RETURN jsonb_build_object('ok', false, 'code', 'REFUND_EXCEEDS_DEBIT',
                                   'message', format('refund %s exceeds job credits %s', p_credits, v_job.credits));
    END IF;
    IF v_job.state IN ('SUCCEEDED', 'STORED') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_SUCCEEDED');
    END IF;

    -- Idempotency: one refund per job (now under the job row lock).
    SELECT id INTO v_existing FROM public.ledger_entries
    WHERE job_id = p_job_id AND delta > 0 AND reason LIKE 'refund:%';
    IF v_existing IS NOT NULL THEN
        SELECT balance INTO v_new_balance FROM public.credit_balances
        WHERE user_id = p_user_id;
        RETURN jsonb_build_object('ok', true, 'entry_id', v_existing,
                                   'idempotent', true, 'balance_after', v_new_balance);
    END IF;

    INSERT INTO public.ledger_entries (user_id, delta, reason, job_id)
    VALUES (p_user_id, p_credits, p_reason, p_job_id)
    RETURNING id INTO v_entry_id;

    UPDATE public.credit_balances
    SET balance = balance + p_credits, updated_at = now()
    WHERE user_id = p_user_id
    RETURNING balance INTO v_new_balance;

    UPDATE public.jobs
    SET state = 'REFUNDED', updated_at = now()
    WHERE id = p_job_id AND state IN ('DEBITED', 'SUBMITTED', 'FAILOVER', 'FAILED');

    RETURN jsonb_build_object('ok', true, 'entry_id', v_entry_id,
                               'idempotent', false, 'balance_after', v_new_balance);
END $$;

CREATE OR REPLACE FUNCTION public.ledger_debit(
    p_user_id UUID,
    p_idempotency_key TEXT,
    p_credits INTEGER,
    p_reason TEXT,
    p_model_id TEXT,
    p_inputs JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing UUID;
    v_current_balance INTEGER;
    v_new_job_id UUID;
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS',
                                   'message', format('credits must be a positive integer (got %s)', p_credits));
    END IF;

    -- Row-lock the balance first: serialises concurrent debits AND makes
    -- the idempotency probe below race-free for the same user.
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
        -- Lost a race we could not see (different session, same key).
        -- Return the winner as an idempotent replay; no money moved here.
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

DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.ledger_refund(UUID, UUID, INTEGER, TEXT)',
        'public.ledger_debit(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
