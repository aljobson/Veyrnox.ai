-- ADR-0013 enforcement, issue #102: Free Credits (the one-time grant:signup
-- credits) are spent before Pack Credits, and any still unspent 90 days
-- after the grant are expired by a sweep.
--
-- Per-source tracking lives beside the existing money columns:
--
--   ledger_entries.free_delta    the part of `delta` that moved Free Credits.
--                                grant:signup = delta, generation debit =
--                                -(free part), its Credit Refund = +(same
--                                part), expire:free = delta, anything else 0.
--   credit_balances.free_balance materialised SUM of that, like `balance`.
--                                CHECK 0 <= free_balance <= balance, so a
--                                Pack-only clawback (#96) that forgets to cap
--                                at balance - free_balance fails instead of
--                                eating Free Credits.
--
-- Legacy rows: ledger rows written before this migration have free_delta
-- NULL and count as Free Credits in full (COALESCE(free_delta, delta)).
-- ADR-0013 records that until billing every balance was 100% free credits;
-- no grant:topup existed. Rows can't be backfilled (append-only), and every
-- new row gets a non-NULL value (default 0, NOT VALID check).
--
-- Expiry: one expire:free row per user, since signup_grant grants once per
-- user; a partial unique index makes a second one impossible. The sweep
-- skips a user while a generation that took Free Credits is still
-- unsettled, so a later Credit Refund can't restore Free Credits after
-- their grant has already been expired.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, guarded constraints and cron
-- entries, CREATE OR REPLACE. The pg_cron block is skipped where the
-- extension is absent (the local acceptance-test database).

-- ── columns and constraints ──────────────────────────────────────────────

ALTER TABLE public.ledger_entries ADD COLUMN IF NOT EXISTS free_delta INTEGER;
ALTER TABLE public.ledger_entries ALTER COLUMN free_delta SET DEFAULT 0;

ALTER TABLE public.credit_balances ADD COLUMN IF NOT EXISTS free_balance INTEGER;
UPDATE public.credit_balances b
SET free_balance = LEAST(b.balance, GREATEST(0, COALESCE((
    SELECT SUM(COALESCE(l.free_delta, l.delta)) FROM public.ledger_entries l WHERE l.user_id = b.user_id
), 0)))
WHERE b.free_balance IS NULL;
ALTER TABLE public.credit_balances ALTER COLUMN free_balance SET DEFAULT 0;
ALTER TABLE public.credit_balances ALTER COLUMN free_balance SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_entries_free_delta_within_delta') THEN
        ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_free_delta_within_delta
            CHECK (free_delta IS NOT NULL AND abs(free_delta) <= abs(delta) AND free_delta * delta >= 0) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_balances_free_within_balance') THEN
        ALTER TABLE public.credit_balances ADD CONSTRAINT credit_balances_free_within_balance
            CHECK (free_balance >= 0 AND free_balance <= balance);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_one_free_expiry
    ON public.ledger_entries (user_id) WHERE reason = 'expire:free';

-- ── signup_grant: the only source of Free Credits ────────────────────────

CREATE OR REPLACE FUNCTION public.signup_grant(
    p_auth_id TEXT,
    p_email TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    INSERT INTO public.users (auth_id, email)
    VALUES (p_auth_id, p_email)
    ON CONFLICT (auth_id) DO UPDATE SET email = EXCLUDED.email
    RETURNING id INTO v_user_id;

    INSERT INTO public.credit_balances (user_id, balance)
    VALUES (v_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    -- Lock the balance row so two replays can't both pass the probe.
    PERFORM 1 FROM public.credit_balances WHERE user_id = v_user_id FOR UPDATE;

    IF NOT EXISTS (
        SELECT 1 FROM public.ledger_entries
        WHERE user_id = v_user_id AND reason = 'grant:signup'
    ) THEN
        INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id)
        VALUES (v_user_id, 50, 50, 'grant:signup', NULL);
        UPDATE public.credit_balances
        SET balance = balance + 50, free_balance = free_balance + 50, updated_at = now()
        WHERE user_id = v_user_id;
    END IF;

    RETURN v_user_id;
END $$;

-- ── ledger_grant: never Free Credits ─────────────────────────────────────

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
    -- Free Credits come only from signup_grant; expiry only from the sweep.
    IF p_reason IN ('grant:signup', 'expire:free') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RESERVED_REASON');
    END IF;

    INSERT INTO public.credit_balances (user_id, balance)
    VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id)
    VALUES (p_user_id, p_credits, 0, p_reason, NULL)
    RETURNING id INTO v_entry_id;

    UPDATE public.credit_balances
    SET balance = balance + p_credits, updated_at = now()
    WHERE user_id = p_user_id
    RETURNING balance INTO v_new_balance;

    RETURN jsonb_build_object('ok', true, 'entry_id', v_entry_id, 'balance_after', v_new_balance);
END $$;

-- ── ledger_debit: Free Credits first (0030 body otherwise unchanged) ─────

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
    v_free_balance INTEGER;
    v_free_part INTEGER;
    v_new_job_id UUID;
    v_count INTEGER;
    v_reset_seconds INTEGER;
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS',
                                   'message', format('credits must be a positive integer (got %s)', p_credits));
    END IF;

    SELECT balance, free_balance INTO v_current_balance, v_free_balance FROM public.credit_balances
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

    v_free_part := LEAST(v_free_balance, p_credits);

    INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id)
    VALUES (p_user_id, -p_credits, -v_free_part, p_reason, v_new_job_id);

    UPDATE public.credit_balances
    SET balance = balance - p_credits, free_balance = free_balance - v_free_part, updated_at = now()
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object('ok', true, 'job_id', v_new_job_id,
                               'idempotent', false, 'balance_after', v_current_balance - p_credits);
END $$;

-- ── ledger_refund: back to the source it came from (0025 body otherwise) ─

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
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 THEN
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

    SELECT id INTO v_existing FROM public.ledger_entries
    WHERE job_id = p_job_id AND delta > 0 AND reason LIKE 'refund:%';
    IF v_existing IS NOT NULL THEN
        SELECT balance INTO v_new_balance FROM public.credit_balances
        WHERE user_id = p_user_id;
        RETURN jsonb_build_object('ok', true, 'entry_id', v_existing,
                                   'idempotent', true, 'balance_after', v_new_balance);
    END IF;

    -- The Free Credits this job's debit took (legacy debits: all of it).
    -- A partial refund returns Free Credits first, up to that amount.
    SELECT LEAST(p_credits, COALESCE(-SUM(COALESCE(free_delta, delta)), 0)) INTO v_free_part
    FROM public.ledger_entries
    WHERE job_id = p_job_id AND delta < 0;

    INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id)
    VALUES (p_user_id, p_credits, v_free_part, p_reason, p_job_id)
    RETURNING id INTO v_entry_id;

    UPDATE public.credit_balances
    SET balance = balance + p_credits, free_balance = free_balance + v_free_part, updated_at = now()
    WHERE user_id = p_user_id
    RETURNING balance INTO v_new_balance;

    UPDATE public.jobs
    SET state = 'REFUNDED', updated_at = now()
    WHERE id = p_job_id AND state IN ('DEBITED', 'SUBMITTED', 'FAILOVER', 'FAILED');

    RETURN jsonb_build_object('ok', true, 'entry_id', v_entry_id,
                               'idempotent', false, 'balance_after', v_new_balance);
END $$;

-- ── expire_free_credits: the 90-day sweep ────────────────────────────────
-- p_as_of exists so acceptance tests can run the sweep "91 days later"
-- without backdating append-only rows. The cron entry passes nothing.

CREATE OR REPLACE FUNCTION public.expire_free_credits(
    p_as_of TIMESTAMPTZ DEFAULT now(),
    p_limit INTEGER DEFAULT 500
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_free INTEGER;
    v_users INTEGER := 0;
    v_credits INTEGER := 0;
BEGIN
    FOR v_user_id IN
        SELECT b.user_id
        FROM public.credit_balances b
        JOIN public.ledger_entries g ON g.user_id = b.user_id AND g.reason = 'grant:signup'
        WHERE b.free_balance > 0
          AND g.created_at <= p_as_of - interval '90 days'
          AND NOT EXISTS (SELECT 1 FROM public.ledger_entries e
                          WHERE e.user_id = b.user_id AND e.reason = 'expire:free')
        ORDER BY g.created_at
        LIMIT p_limit
    LOOP
        -- Same lock as ledger_debit; skip a user another run holds.
        SELECT free_balance INTO v_free FROM public.credit_balances
        WHERE user_id = v_user_id
        FOR UPDATE SKIP LOCKED;

        -- Re-check under the lock: fresh statements see commits the scan missed.
        CONTINUE WHEN v_free IS NULL OR v_free <= 0;
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.ledger_entries e
                              WHERE e.user_id = v_user_id AND e.reason = 'expire:free');
        CONTINUE WHEN EXISTS (
            SELECT 1 FROM public.jobs j
            JOIN public.ledger_entries d ON d.job_id = j.id AND d.delta < 0
            WHERE j.user_id = v_user_id
              AND j.state IN ('PRICED', 'DEBITED', 'SUBMITTED', 'FAILOVER', 'FAILED')
              AND COALESCE(d.free_delta, d.delta) < 0);

        -- free_balance <= balance (constraint), so this never goes below zero.
        INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id)
        VALUES (v_user_id, -v_free, -v_free, 'expire:free', NULL);

        UPDATE public.credit_balances
        SET balance = balance - v_free, free_balance = 0, updated_at = now()
        WHERE user_id = v_user_id;

        v_users := v_users + 1;
        v_credits := v_credits + v_free;
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'expired_users', v_users, 'expired_credits', v_credits);
END $$;

-- ── reconcile_free_credits: nightly audit, alongside reconcile_balances ──

CREATE OR REPLACE FUNCTION public.reconcile_free_credits()
RETURNS TABLE (user_id UUID, balance INTEGER, free_balance INTEGER, free_ledger_sum BIGINT, free_expiries BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT b.user_id, b.balance, b.free_balance,
           COALESCE(l.free_total, 0) AS free_ledger_sum,
           COALESCE(l.expiries, 0) AS free_expiries
    FROM public.credit_balances b
    LEFT JOIN (
        SELECT le.user_id,
               SUM(COALESCE(le.free_delta, le.delta)) AS free_total,
               count(*) FILTER (WHERE le.reason = 'expire:free') AS expiries
        FROM public.ledger_entries le
        GROUP BY le.user_id
    ) l ON l.user_id = b.user_id
    WHERE b.free_balance <> COALESCE(l.free_total, 0)
       OR COALESCE(l.free_total, 0) < 0
       OR b.free_balance > b.balance
       OR COALESCE(l.expiries, 0) > 1;
$$;

-- ── read_user_credits: the caller's balance and Free Credit remainder ────
-- Service-role only, like read_user_balance: the Worker passes the
-- middleware-verified auth id, never a client-supplied one.

CREATE OR REPLACE FUNCTION public.read_user_credits(
    p_auth_id TEXT
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'balance', COALESCE(MAX(b.balance), 0),
        'free_credits', COALESCE(MAX(b.free_balance), 0),
        'free_expires_at', CASE WHEN COALESCE(MAX(b.free_balance), 0) > 0
                                THEN MIN(g.created_at) + interval '90 days' END
    )
    FROM public.users u
    JOIN public.credit_balances b ON b.user_id = u.id
    LEFT JOIN public.ledger_entries g ON g.user_id = u.id AND g.reason = 'grant:signup'
    WHERE u.auth_id = p_auth_id;
$$;

-- ── grants ───────────────────────────────────────────────────────────────

DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.signup_grant(TEXT, TEXT)',
        'public.ledger_grant(UUID, INTEGER, TEXT)',
        'public.ledger_debit(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB, INTEGER, INTEGER)',
        'public.ledger_refund(UUID, UUID, INTEGER, TEXT)',
        'public.expire_free_credits(TIMESTAMPTZ, INTEGER)',
        'public.reconcile_free_credits()',
        'public.read_user_credits(TEXT)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;

-- ── cron: daily expiry sweep; nightly reconcile covers Free Credits ──────

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN;
    END IF;

    PERFORM cron.unschedule(jobname) FROM cron.job
    WHERE jobname IN ('veyrnox-expire-free-credits', 'veyrnox-reconcile-balances');

    PERFORM cron.schedule(
        'veyrnox-expire-free-credits',
        '41 2 * * *',
        $cmd$ SELECT public.expire_free_credits(); $cmd$
    );

    PERFORM cron.schedule(
        'veyrnox-reconcile-balances',
        '17 3 * * *',
        $cmd$ DO $body$ DECLARE n INTEGER; f INTEGER; BEGIN SELECT count(*) INTO n FROM public.reconcile_balances(); SELECT count(*) INTO f FROM public.reconcile_free_credits(); IF n > 0 OR f > 0 THEN RAISE EXCEPTION 'ledger reconcile drift: % balance, % free-credit users', n, f; END IF; END $body$; $cmd$
    );
END $$;
