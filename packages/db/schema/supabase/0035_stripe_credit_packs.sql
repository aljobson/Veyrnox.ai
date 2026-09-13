-- Stripe Managed Payments credit top-ups (ADR-0019).
--
-- credit_packs  — credits per pack + the Stripe Price that sells it. The
--                 money amount lives on the Stripe Price only; a pack is
--                 active only once its price id is set.
-- purchases     — one row per checkout attempt. The webhook resolves the
--                 user from this row, never from the Stripe payload.
--
-- purchase_create  — idempotent on (user_id, idempotency_key); at most
--                    PURCHASE_RATE_LIMIT per user per 10 minutes.
-- purchase_fulfil  — PENDING -> PAID, grants credits via ledger_grant in
--                    the same transaction. Replays are no-ops.
-- purchase_reverse — PAID -> REVERSED on full refund / lost dispute, via
--                    ledger_debit_capped.
-- ledger_debit_capped — the ledger primitive for a reversal with no job:
--                    debits min(credits, balance). balance >= 0 is a table
--                    CHECK, so a spent top-up reports its shortfall instead.
--
-- All four are service_role only. Idempotent: IF NOT EXISTS, OR REPLACE,
-- ON CONFLICT DO NOTHING; REVOKE/GRANT are safe to re-run.

CREATE TABLE IF NOT EXISTS public.credit_packs (
    id               TEXT        PRIMARY KEY CHECK (id ~ '^[a-z0-9_]{1,32}$'),
    credits          INTEGER     NOT NULL CHECK (credits > 0),
    stripe_price_id  TEXT        NULL UNIQUE CHECK (stripe_price_id ~ '^price_[A-Za-z0-9]{1,64}$'),
    active           BOOLEAN     NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT credit_packs_active_needs_price CHECK (NOT active OR stripe_price_id IS NOT NULL)
);

INSERT INTO public.credit_packs (id, credits) VALUES
    ('pack_100', 100),
    ('pack_300', 300),
    ('pack_1000', 1000)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.purchases (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    pack_id                TEXT        NOT NULL REFERENCES public.credit_packs(id),
    credits                INTEGER     NOT NULL CHECK (credits > 0),
    idempotency_key        TEXT        NOT NULL,
    state                  TEXT        NOT NULL DEFAULT 'PENDING'
                                       CHECK (state IN ('PENDING', 'PAID', 'REVERSED')),
    stripe_session_id      TEXT        NULL UNIQUE,
    stripe_payment_intent  TEXT        NULL UNIQUE,
    reversed_credits       INTEGER     NULL CHECK (reversed_credits >= 0),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS purchases_user_created_idx ON public.purchases (user_id, created_at);

-- Backend only: no policy for any end-user role; service_role bypasses RLS.
ALTER TABLE public.credit_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_packs FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.purchases    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases    FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_packs FROM anon, authenticated;
REVOKE ALL ON public.purchases    FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- ledger_debit_capped — sits beside ledger_debit / ledger_refund /
-- ledger_grant. Caller is responsible for idempotency (purchase_reverse
-- holds the purchase row lock and flips its state in the same transaction).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ledger_debit_capped(
    p_user_id UUID,
    p_credits INTEGER,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_balance INTEGER;
    v_take INTEGER;
    v_entry_id UUID;
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS');
    END IF;
    IF p_reason IS NULL OR p_reason NOT LIKE 'reversal:%' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REASON');
    END IF;

    SELECT balance INTO v_balance FROM public.credit_balances
    WHERE user_id = p_user_id FOR UPDATE;
    IF v_balance IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW');
    END IF;

    v_take := LEAST(p_credits, v_balance);
    IF v_take > 0 THEN
        INSERT INTO public.ledger_entries (user_id, delta, reason, job_id)
        VALUES (p_user_id, -v_take, p_reason, NULL)
        RETURNING id INTO v_entry_id;
        UPDATE public.credit_balances
        SET balance = balance - v_take, updated_at = now()
        WHERE user_id = p_user_id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'entry_id', v_entry_id,
        'debited', v_take, 'shortfall', p_credits - v_take,
        'balance_after', v_balance - v_take);
END $$;

-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purchase_create(
    p_auth_id TEXT,
    p_pack_id TEXT,
    p_idempotency_key TEXT
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
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
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

    INSERT INTO public.purchases (user_id, pack_id, credits, idempotency_key)
    VALUES (v_user_id, v_pack.id, v_pack.credits, p_idempotency_key)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false,
        'purchase_id', v_id, 'state', 'PENDING',
        'credits', v_pack.credits, 'stripe_price_id', v_pack.stripe_price_id);
END $$;

-- ────────────────────────────────────────────────────────────────────
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
        stripe_payment_intent = NULLIF(p_payment_intent, ''), updated_at = now()
    WHERE id = p_purchase_id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false,
        'user_id', v_p.user_id, 'credits', v_p.credits,
        'balance_after', v_grant->'balance_after');
END $$;

-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purchase_reverse(
    p_payment_intent TEXT,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_p public.purchases%ROWTYPE;
    v_debit JSONB;
BEGIN
    IF p_reason NOT IN ('reversal:refund', 'reversal:dispute') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REASON');
    END IF;

    SELECT * INTO v_p FROM public.purchases
    WHERE stripe_payment_intent = p_payment_intent FOR UPDATE;
    IF v_p.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PURCHASE_NOT_FOUND');
    END IF;
    IF v_p.state = 'REVERSED' THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true,
            'reversed_credits', v_p.reversed_credits,
            'shortfall', v_p.credits - v_p.reversed_credits);
    END IF;
    IF v_p.state <> 'PAID' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_PAID');
    END IF;

    v_debit := public.ledger_debit_capped(v_p.user_id, v_p.credits, p_reason);
    IF (v_debit->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'ledger_debit_capped rejected purchase %: %', v_p.id, v_debit->>'code';
    END IF;

    UPDATE public.purchases
    SET state = 'REVERSED', reversed_credits = (v_debit->>'debited')::integer, updated_at = now()
    WHERE id = v_p.id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false,
        'user_id', v_p.user_id, 'reversed_credits', (v_debit->>'debited')::integer,
        'shortfall', (v_debit->>'shortfall')::integer);
END $$;

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.purchase_create(TEXT, TEXT, TEXT)',
        'public.purchase_fulfil(UUID, TEXT, TEXT)',
        'public.purchase_reverse(TEXT, TEXT)',
        'public.ledger_debit_capped(UUID, INTEGER, TEXT)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
