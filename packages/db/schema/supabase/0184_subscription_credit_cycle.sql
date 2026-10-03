-- ADR-0064 (IMPLEMENTATION-PLAN C2/C3): the rest of the Subscription Credit
-- bucket added in 0183.
--
--   ledger_unlock, reverse_cinema_unlocks   the two other spenders (0142),
--                                           same spend and return rules.
--   subscription_grant                      one cycle's credits, keyed.
--   expire_subscription_credits             the sweep.
--   reconcile_subscription_credits          nightly audit.
--   read_user_credits, read_user_balance    report what can be spent.
--
-- A cycle does not roll over: subscription_grant expires whatever is left of
-- the previous cycle before it grants the next. Nothing calls
-- subscription_grant yet; the Stripe subscription webhook (C4) will.
--
-- Idempotent: CREATE OR REPLACE, IF NOT EXISTS, cron entries unscheduled by
-- name before they are scheduled. The pg_cron block is skipped where the
-- extension is absent (the local acceptance-test database).

-- One grant per key, whoever it is for: a Stripe invoice id is global.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_one_subscription_grant_per_key
    ON public.ledger_entries (reason) WHERE reason LIKE 'grant:subscription:%';

-- ── ledger_unlock: Subscription, then Free, then Pack (0142 body otherwise) ─

CREATE OR REPLACE FUNCTION public.ledger_unlock(
    p_user_id UUID,
    p_content_id UUID,
    p_credits INTEGER,
    p_consent_version TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_balance   INTEGER;
    v_free      INTEGER;
    v_free_part INTEGER;
    v_sub         INTEGER;
    v_sub_expires TIMESTAMPTZ;
    v_sub_live    INTEGER;
    v_sub_part    INTEGER;
    v_spendable   INTEGER;
    v_existing  public.cinema_unlocks%ROWTYPE;
    v_entry_id  UUID;
    v_unlock_id UUID;
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS');
    END IF;

    SELECT balance, free_balance, subscription_balance, subscription_expires_at
    INTO v_balance, v_free, v_sub, v_sub_expires
    FROM public.credit_balances
    WHERE user_id = p_user_id
    FOR UPDATE;
    IF v_balance IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW');
    END IF;
    v_sub_live := CASE WHEN v_sub_expires > now() THEN v_sub ELSE 0 END;
    v_spendable := v_balance - (v_sub - v_sub_live);

    SELECT * INTO v_existing FROM public.cinema_unlocks
    WHERE user_id = p_user_id AND content_id = p_content_id AND reversed_at IS NULL;
    IF FOUND THEN
        RETURN jsonb_build_object('ok', true, 'unlock_id', v_existing.id, 'entry_id', v_existing.ledger_entry_id,
                                  'idempotent', true, 'balance_after', v_spendable);
    END IF;

    -- Under the balance lock every Freeze also takes, so none races this.
    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.frozen_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;

    IF v_spendable < p_credits THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_BALANCE', 'balance', v_spendable);
    END IF;

    v_sub_part := LEAST(v_sub_live, p_credits);
    v_free_part := LEAST(v_free, p_credits - v_sub_part);

    INSERT INTO public.ledger_entries (user_id, delta, free_delta, subscription_delta, reason, job_id)
    VALUES (p_user_id, -p_credits, -v_free_part, -v_sub_part, 'unlock:cinema:' || p_content_id::text, NULL)
    RETURNING id INTO v_entry_id;

    UPDATE public.credit_balances
    SET balance = balance - p_credits, free_balance = free_balance - v_free_part,
        subscription_balance = subscription_balance - v_sub_part, updated_at = now()
    WHERE user_id = p_user_id;

    INSERT INTO public.cinema_unlocks (user_id, content_id, ledger_entry_id, credits, consent_version)
    VALUES (p_user_id, p_content_id, v_entry_id, p_credits, p_consent_version)
    RETURNING id INTO v_unlock_id;

    RETURN jsonb_build_object('ok', true, 'unlock_id', v_unlock_id, 'entry_id', v_entry_id,
                              'idempotent', false, 'balance_after', v_spendable - p_credits);
END $$;

-- ── reverse_cinema_unlocks: each part back to its bucket (0142 otherwise) ──

CREATE OR REPLACE FUNCTION public.reverse_cinema_unlocks(
    p_content_id UUID,
    p_operator TEXT,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_unlock    public.cinema_unlocks%ROWTYPE;
    v_free_part INTEGER;
    v_sub_part  INTEGER;
    v_entry_id  UUID;
    v_count     INTEGER := 0;
    v_credits   INTEGER := 0;
BEGIN
    IF p_operator IS NULL OR length(btrim(p_operator)) NOT BETWEEN 1 AND 120
       OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'OPERATOR_AND_REASON_REQUIRED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.cinema_content c WHERE c.id = p_content_id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CONTENT_NOT_FOUND');
    END IF;

    FOR v_unlock IN
        SELECT * FROM public.cinema_unlocks x
        WHERE x.content_id = p_content_id AND x.reversed_at IS NULL
          AND x.created_at > now() - interval '30 days'
        ORDER BY x.user_id
        FOR UPDATE
    LOOP
        PERFORM 1 FROM public.credit_balances b WHERE b.user_id = v_unlock.user_id FOR UPDATE;

        SELECT COALESCE(-l.free_delta, 0), -l.subscription_delta INTO v_free_part, v_sub_part
        FROM public.ledger_entries l
        WHERE l.id = v_unlock.ledger_entry_id;
        v_sub_part := COALESCE(v_sub_part, 0);
        IF EXISTS (SELECT 1 FROM public.ledger_entries l
                   WHERE l.user_id = v_unlock.user_id AND l.reason = 'expire:free') THEN
            v_free_part := 0;
        END IF;

        -- Subscription Credits return to their own bucket, as in ledger_refund.
        INSERT INTO public.ledger_entries (user_id, delta, free_delta, subscription_delta, reason, job_id)
        VALUES (v_unlock.user_id, v_unlock.credits, v_free_part, v_sub_part,
                'reverse:cinema_unlock:' || p_content_id::text, NULL)
        RETURNING id INTO v_entry_id;

        UPDATE public.credit_balances
        SET balance = balance + v_unlock.credits, free_balance = free_balance + v_free_part,
            subscription_balance = subscription_balance + v_sub_part, updated_at = now()
        WHERE user_id = v_unlock.user_id;

        UPDATE public.cinema_unlocks
        SET reversed_at = now(), reversal_entry_id = v_entry_id
        WHERE id = v_unlock.id;

        v_count := v_count + 1;
        v_credits := v_credits + v_unlock.credits;
    END LOOP;

    INSERT INTO public.cinema_unlock_reversals (content_id, operator, reason, unlocks_reversed, credits_returned)
    VALUES (p_content_id, btrim(p_operator), btrim(p_reason), v_count, v_credits);

    RETURN jsonb_build_object('ok', true, 'unlocks_reversed', v_count, 'credits_returned', v_credits);
END $$;

-- ── subscription_grant: one billing cycle's credits ──────────────────────
-- p_grant_key is the provider's id for the paid invoice. A replay is a no-op;
-- the same key for a different user is refused.

CREATE OR REPLACE FUNCTION public.subscription_grant(
    p_user_id UUID,
    p_credits INTEGER,
    p_period_end TIMESTAMPTZ,
    p_grant_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reason TEXT;
    v_existing public.ledger_entries%ROWTYPE;
    v_balance INTEGER;
    v_leftover INTEGER;
    v_entry_id UUID;
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 OR p_credits > 100000 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS');
    END IF;
    IF p_grant_key IS NULL OR p_grant_key !~ '^[A-Za-z0-9_]{1,100}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_GRANT_KEY');
    END IF;
    -- A cycle ends in the future and is at most a year long (annual plans).
    IF p_period_end IS NULL OR p_period_end <= now() OR p_period_end > now() + interval '400 days' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_PERIOD_END');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    v_reason := 'grant:subscription:' || p_grant_key;

    INSERT INTO public.credit_balances (user_id, balance)
    VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    -- Same lock as every other money function.
    SELECT balance, subscription_balance INTO v_balance, v_leftover
    FROM public.credit_balances WHERE user_id = p_user_id FOR UPDATE;

    SELECT * INTO v_existing FROM public.ledger_entries WHERE reason = v_reason;
    IF FOUND THEN
        IF v_existing.user_id <> p_user_id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'GRANT_KEY_REUSED');
        END IF;
        RETURN jsonb_build_object('ok', true, 'entry_id', v_existing.id, 'idempotent', true,
                                  'expired', 0, 'balance_after', v_balance);
    END IF;

    -- No rollover: the previous cycle's remainder goes before the new grant.
    -- One block, so a key another user already holds undoes the expiry too.
    BEGIN
        IF v_leftover > 0 THEN
            INSERT INTO public.ledger_entries (user_id, delta, free_delta, subscription_delta, reason, job_id)
            VALUES (p_user_id, -v_leftover, 0, -v_leftover, 'expire:subscription', NULL);
        END IF;

        INSERT INTO public.ledger_entries (user_id, delta, free_delta, subscription_delta, reason, job_id)
        VALUES (p_user_id, p_credits, 0, p_credits, v_reason, NULL)
        RETURNING id INTO v_entry_id;
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('ok', false, 'code', 'GRANT_KEY_REUSED');
    END;

    UPDATE public.credit_balances
    SET balance = balance - v_leftover + p_credits,
        subscription_balance = p_credits,
        subscription_expires_at = p_period_end,
        updated_at = now()
    WHERE user_id = p_user_id
    RETURNING balance INTO v_balance;

    RETURN jsonb_build_object('ok', true, 'entry_id', v_entry_id, 'idempotent', false,
                              'expired', v_leftover, 'balance_after', v_balance);
END $$;

-- ── expire_subscription_credits: the sweep ───────────────────────────────
-- Removes Subscription Credits whose cycle has ended. Unlike Free Credits it
-- does not wait for unsettled jobs: a late Credit Refund returns to this
-- bucket, already unspendable, and the next run removes it too. p_as_of
-- exists so tests can run the sweep "after the cycle" without waiting.

CREATE OR REPLACE FUNCTION public.expire_subscription_credits(
    p_as_of TIMESTAMPTZ DEFAULT now(),
    p_limit INTEGER DEFAULT 500
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_sub INTEGER;
    v_users INTEGER := 0;
    v_credits INTEGER := 0;
BEGIN
    FOR v_user_id IN
        SELECT b.user_id FROM public.credit_balances b
        WHERE b.subscription_balance > 0 AND b.subscription_expires_at <= p_as_of
        ORDER BY b.subscription_expires_at
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 500), 5000))
    LOOP
        SELECT subscription_balance INTO v_sub FROM public.credit_balances
        WHERE user_id = v_user_id AND subscription_expires_at <= p_as_of
        FOR UPDATE SKIP LOCKED;
        -- Re-check under the lock: a renewal may have replaced the cycle.
        CONTINUE WHEN v_sub IS NULL OR v_sub <= 0;

        INSERT INTO public.ledger_entries (user_id, delta, free_delta, subscription_delta, reason, job_id)
        VALUES (v_user_id, -v_sub, 0, -v_sub, 'expire:subscription', NULL);

        UPDATE public.credit_balances
        SET balance = balance - v_sub, subscription_balance = 0, updated_at = now()
        WHERE user_id = v_user_id;

        v_users := v_users + 1;
        v_credits := v_credits + v_sub;
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'expired_users', v_users, 'expired_credits', v_credits);
END $$;

-- ── reconcile_subscription_credits: must return zero rows ────────────────
-- The last branch catches a dead sweep: credits two days past their end.

CREATE OR REPLACE FUNCTION public.reconcile_subscription_credits()
RETURNS TABLE (user_id UUID, balance INTEGER, free_balance INTEGER, subscription_balance INTEGER,
               subscription_ledger_sum BIGINT, subscription_expires_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT b.user_id, b.balance, b.free_balance, b.subscription_balance,
           COALESCE(l.total, 0) AS subscription_ledger_sum, b.subscription_expires_at
    FROM public.credit_balances b
    LEFT JOIN (
        SELECT le.user_id, SUM(le.subscription_delta) AS total
        FROM public.ledger_entries le
        GROUP BY le.user_id
    ) l ON l.user_id = b.user_id
    WHERE b.subscription_balance <> COALESCE(l.total, 0)
       OR b.subscription_balance < 0
       OR b.free_balance + b.subscription_balance > b.balance
       OR (b.subscription_balance > 0 AND b.subscription_expires_at IS NULL)
       OR (b.subscription_balance > 0 AND b.subscription_expires_at < now() - interval '2 days');
$$;

-- ── readers report what can be spent ─────────────────────────────────────
-- Subscription Credits past their end are left out of `balance` here, as
-- ledger_debit leaves them out, so the figure shown is the figure spendable.

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
    SELECT cb.balance - CASE WHEN cb.subscription_expires_at > now() THEN 0 ELSE cb.subscription_balance END
    INTO v_balance
    FROM public.credit_balances cb
    JOIN public.users u ON u.id = cb.user_id
    WHERE u.auth_id = p_auth_id;
    RETURN COALESCE(v_balance, 0);
END $$;

CREATE OR REPLACE FUNCTION public.read_user_credits(
    p_auth_id TEXT
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'balance', COALESCE(MAX(b.balance - CASE WHEN b.subscription_expires_at > now() THEN 0 ELSE b.subscription_balance END), 0),
        'free_credits', COALESCE(MAX(b.free_balance), 0),
        'free_expires_at', CASE WHEN COALESCE(MAX(b.free_balance), 0) > 0
                                THEN MIN(g.created_at) + interval '90 days' END,
        'subscription_credits', COALESCE(MAX(CASE WHEN b.subscription_expires_at > now() THEN b.subscription_balance ELSE 0 END), 0),
        'subscription_expires_at', CASE WHEN COALESCE(MAX(CASE WHEN b.subscription_expires_at > now() THEN b.subscription_balance ELSE 0 END), 0) > 0
                                        THEN MAX(b.subscription_expires_at) END
    )
    FROM public.users u
    JOIN public.credit_balances b ON b.user_id = u.id
    LEFT JOIN public.ledger_entries g ON g.user_id = u.id AND g.reason = 'grant:signup'
    WHERE u.auth_id = p_auth_id;
$$;

-- ── grants: new functions revoke explicitly (CLAUDE.md "Database") ───────

DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.subscription_grant(UUID, INTEGER, TIMESTAMPTZ, TEXT)',
        'public.expire_subscription_credits(TIMESTAMPTZ, INTEGER)',
        'public.reconcile_subscription_credits()'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;

-- ── cron: hourly sweep; the nightly reconcile gains a fifth check ────────

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN;
    END IF;

    PERFORM cron.unschedule(jobname) FROM cron.job
    WHERE jobname IN ('veyrnox-expire-subscription-credits', 'veyrnox-reconcile-balances');

    PERFORM cron.schedule(
        'veyrnox-expire-subscription-credits',
        '7 * * * *',
        $cmd$ SELECT public.expire_subscription_credits(); $cmd$
    );

    -- Same job name and schedule as 0100; the body gains the fifth check.
    PERFORM cron.schedule(
        'veyrnox-reconcile-balances',
        '17 3 * * *',
        $cmd$ DO $body$ DECLARE n INTEGER; f INTEGER; t INTEGER; u INTEGER; s INTEGER; BEGIN SELECT count(*) INTO n FROM public.reconcile_balances(); SELECT count(*) INTO f FROM public.reconcile_free_credits(); SELECT count(*) INTO t FROM public.reconcile_top_ups(); SELECT count(*) INTO u FROM public.reconcile_failed_refunds(); SELECT count(*) INTO s FROM public.reconcile_subscription_credits(); IF n > 0 OR f > 0 OR t > 0 OR u > 0 OR s > 0 THEN RAISE EXCEPTION 'ledger reconcile drift: % balance, % free-credit users, % top-up problems, % unpaid failures, % subscription-credit users', n, f, t, u, s; END IF; END $body$; $cmd$
    );
END $$;
