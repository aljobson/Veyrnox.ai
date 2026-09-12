-- Security re-audit 2026-09-12: M1, M6, L7, I1.
--
-- M1  The advisory lock in check_generation_rate_limit (0018) is released
--     when that RPC's transaction ends, before ledger_debit runs in its own
--     transaction, so N parallel submits at count = limit-1 all pass. The
--     authoritative window count now lives inside ledger_debit, after the
--     credit_balances FOR UPDATE that already serialises one user's debits.
--     check_generation_rate_limit stays as the cheap early 429 and the
--     USER_NOT_FOUND gate; its lock is dropped (it bought nothing).
--
-- M6  The weekly fal catalog watcher held SUPABASE_SERVICE_ROLE_KEY in
--     GitHub Actions for a five-column read. catalog_watch() returns exactly
--     those columns to the anon role, so the workflow needs only the public
--     publishable key. Costs are public by decision (ADR-0014 addendum).
--
-- L7  Reconcile drift was a Postgres WARNING inside a cron job that reported
--     "succeeded". It now raises, so cron.job_run_details shows the failure.
--
-- Idempotent: CREATE OR REPLACE, DROP ... IF EXISTS, cron.unschedule guard.

-- ── M1: rate limit inside the debit ──────────────────────────────────────

DROP FUNCTION IF EXISTS public.ledger_debit(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB);

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

-- check_generation_rate_limit: same behaviour, advisory lock removed.
CREATE OR REPLACE FUNCTION public.check_generation_rate_limit(
    p_auth_id TEXT,
    p_limit_per_window INTEGER,
    p_window_seconds INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_count INTEGER;
    v_reset_seconds INTEGER;
BEGIN
    IF p_limit_per_window IS NULL OR p_limit_per_window <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_LIMIT');
    END IF;
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT count(*) INTO v_count FROM public.jobs
    WHERE user_id = v_user_id
      AND created_at > now() - make_interval(secs => p_window_seconds);
    IF v_count >= p_limit_per_window THEN
        SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
            MIN(created_at) + make_interval(secs => p_window_seconds) - now()
        ))))::int INTO v_reset_seconds
        FROM public.jobs
        WHERE user_id = v_user_id
          AND created_at > now() - make_interval(secs => p_window_seconds);
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
                                   'count', v_count, 'limit', p_limit_per_window,
                                   'retry_after_seconds', COALESCE(v_reset_seconds, p_window_seconds));
    END IF;
    RETURN jsonb_build_object('ok', true, 'count', v_count, 'limit', p_limit_per_window);
END $$;

-- ── M6: least-privilege read for the catalog watcher ─────────────────────

CREATE OR REPLACE FUNCTION public.catalog_watch()
RETURNS TABLE (id TEXT, provider TEXT, provider_endpoint TEXT, credits_5s INTEGER, provider_cost_per_unit NUMERIC, cost_unit TEXT, billing_seconds NUMERIC, active BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT id, provider, provider_endpoint, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, active
    FROM public.model_catalog
    ORDER BY id;
$$;

-- ── L7: reconcile drift must fail the cron run ───────────────────────────

DO $$
BEGIN
    PERFORM cron.unschedule('veyrnox-reconcile-balances')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'veyrnox-reconcile-balances');
END $$;

SELECT cron.schedule(
    'veyrnox-reconcile-balances',
    '17 3 * * *',
    $$ DO $body$ DECLARE n INTEGER; BEGIN SELECT count(*) INTO n FROM public.reconcile_balances(); IF n > 0 THEN RAISE EXCEPTION 'ledger reconcile drift: % users', n; END IF; END $body$; $$
);

-- ── grants ───────────────────────────────────────────────────────────────

DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.ledger_debit(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB, INTEGER, INTEGER)',
        'public.check_generation_rate_limit(TEXT, INTEGER, INTEGER)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.catalog_watch() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.catalog_watch() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_watch() TO anon, service_role;
