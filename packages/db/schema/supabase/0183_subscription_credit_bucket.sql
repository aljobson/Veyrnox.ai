-- ADR-0064 (IMPLEMENTATION-PLAN C2): a third credit bucket, Subscription
-- Credits, beside Free Credits (0037) and Pack Credits.
--
--   ledger_entries.subscription_delta     the part of `delta` that moved
--                                         Subscription Credits. 0 for every
--                                         row written before this migration.
--   credit_balances.subscription_balance  materialised SUM of that.
--   credit_balances.subscription_expires_at  end of the cycle those credits
--                                         belong to. Past it they cannot be
--                                         spent; the sweep (0184) removes them.
--   credit_balances.subscription_cycle    counts the grants: which cycle the
--                                         bucket holds now.
--   ledger_entries.subscription_cycle     the cycle a row's Subscription part
--                                         belongs to, so a refund can tell a
--                                         replaced cycle from the current one.
--
-- Spend order (ADR-0064, accepted 2026-09-28): Subscription, then Free, then
-- Pack: soonest-expiring first. A Credit Refund returns each part to the
-- bucket it came from; Subscription Credits from a cycle that has ended or
-- been replaced are returned and expired in the same call, so they never
-- carry into a later cycle. A Pack clawback never takes Subscription Credits.
--
-- Nothing grants Subscription Credits until 0184's subscription_grant is
-- called, and no application code calls it yet, so every balance has
-- subscription_balance = 0 and each function below behaves exactly as its
-- predecessor did: ledger_debit (0059), ledger_refund (0037),
-- apply_top_up_refund (0097). Their signatures are unchanged, so their grants
-- carry over.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, guarded constraints, CREATE OR REPLACE.

-- ── columns and constraints ──────────────────────────────────────────────
-- A constant default is a catalogue change only: no row is rewritten, so the
-- append-only trigger on ledger_entries is not involved.

-- credit_balances before ledger_entries: the order the money functions lock
-- them in. A busy table fails this migration fast instead of queueing every
-- debit behind it; it is safe to run again.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.credit_balances ADD COLUMN IF NOT EXISTS subscription_balance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.credit_balances ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;
ALTER TABLE public.credit_balances ADD COLUMN IF NOT EXISTS subscription_cycle INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.ledger_entries ADD COLUMN IF NOT EXISTS subscription_delta INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.ledger_entries ADD COLUMN IF NOT EXISTS subscription_cycle INTEGER;

DO $$
BEGIN
    -- The two tracked parts never exceed the row, and each has the row's sign.
    -- NOT VALID like 0037's: legacy rows have free_delta NULL.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_entries_buckets_within_delta') THEN
        ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_buckets_within_delta
            CHECK (sign(subscription_delta) * sign(delta) >= 0
                   AND abs(subscription_delta) + abs(COALESCE(free_delta, 0)) <= abs(delta)) NOT VALID;
    END IF;
    -- A subscription grant or expiry moves Subscription Credits and nothing
    -- else, so ledger_grant (which writes subscription_delta = 0) cannot be
    -- used to mint or expire them under these reasons.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_entries_subscription_reasons') THEN
        ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_subscription_reasons
            CHECK ((reason NOT LIKE 'grant:subscription:%' AND reason <> 'expire:subscription')
                   OR subscription_delta = delta) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_balances_buckets_within_balance') THEN
        ALTER TABLE public.credit_balances ADD CONSTRAINT credit_balances_buckets_within_balance
            CHECK (subscription_balance >= 0 AND free_balance + subscription_balance <= balance);
    END IF;
    -- Subscription Credits always have an end date.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_balances_subscription_has_expiry') THEN
        ALTER TABLE public.credit_balances ADD CONSTRAINT credit_balances_subscription_has_expiry
            CHECK (subscription_balance = 0 OR subscription_expires_at IS NOT NULL);
    END IF;
END $$;

-- ── ledger_debit: Subscription, then Free, then Pack (0059 body otherwise) ─

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
    v_sub_balance INTEGER;
    v_sub_expires TIMESTAMPTZ;
    v_sub_cycle INTEGER;
    v_sub_live INTEGER;
    v_sub_part INTEGER;
    v_spendable INTEGER;
    v_new_job_id UUID;
    v_count INTEGER;
    v_reset_seconds INTEGER;
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
    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.frozen_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
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

-- ── ledger_refund: each part back to its own bucket (0037 body otherwise) ──

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

-- ── apply_top_up_refund: the clawback cap excludes Subscription Credits ───
-- (0097 body otherwise)

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
    v_sub INTEGER;
    v_sub_dead INTEGER;
    v_share INTEGER;
    v_owed INTEGER;
    v_taken INTEGER;
    v_frozen BOOLEAN := false;
BEGIN
    IF p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9_]{1,64}$' THEN
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

    -- A Pack clawback takes Pack Credits only: never Free, never Subscription.
    SELECT b.balance, b.free_balance, b.subscription_balance,
           CASE WHEN b.subscription_expires_at > now() THEN 0 ELSE b.subscription_balance END
    INTO v_balance, v_free, v_sub, v_sub_dead
    FROM public.credit_balances b WHERE b.user_id = v_top_up.user_id FOR UPDATE;
    v_taken := GREATEST(0, LEAST(v_owed, v_balance - v_free - v_sub));

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
                              'balance_after', v_balance - v_taken - v_sub_dead, 'frozen', v_frozen);
END $$;
