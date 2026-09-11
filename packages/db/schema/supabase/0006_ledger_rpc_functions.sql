-- Slice 4 — expose Ledger.debit / .refund / .grant as Postgres functions
-- callable from Cloudflare Workers via Supabase PostgREST /rest/v1/rpc/*.
--
-- Reason: Cloudflare Workers can't cleanly hold long-lived Postgres TCP
-- connections across requests. Rather than wrestle with @neondatabase/
-- serverless or postgres.js in the Worker runtime, wrap each atomic
-- unit as a single stored function and call it via HTTPS. Each RPC is
-- one round trip and one server-side transaction.
--
-- Every function is SECURITY DEFINER with SET search_path = '' (per the
-- 0004 advisor-fix lesson) and REVOKE-then-GRANT to service_role only —
-- end users never invoke these directly; the gateway does.
--
-- The functions mirror packages/db/ledger.ts semantics 1:1, so the
-- Node-side acceptance tests (which hit local Postgres via pg) and
-- these RPCs enforce the same invariants.

-- ────────────────────────────────────────────────────────────────────
-- ledger_debit — SERIALIZABLE-ish via FOR UPDATE row lock + idempotency
-- ────────────────────────────────────────────────────────────────────
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

    -- Idempotency guard: same (user_id, idempotency_key) returns the
    -- existing job unchanged.
    SELECT id INTO v_existing FROM public.jobs
    WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
        SELECT balance INTO v_current_balance FROM public.credit_balances
        WHERE user_id = p_user_id;
        RETURN jsonb_build_object('ok', true, 'job_id', v_existing,
                                   'idempotent', true, 'balance_after', v_current_balance);
    END IF;

    -- Row-lock the balance to serialise concurrent debits.
    SELECT balance INTO v_current_balance FROM public.credit_balances
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF v_current_balance IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW',
                                   'message', format('no credit_balances row for user %s', p_user_id));
    END IF;

    IF v_current_balance < p_credits THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_BALANCE',
                                   'message', format('insufficient balance: have %s, need %s', v_current_balance, p_credits),
                                   'balance', v_current_balance);
    END IF;

    -- Create the jobs row (state = DEBITED — no PRICED intermediate).
    INSERT INTO public.jobs (user_id, idempotency_key, model_id, credits, inputs, state)
    VALUES (p_user_id, p_idempotency_key, p_model_id, p_credits, p_inputs, 'DEBITED')
    RETURNING id INTO v_new_job_id;

    -- Append the -delta ledger entry.
    INSERT INTO public.ledger_entries (user_id, delta, reason, job_id)
    VALUES (p_user_id, -p_credits, p_reason, v_new_job_id);

    -- Update the materialised balance.
    UPDATE public.credit_balances
    SET balance = balance - p_credits, updated_at = now()
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object('ok', true, 'job_id', v_new_job_id,
                               'idempotent', false, 'balance_after', v_current_balance - p_credits);
END $$;

-- ────────────────────────────────────────────────────────────────────
-- ledger_refund — one refund per job (idempotent), compensating +delta
-- ────────────────────────────────────────────────────────────────────
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
    v_existing UUID;
    v_entry_id UUID;
    v_new_balance INTEGER;
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS',
                                   'message', format('refund credits must be a positive integer (got %s)', p_credits));
    END IF;

    -- Idempotency: one refund per job.
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

-- ────────────────────────────────────────────────────────────────────
-- ledger_grant — signup / subscription / topup. Caller pre-dedups via
-- webhook_events(source, external_id).
-- (signup_grant from 0005 stays as a specialization for the auth
-- webhook; ledger_grant is the general form for Slice 6+ billing.)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ledger_grant(
    p_user_id UUID,
    p_credits INTEGER,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_entry_id UUID;
    v_new_balance INTEGER;
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS',
                                   'message', format('grant credits must be a positive integer (got %s)', p_credits));
    END IF;

    INSERT INTO public.credit_balances (user_id, balance)
    VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.ledger_entries (user_id, delta, reason, job_id)
    VALUES (p_user_id, p_credits, p_reason, NULL)
    RETURNING id INTO v_entry_id;

    UPDATE public.credit_balances
    SET balance = balance + p_credits, updated_at = now()
    WHERE user_id = p_user_id
    RETURNING balance INTO v_new_balance;

    RETURN jsonb_build_object('ok', true, 'entry_id', v_entry_id, 'balance_after', v_new_balance);
END $$;

-- ────────────────────────────────────────────────────────────────────
-- read_user_balance — cache read the Worker can hit without a full
-- credit_balances SELECT roundtrip via PostgREST. Returns 0 if the
-- user has no balance row (matches Ledger.readBalance).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.read_user_balance(
    p_auth_id TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_balance INTEGER;
BEGIN
    SELECT cb.balance INTO v_balance
    FROM public.credit_balances cb
    JOIN public.users u ON u.id = cb.user_id
    WHERE u.auth_id = p_auth_id;
    RETURN COALESCE(v_balance, 0);
END $$;

-- ────────────────────────────────────────────────────────────────────
-- Permissions — service_role only for the write RPCs; read_user_balance
-- can also be called by authenticated (the caller's own row is what it
-- returns via auth_id → users.id).
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.ledger_debit(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB)',
        'public.ledger_refund(UUID, UUID, INTEGER, TEXT)',
        'public.ledger_grant(UUID, INTEGER, TEXT)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;

-- read_user_balance is service_role only. Authenticated callers going
-- through the Worker inherit their identity from the middleware-verified
-- x-veyrnox-auth-id header, not from the JWT that reaches this RPC.
-- Granting to authenticated would allow a signed-in user to call this
-- with any auth_id and read another user's balance.
REVOKE ALL ON FUNCTION public.read_user_balance(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_user_balance(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.read_user_balance(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.read_user_balance(TEXT) TO service_role;
