-- Free-allowance jobs (ADR-0069 step 2, audit docs/product/free-allowance-audit-2026-10-05.md).
-- A job that took a free allowance is created at 0 Credits with NO ledger row, so:
--   1. jobs.free_allowance marks it and the credits check allows 0 only for such a job;
--   2. submit_free_job creates it, taking the allowance in the same transaction. It is a parallel path to
--      ledger_debit, which is left alone: when no allowance is left it returns taken=false and writes nothing,
--      and the caller falls back to ledger_debit at the catalog price;
--   3. ledger_refund (the one choke point every failure path, webhook and sweeper already calls) accepts a zero
--      refund for a free job and returns the allowance instead. A paid job with a zero refund is still refused,
--      and a free job asked to refund more than 0 is still REFUND_EXCEEDS_DEBIT. Every other branch is the 0183 body.
-- Nothing in the app calls submit_free_job yet and every catalog allowance is 0. Apply only through the
-- owner-approved workflow, after 0204 and 0205.
--
-- Idempotent: IF NOT EXISTS, OR REPLACE, explicit revokes naming each full signature.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS free_allowance BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_credits_check;
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_credits_or_free_check;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_credits_or_free_check CHECK (credits > 0 OR free_allowance);

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
    v_free_part INTEGER;
    v_sub_part INTEGER;
    v_sub_live INTEGER;
    v_sub_stale INTEGER;
    v_sub_cycle INTEGER;
    v_sub_expires TIMESTAMPTZ;
    v_returned BOOLEAN;
BEGIN
    -- Zero is allowed only for a job that took a free allowance (checked below); a paid job still needs > 0.
    IF p_credits IS NULL OR p_credits < 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS',
                                   'message', format('refund credits must be a positive integer (got %s)', p_credits));
    END IF;

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

    -- A free-allowance job (ADR-0069) owes no Credits: give the allowance back, write no ledger row.
    IF p_credits = 0 THEN
        IF NOT v_job.free_allowance THEN
            RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS',
                                       'message', 'refund credits must be a positive integer (got 0)');
        END IF;
        v_returned := (public.free_allowance_return(p_user_id, v_job.idempotency_key)->>'returned')::boolean;
        UPDATE public.jobs
        SET state = 'REFUNDED', updated_at = now()
        WHERE id = p_job_id AND state IN ('DEBITED', 'SUBMITTED', 'FAILOVER', 'FAILED');
        SELECT balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
        INTO v_new_balance FROM public.credit_balances WHERE user_id = p_user_id;
        RETURN jsonb_build_object('ok', true, 'entry_id', NULL, 'idempotent', NOT v_returned,
                                   'allowance_returned', true, 'balance_after', v_new_balance);
    END IF;

    SELECT id INTO v_existing FROM public.ledger_entries
    WHERE job_id = p_job_id AND delta > 0 AND reason LIKE 'refund:%';
    IF v_existing IS NOT NULL THEN
        SELECT balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
        INTO v_new_balance FROM public.credit_balances
        WHERE user_id = p_user_id;
        RETURN jsonb_build_object('ok', true, 'entry_id', v_existing,
                                   'idempotent', true, 'balance_after', v_new_balance);
    END IF;

    -- The Free Credits this job's debit took (legacy debits: all of it).
    -- A partial refund returns Free Credits first, up to that amount.
    -- Lock the balance before reading the cycle (the predecessor took this
    -- lock at its UPDATE; job first, then balance, as before).
    SELECT subscription_cycle, subscription_expires_at INTO v_sub_cycle, v_sub_expires
    FROM public.credit_balances WHERE user_id = p_user_id FOR UPDATE;

    -- Subscription Credits go back first, in the order they were spent, and
    -- always to the Subscription bucket: a refund must never turn expiring
    -- credits into permanent ones. The part that came from the cycle still
    -- running stays; the part from a cycle that has ended or been replaced is
    -- expired again below, in this same call, so it cannot roll over.
    SELECT LEAST(p_credits, COALESCE(-SUM(subscription_delta), 0)),
           CASE WHEN v_sub_expires > now()
                THEN COALESCE(-SUM(subscription_delta) FILTER (WHERE subscription_cycle = v_sub_cycle), 0)
                ELSE 0 END
    INTO v_sub_part, v_sub_live
    FROM public.ledger_entries
    WHERE job_id = p_job_id AND delta < 0;
    v_sub_stale := v_sub_part - LEAST(v_sub_part, v_sub_live);

    SELECT LEAST(p_credits - v_sub_part,
                 COALESCE(-SUM(COALESCE(free_delta, delta - subscription_delta)), 0)) INTO v_free_part
    FROM public.ledger_entries
    WHERE job_id = p_job_id AND delta < 0;

    INSERT INTO public.ledger_entries (user_id, delta, free_delta, subscription_delta, subscription_cycle, reason, job_id)
    VALUES (p_user_id, p_credits, v_free_part, v_sub_part,
            CASE WHEN v_sub_part > 0 THEN v_sub_cycle END, p_reason, p_job_id)
    RETURNING id INTO v_entry_id;

    IF v_sub_stale > 0 THEN
        INSERT INTO public.ledger_entries (user_id, delta, free_delta, subscription_delta, subscription_cycle, reason, job_id)
        VALUES (p_user_id, -v_sub_stale, 0, -v_sub_stale, v_sub_cycle, 'expire:subscription', NULL);
    END IF;

    UPDATE public.credit_balances
    SET balance = balance + p_credits - v_sub_stale, free_balance = free_balance + v_free_part,
        subscription_balance = subscription_balance + v_sub_part - v_sub_stale, updated_at = now()
    WHERE user_id = p_user_id
    RETURNING balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
    INTO v_new_balance;

    UPDATE public.jobs
    SET state = 'REFUNDED', updated_at = now()
    WHERE id = p_job_id AND state IN ('DEBITED', 'SUBMITTED', 'FAILOVER', 'FAILED');

    RETURN jsonb_build_object('ok', true, 'entry_id', v_entry_id,
                               'idempotent', false, 'balance_after', v_new_balance);
END $$;

CREATE OR REPLACE FUNCTION public.submit_free_job(
    p_user_id UUID,
    p_idempotency_key TEXT,
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
    v_balance INTEGER;
    v_existing UUID;
    v_count INTEGER;
    v_reset_seconds INTEGER;
    v_take JSONB;
    v_new_job_id UUID;
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

    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.frozen_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
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

REVOKE ALL ON FUNCTION public.submit_free_job(UUID, TEXT, TEXT, JSONB, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_free_job(UUID, TEXT, TEXT, JSONB, INTEGER, INTEGER) TO service_role;
