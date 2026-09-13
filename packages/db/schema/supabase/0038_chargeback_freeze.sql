-- Chargeback Freeze (ADR-0018 decision 8, ADR-0020).
--
-- A Chargeback is a Top-up Refund (or lost dispute) that arrives after
-- credits were spent since that Top-up. It Freezes the account: generating
-- (ledger_debit) and buying (purchase_create) are refused. Sign-in, the
-- library, downloads and deletion are untouched. Only an Operator — a user
-- with is_admin (0032) — unfreezes, and the unfreeze records who and why.
--
-- "Spent since that Top-up" = a job created after the purchase was paid that
-- did not fail or get refunded.
--
-- Freezing happens only when a reversal makes progress: purchases now keep
-- refunded_share (cumulative refunded / charged). A replayed or late, older
-- event is a no-op, so it can never re-freeze an account an Operator has
-- unfrozen. A new, larger refund can.
--
-- The freeze is written in the same transaction as the clawback, after
-- ledger_debit_capped has locked the user's credit_balances row. ledger_debit
-- and purchase_create take that lock before their freeze check, so neither a
-- generation nor a new purchase can slip in between.
--
-- A Checkout Session opened before the Freeze can still be paid. Stripe has
-- the money by then, so purchase_fulfil still grants the credits — the Freeze
-- already stops them being spent — and reports frozen so the webhook logs it
-- for an Operator.
--
-- Replaces: ledger_debit (0030 body + freeze check), purchase_create (0036),
-- purchase_fulfil (0035, now sets paid_at and reports frozen),
-- purchase_reverse (0037).
--
-- operator_unfreeze trusts p_operator_auth_id. Any route that calls it must
-- take that value from the verified x-veyrnox-auth-id header, never from the
-- request body.
--
-- Idempotent: IF NOT EXISTS, OR REPLACE; REVOKE/GRANT re-run.

ALTER TABLE public.purchases
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS refunded_share NUMERIC NOT NULL DEFAULT 0
        CONSTRAINT purchases_refunded_share_range CHECK (refunded_share >= 0 AND refunded_share <= 1);

CREATE TABLE IF NOT EXISTS public.account_freezes (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    reason           TEXT        NOT NULL CHECK (reason IN ('chargeback')),
    purchase_id      UUID        NULL REFERENCES public.purchases(id) ON DELETE SET NULL,
    frozen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    unfrozen_at      TIMESTAMPTZ NULL,
    unfrozen_by      UUID        NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    unfreeze_reason  TEXT        NULL,
    CONSTRAINT account_freezes_unfreeze_recorded CHECK (
        (unfrozen_at IS NULL AND unfrozen_by IS NULL AND unfreeze_reason IS NULL)
        OR (unfrozen_at IS NOT NULL AND unfrozen_by IS NOT NULL AND unfreeze_reason IS NOT NULL)
    )
);
-- At most one active freeze per user.
CREATE UNIQUE INDEX IF NOT EXISTS account_freezes_one_active_idx
    ON public.account_freezes (user_id) WHERE unfrozen_at IS NULL;

ALTER TABLE public.account_freezes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_freezes FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.account_freezes FROM anon, authenticated;

-- ── ledger_debit: 0030 body, plus the freeze check after the replay probe ──
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

    -- A replay above moves no money, so it is answered even when Frozen.
    IF EXISTS (SELECT 1 FROM public.account_freezes WHERE user_id = p_user_id AND unfrozen_at IS NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
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

-- ── purchase_create: 0036 body, plus the freeze check ──────────────────────
CREATE OR REPLACE FUNCTION public.purchase_create(
    p_auth_id TEXT,
    p_pack_id TEXT,
    p_idempotency_key TEXT,
    p_supply_consent_version TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_pack public.credit_packs%ROWTYPE;
    v_existing public.purchases%ROWTYPE;
    v_recent INTEGER;
    v_id UUID;
BEGIN
    IF p_supply_consent_version IS NULL OR p_supply_consent_version !~ '^[a-z0-9-]{1,64}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUPPLY_CONSENT_REQUIRED');
    END IF;

    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    -- Take the balance lock purchase_reverse holds while it Freezes, so this
    -- check cannot race a Freeze being written. Unlike ledger_debit, a replay
    -- is refused too: answering it would reopen a payable Checkout Session.
    PERFORM 1 FROM public.credit_balances WHERE user_id = v_user_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.account_freezes WHERE user_id = v_user_id AND unfrozen_at IS NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;

    -- Serialise this user's purchase creation so the rate-limit count and
    -- the idempotency probe below cannot race.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('purchase:' || v_user_id::text, 0));

    SELECT * INTO v_existing FROM public.purchases
    WHERE user_id = v_user_id AND idempotency_key = p_idempotency_key;
    IF v_existing.id IS NOT NULL THEN
        IF v_existing.pack_id <> p_pack_id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
        END IF;
        -- Stripe keeps idempotency keys for 24h; past that a retry could
        -- mint a second session for the same purchase.
        IF v_existing.state = 'PENDING' AND v_existing.created_at < now() - interval '23 hours' THEN
            RETURN jsonb_build_object('ok', false, 'code', 'PURCHASE_EXPIRED');
        END IF;
        -- A replay keeps the consent recorded when the purchase was created.
        SELECT * INTO v_pack FROM public.credit_packs WHERE id = v_existing.pack_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true,
            'purchase_id', v_existing.id, 'state', v_existing.state,
            'credits', v_existing.credits, 'stripe_price_id', v_pack.stripe_price_id);
    END IF;

    SELECT * INTO v_pack FROM public.credit_packs WHERE id = p_pack_id AND active;
    IF v_pack.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PACK_UNAVAILABLE');
    END IF;

    SELECT count(*) INTO v_recent FROM public.purchases
    WHERE user_id = v_user_id AND created_at > now() - interval '10 minutes';
    IF v_recent >= 5 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
    END IF;

    INSERT INTO public.purchases (user_id, pack_id, credits, idempotency_key, supply_consent_version, supply_consent_at)
    VALUES (v_user_id, v_pack.id, v_pack.credits, p_idempotency_key, p_supply_consent_version, now())
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false,
        'purchase_id', v_id, 'state', 'PENDING',
        'credits', v_pack.credits, 'stripe_price_id', v_pack.stripe_price_id);
END $$;

-- ── purchase_fulfil: 0035 body, plus paid_at and the frozen report ─────────
CREATE OR REPLACE FUNCTION public.purchase_fulfil(
    p_purchase_id UUID,
    p_session_id TEXT,
    p_payment_intent TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_p public.purchases%ROWTYPE;
    v_grant JSONB;
BEGIN
    IF p_session_id IS NULL OR p_session_id = '' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
    END IF;

    SELECT * INTO v_p FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
    IF v_p.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PURCHASE_NOT_FOUND');
    END IF;

    IF v_p.state <> 'PENDING' THEN
        IF v_p.stripe_session_id = p_session_id THEN
            RETURN jsonb_build_object('ok', true, 'idempotent', true,
                'user_id', v_p.user_id, 'credits', v_p.credits);
        END IF;
        RETURN jsonb_build_object('ok', false, 'code', 'SESSION_MISMATCH');
    END IF;

    v_grant := public.ledger_grant(v_p.user_id, v_p.credits, 'grant:topup:stripe');
    IF (v_grant->>'ok')::boolean IS NOT TRUE THEN
        -- Abort the transaction so the purchase stays PENDING and the
        -- webhook's 500 makes Stripe redeliver.
        RAISE EXCEPTION 'ledger_grant rejected purchase %: %', p_purchase_id, v_grant->>'code';
    END IF;

    UPDATE public.purchases
    SET state = 'PAID', stripe_session_id = p_session_id,
        stripe_payment_intent = NULLIF(p_payment_intent, ''),
        paid_at = now(), updated_at = now()
    WHERE id = p_purchase_id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false,
        'user_id', v_p.user_id, 'credits', v_p.credits,
        'balance_after', v_grant->'balance_after',
        'frozen', EXISTS (SELECT 1 FROM public.account_freezes WHERE user_id = v_p.user_id AND unfrozen_at IS NULL));
END $$;

-- ── purchase_reverse: 0037 clawback, progress by refunded_share, Freeze ───
CREATE OR REPLACE FUNCTION public.purchase_reverse(
    p_payment_intent TEXT,
    p_reason TEXT,
    p_amount_refunded BIGINT,
    p_amount BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_p public.purchases%ROWTYPE;
    v_share NUMERIC;
    v_target INTEGER;
    v_owed INTEGER := 0;
    v_taken INTEGER := 0;
    v_debit JSONB;
    v_frozen BOOLEAN := false;
BEGIN
    IF p_reason NOT IN ('reversal:refund', 'reversal:dispute') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REASON');
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount_refunded IS NULL
       OR p_amount_refunded < 0 OR p_amount_refunded > p_amount THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_AMOUNT');
    END IF;

    SELECT * INTO v_p FROM public.purchases
    WHERE stripe_payment_intent = p_payment_intent FOR UPDATE;
    IF v_p.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PURCHASE_NOT_FOUND');
    END IF;
    IF v_p.state = 'PENDING' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_PAID');
    END IF;

    -- Progress is measured on the money, not the rounded credits, so a
    -- refund too small to move a whole credit still counts as a refund.
    v_share := p_amount_refunded::NUMERIC / p_amount;
    IF v_share <= v_p.refunded_share THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true,
            'refunded_credits', v_p.refunded_credits, 'reversed_credits', v_p.reversed_credits,
            'taken', 0, 'shortfall', 0, 'frozen', false);
    END IF;

    -- Non-negative integer division rounds down.
    v_target := LEAST(v_p.credits, (v_p.credits::BIGINT * p_amount_refunded / p_amount)::INTEGER);
    IF v_target > v_p.refunded_credits THEN
        v_owed := v_target - v_p.refunded_credits;
        v_debit := public.ledger_debit_capped(v_p.user_id, v_owed, p_reason);
        IF (v_debit->>'ok')::boolean IS NOT TRUE THEN
            RAISE EXCEPTION 'ledger_debit_capped rejected purchase %: %', v_p.id, v_debit->>'code';
        END IF;
        v_taken := (v_debit->>'debited')::INTEGER;
    ELSE
        v_target := v_p.refunded_credits;
        -- Same lock order as ledger_debit, so the Freeze below cannot race a
        -- generation even when no credit moves.
        PERFORM 1 FROM public.credit_balances WHERE user_id = v_p.user_id FOR UPDATE;
    END IF;

    UPDATE public.purchases
    SET refunded_share = v_share,
        refunded_credits = v_target,
        reversed_credits = reversed_credits + v_taken,
        state = CASE WHEN v_target = v_p.credits THEN 'REVERSED' ELSE 'PAID' END,
        updated_at = now()
    WHERE id = v_p.id;

    -- Chargeback: credits were spent since this Top-up.
    IF EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.user_id = v_p.user_id
          -- created_at only for a purchase paid before 0038 (none exist): errs toward Freeze.
          AND j.created_at > COALESCE(v_p.paid_at, v_p.created_at)
          AND j.state NOT IN ('FAILED', 'REFUNDED')
    ) THEN
        INSERT INTO public.account_freezes (user_id, reason, purchase_id)
        VALUES (v_p.user_id, 'chargeback', v_p.id)
        ON CONFLICT (user_id) WHERE unfrozen_at IS NULL DO NOTHING;
        v_frozen := true;
    END IF;

    RETURN jsonb_build_object('ok', true, 'idempotent', false,
        'user_id', v_p.user_id,
        'refunded_credits', v_target, 'reversed_credits', v_p.reversed_credits + v_taken,
        'taken', v_taken, 'shortfall', v_owed - v_taken, 'frozen', v_frozen);
END $$;

-- ── operator_unfreeze: the only way out of Frozen ─────────────────────────
CREATE OR REPLACE FUNCTION public.operator_unfreeze(
    p_user_id UUID,
    p_operator_auth_id TEXT,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_operator UUID;
    v_freeze UUID;
BEGIN
    SELECT id INTO v_operator FROM public.users WHERE auth_id = p_operator_auth_id AND is_admin;
    IF v_operator IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_OPERATOR');
    END IF;
    IF v_operator = p_user_id THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SELF_UNFREEZE');
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 OR length(p_reason) > 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
    END IF;

    UPDATE public.account_freezes
    SET unfrozen_at = now(), unfrozen_by = v_operator, unfreeze_reason = btrim(p_reason)
    WHERE user_id = p_user_id AND unfrozen_at IS NULL
    RETURNING id INTO v_freeze;
    IF v_freeze IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FROZEN');
    END IF;

    RETURN jsonb_build_object('ok', true, 'freeze_id', v_freeze);
END $$;

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.ledger_debit(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB, INTEGER, INTEGER)',
        'public.purchase_create(TEXT, TEXT, TEXT, TEXT)',
        'public.purchase_fulfil(UUID, TEXT, TEXT)',
        'public.purchase_reverse(TEXT, TEXT, BIGINT, BIGINT)',
        'public.operator_unfreeze(UUID, TEXT, TEXT)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
