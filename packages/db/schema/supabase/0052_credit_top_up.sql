-- Credit a paid Top-up exactly once (#93, ADR-0018 decision 5).
-- Applied name: 0052_credit_top_up.
-- Numbered 0052: 0042-0046 (#114), 0047-0050 (#119, already applied in
-- production) and 0051 (feat/activate-elevenlabs-sfx) were taken first.
--
-- top_ups gains    order_id        the LemonSqueezy order that paid it (unique)
--                  credited_at
--                  grant_entry_id  its grant:topup ledger row. The ledger row
--                                  plus top_ups.sales_channel is how every
--                                  Top-up grant records its Sales Channel.
--                  A CHECK keeps all three set exactly when status = credited.
--
-- top_up_flagged_orders  paid orders that must never be granted and need an
--                  Operator refund in the LemonSqueezy dashboard:
--                  already_credited  a second paid order for a Top-up that is
--                                    already credited. POST /api/v1/top-ups
--                                    gives a replayed idempotency key a fresh
--                                    checkout for the same Top-up, so two
--                                    paid orders can name one Top-up. The
--                                    first to arrive wins.
--                  *_mismatch        variant, pre-tax amount or currency
--                                    differ from the pending row.
--                  Operator reads and refund tracking come with #96/#97.
--
-- credit_top_up is the only writer of the new columns and table. It locks the
-- Top-up row, so repeated and concurrent calls serialise on it: the same order
-- again is an idempotent no-op, a different order is flagged. The grant goes
-- through ledger_grant (free_delta = 0: Pack Credits are never Free Credits)
-- to the pending row's user, never a user named by the caller.
--
-- read_top_up is the caller-scoped status read for the return page.
--
-- No browser access: RLS forced, privileges revoked, service_role only.

ALTER TABLE public.top_ups ADD COLUMN IF NOT EXISTS order_id       TEXT        NULL;
ALTER TABLE public.top_ups ADD COLUMN IF NOT EXISTS credited_at    TIMESTAMPTZ NULL;
ALTER TABLE public.top_ups ADD COLUMN IF NOT EXISTS grant_entry_id UUID        NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'top_ups_order_id_key') THEN
        ALTER TABLE public.top_ups ADD CONSTRAINT top_ups_order_id_key UNIQUE (order_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'top_ups_grant_entry_id_key') THEN
        ALTER TABLE public.top_ups ADD CONSTRAINT top_ups_grant_entry_id_key UNIQUE (grant_entry_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'top_ups_grant_entry_id_fkey') THEN
        ALTER TABLE public.top_ups ADD CONSTRAINT top_ups_grant_entry_id_fkey
            FOREIGN KEY (grant_entry_id) REFERENCES public.ledger_entries(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'top_ups_order_id_format') THEN
        ALTER TABLE public.top_ups ADD CONSTRAINT top_ups_order_id_format
            CHECK (order_id IS NULL OR order_id ~ '^[0-9]{1,20}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'top_ups_credited_complete') THEN
        ALTER TABLE public.top_ups ADD CONSTRAINT top_ups_credited_complete CHECK (
            (status = 'credited') = (order_id IS NOT NULL AND credited_at IS NOT NULL AND grant_entry_id IS NOT NULL)
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.top_up_flagged_orders (
    order_id        TEXT        PRIMARY KEY CHECK (order_id ~ '^[0-9]{1,20}$'),
    top_up_id       UUID        NOT NULL REFERENCES public.top_ups(id) ON DELETE RESTRICT,
    user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    reason          TEXT        NOT NULL CHECK (reason IN
                        ('already_credited', 'variant_mismatch', 'amount_mismatch', 'currency_mismatch')),
    paid_usd_cents  INTEGER     NULL,
    currency        TEXT        NULL,
    variant_id      TEXT        NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS top_up_flagged_orders_top_up_idx ON public.top_up_flagged_orders (top_up_id);

ALTER TABLE public.top_up_flagged_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.top_up_flagged_orders FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.top_up_flagged_orders FROM PUBLIC, anon, authenticated;

-- credit_top_up
--
-- Returns {ok:true, idempotent, top_up_id, credits, balance_after} or
-- {ok:false, code[, flagged:true]} with code TOP_UP_NOT_FOUND,
-- INVALID_ORDER_ID, ORDER_ALREADY_USED, VARIANT_MISMATCH, AMOUNT_MISMATCH,
-- CURRENCY_MISMATCH or ALREADY_CREDITED. `flagged` means the order is in
-- top_up_flagged_orders (idempotent on order id).
--
-- The caller has already re-fetched the order from LemonSqueezy and checked
-- it is paid; p_paid_usd_cents is its pre-tax amount.
CREATE OR REPLACE FUNCTION public.credit_top_up(
    p_top_up_id UUID,
    p_order_id TEXT,
    p_paid_usd_cents INTEGER,
    p_currency TEXT,
    p_variant_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_top_up public.top_ups%ROWTYPE;
    v_code TEXT;
    v_grant JSONB;
    v_balance INTEGER;
BEGIN
    IF p_order_id IS NULL OR p_order_id !~ '^[0-9]{1,20}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ORDER_ID');
    END IF;

    SELECT * INTO v_top_up FROM public.top_ups t WHERE t.id = p_top_up_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TOP_UP_NOT_FOUND');
    END IF;

    -- One order carries one Top-up id in its custom data, so an order already
    -- credited to another Top-up is not a real delivery: refuse, never flag
    -- (flagging would queue a legitimately credited order for refund).
    IF EXISTS (SELECT 1 FROM public.top_ups t WHERE t.order_id = p_order_id AND t.id <> v_top_up.id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ORDER_ALREADY_USED');
    END IF;

    IF v_top_up.status = 'credited' THEN
        IF v_top_up.order_id = p_order_id THEN
            SELECT b.balance INTO v_balance FROM public.credit_balances b WHERE b.user_id = v_top_up.user_id;
            RETURN jsonb_build_object('ok', true, 'idempotent', true, 'top_up_id', v_top_up.id,
                                      'credits', v_top_up.credits, 'balance_after', v_balance);
        END IF;
        v_code := 'ALREADY_CREDITED';
    ELSIF p_variant_id IS DISTINCT FROM v_top_up.variant_id THEN
        v_code := 'VARIANT_MISMATCH';
    ELSIF p_paid_usd_cents IS DISTINCT FROM v_top_up.price_usd_cents THEN
        v_code := 'AMOUNT_MISMATCH';
    ELSIF p_currency IS DISTINCT FROM 'USD' THEN
        v_code := 'CURRENCY_MISMATCH';
    END IF;

    IF v_code IS NOT NULL THEN
        INSERT INTO public.top_up_flagged_orders (order_id, top_up_id, user_id, reason, paid_usd_cents, currency, variant_id)
        VALUES (p_order_id, v_top_up.id, v_top_up.user_id, lower(v_code), p_paid_usd_cents,
                left(p_currency, 8), left(p_variant_id, 20))
        ON CONFLICT (order_id) DO NOTHING;
        RETURN jsonb_build_object('ok', false, 'code', v_code, 'flagged', true);
    END IF;

    v_grant := public.ledger_grant(v_top_up.user_id, v_top_up.credits, 'grant:topup');
    IF (v_grant->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'credit_top_up: ledger_grant refused (%)', v_grant->>'code';
    END IF;

    UPDATE public.top_ups
    SET status = 'credited', order_id = p_order_id, credited_at = now(),
        grant_entry_id = (v_grant->>'entry_id')::uuid
    WHERE id = v_top_up.id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'top_up_id', v_top_up.id,
                              'credits', v_top_up.credits, 'balance_after', (v_grant->>'balance_after')::int);
END $$;

-- read_top_up: the caller's own Top-up, by the middleware-verified auth id.
-- Returns {ok:true, top_up:{id, status, credits, price_usd_cents, created_at,
-- credited_at}} or {ok:false, code:'TOP_UP_NOT_FOUND'} (also for another
-- user's Top-up, so ids can't be probed).
CREATE OR REPLACE FUNCTION public.read_top_up(
    p_auth_id TEXT,
    p_top_up_id UUID
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        (SELECT jsonb_build_object('ok', true, 'top_up', jsonb_build_object(
                    'id', t.id, 'status', t.status, 'credits', t.credits,
                    'price_usd_cents', t.price_usd_cents,
                    'created_at', t.created_at, 'credited_at', t.credited_at))
         FROM public.top_ups t
         JOIN public.users u ON u.id = t.user_id
         WHERE t.id = p_top_up_id AND u.auth_id = p_auth_id),
        jsonb_build_object('ok', false, 'code', 'TOP_UP_NOT_FOUND')
    );
$$;

REVOKE ALL ON FUNCTION public.credit_top_up(UUID, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_top_up(UUID, TEXT, INTEGER, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.read_top_up(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_top_up(TEXT, UUID) TO service_role;
