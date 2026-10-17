-- 0344: Credit Packs sold through the Apple and Google stores (ADR-0108).
--
-- What changes
--   credit_packs   sales_channel may also be 'ios' or 'android'; store packs
--                  carry the store's product id; the net-of-fee floor gets a
--                  30% store-fee branch (the Small Business rate of 15% only
--                  makes it safer). Nothing is inserted: pack credits and
--                  prices are a pricing decision and start inactive/absent.
--   create_pending_top_up   now refuses a pack that is not a web pack, so the
--                  Stripe checkout route can never sell a store pack.
--   store_order_id          the one place a store transaction id becomes our
--                  order id: 'st_' + 48 hex of sha256(channel:transaction).
--                  Store ids contain '-' and '.', which top_ups.order_id does
--                  not allow, and a fixed-length hash keeps them opaque.
--   store_customers         the RevenueCat customer id of each account: a random
--                  UUID only that account's signed-in app is ever told. RevenueCat's
--                  app_user_id is chosen by the client, so using the Supabase id
--                  would let anyone buy under someone else's id and later refund it
--                  against them. A secret id closes that: an event can only name an
--                  account whose secret the buyer already holds.
--   credit_store_purchase   a purchase event, verified by its HMAC signature,
--                  becomes a credited top_ups row and a 'grant:topup' ledger
--                  entry (ledger_grant) for the account that owns the customer
--                  id, atomically and idempotently on the transaction. A pack
--                  retired after the purchase still credits: the money is
--                  already taken.
--   apply_store_refund      a store refund is a full refund of that top-up
--                  through apply_top_up_refund (clawback capped at the paid
--                  balance, Freeze rules unchanged).
--
-- Unchanged: credit_top_up and Stripe paths, the ledger, reconcile_top_ups
-- (store rows are credited rows with a grant entry, like web rows).
--
-- Idempotent: constraints are dropped and re-added, functions are OR REPLACE.

BEGIN;

ALTER TABLE public.credit_packs DROP CONSTRAINT IF EXISTS credit_packs_sales_channel_check;
ALTER TABLE public.credit_packs DROP CONSTRAINT IF EXISTS credit_packs_sales_channel_known;
ALTER TABLE public.credit_packs ADD CONSTRAINT credit_packs_sales_channel_known
    CHECK (sales_channel IN ('web', 'ios', 'android'));

ALTER TABLE public.credit_packs ADD COLUMN IF NOT EXISTS store_product_id TEXT NULL;

ALTER TABLE public.credit_packs DROP CONSTRAINT IF EXISTS credit_packs_store_product_shape;
ALTER TABLE public.credit_packs ADD CONSTRAINT credit_packs_store_product_shape CHECK (
    (sales_channel = 'web' AND store_product_id IS NULL)
    OR (sales_channel IN ('ios', 'android') AND store_product_id IS NOT NULL
        AND store_product_id ~ '^[A-Za-z0-9._-]{1,128}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_packs_store_product_key
    ON public.credit_packs (sales_channel, store_product_id) WHERE store_product_id IS NOT NULL;

-- Net >= $0.033 per credit. Store: price * (1 - 0.30), no flat fee, in 1/100000 cent.
ALTER TABLE public.credit_packs DROP CONSTRAINT IF EXISTS credit_packs_net_floor;
ALTER TABLE public.credit_packs ADD CONSTRAINT credit_packs_net_floor CHECK (
    CASE sales_channel
        WHEN 'web' THEN price_usd_cents::bigint * 91745 - 5000000 >= credits::bigint * 330000
        WHEN 'ios' THEN price_usd_cents::bigint * 70000 >= credits::bigint * 330000
        WHEN 'android' THEN price_usd_cents::bigint * 70000 >= credits::bigint * 330000
        ELSE false
    END
);
COMMENT ON CONSTRAINT credit_packs_net_floor ON public.credit_packs IS
    'Net >= $0.033/credit. web: 8.255% + 50c (0041, stricter than Stripe). ios/android: 30% store fee (0344, ADR-0108).';

-- Web only: store packs are bought through credit_store_purchase, never through Stripe checkout.
CREATE OR REPLACE FUNCTION public.create_pending_top_up(
    p_auth_id TEXT,
    p_pack_id TEXT,
    p_idempotency_key TEXT,
    p_consent_version TEXT,
    p_limit_per_window INTEGER,
    p_window_seconds INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_frozen BOOLEAN;
    v_pack public.credit_packs%ROWTYPE;
    v_count INTEGER;
    v_retry INTEGER;
    v_top_up_id UUID;
    v_existing public.top_ups%ROWTYPE;
BEGIN
    IF p_limit_per_window IS NULL OR p_limit_per_window <= 0
       OR p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_LIMIT');
    END IF;

    SELECT u.id, u.frozen_at IS NOT NULL INTO v_user_id, v_frozen FROM public.users u
    WHERE u.auth_id = p_auth_id
    FOR NO KEY UPDATE;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    IF v_frozen THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;

    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED');
    END IF;

    SELECT * INTO v_existing FROM public.top_ups t
    WHERE t.user_id = v_user_id AND t.idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_existing.pack_id <> p_pack_id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
        END IF;
        RETURN jsonb_build_object(
            'ok', true,
            'idempotent', true,
            'top_up_id', v_existing.id,
            'credits', v_existing.credits,
            'price_usd_cents', v_existing.price_usd_cents,
            'variant_id', v_existing.variant_id
        );
    END IF;

    IF p_consent_version IS NULL OR p_consent_version !~ '^[A-Za-z0-9._-]{1,32}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CONSENT_VERSION_REQUIRED');
    END IF;

    SELECT * INTO v_pack FROM public.credit_packs p
    WHERE p.id = p_pack_id AND p.active AND p.sales_channel = 'web';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PACK_NOT_FOUND');
    END IF;

    SELECT count(*) INTO v_count FROM public.top_ups t
    WHERE t.user_id = v_user_id
      AND t.created_at > now() - make_interval(secs => p_window_seconds);
    IF v_count >= p_limit_per_window THEN
        SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
            min(t.created_at) + make_interval(secs => p_window_seconds) - now()
        ))))::int INTO v_retry
        FROM public.top_ups t
        WHERE t.user_id = v_user_id
          AND t.created_at > now() - make_interval(secs => p_window_seconds);
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
            'retry_after_seconds', COALESCE(v_retry, p_window_seconds));
    END IF;

    INSERT INTO public.top_ups (user_id, pack_id, idempotency_key, sales_channel, credits,
                                price_usd_cents, variant_id, consent_at, consent_version)
    VALUES (v_user_id, v_pack.id, p_idempotency_key, v_pack.sales_channel, v_pack.credits,
            v_pack.price_usd_cents, v_pack.variant_id, now(), p_consent_version)
    RETURNING id INTO v_top_up_id;

    RETURN jsonb_build_object(
        'ok', true,
        'idempotent', false,
        'top_up_id', v_top_up_id,
        'credits', v_pack.credits,
        'price_usd_cents', v_pack.price_usd_cents,
        'variant_id', v_pack.variant_id
    );
END $$;

REVOKE ALL ON FUNCTION public.create_pending_top_up(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_pending_top_up(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.create_pending_top_up(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_pending_top_up(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO service_role;

CREATE TABLE IF NOT EXISTS public.store_customers (
    user_id         UUID        PRIMARY KEY REFERENCES public.users(id) ON DELETE RESTRICT,
    rc_customer_id  UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.store_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_customers FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.store_customers FROM PUBLIC, anon, authenticated;

-- Returns {ok:true, rc_customer_id} (created on first call, stable after) or
-- {ok:false, code:'USER_NOT_FOUND'}.
CREATE OR REPLACE FUNCTION public.get_or_create_store_customer(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_customer UUID;
BEGIN
    SELECT u.id INTO v_user_id FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    INSERT INTO public.store_customers (user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
    SELECT sc.rc_customer_id INTO v_customer FROM public.store_customers sc WHERE sc.user_id = v_user_id;
    RETURN jsonb_build_object('ok', true, 'rc_customer_id', v_customer);
END $$;

REVOKE ALL ON FUNCTION public.get_or_create_store_customer(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_or_create_store_customer(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.get_or_create_store_customer(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_store_customer(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.store_order_id(p_channel TEXT, p_transaction_id TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT 'st_' || substr(encode(sha256(convert_to(p_channel || ':' || p_transaction_id, 'UTF8')), 'hex'), 1, 48)
$$;

REVOKE ALL ON FUNCTION public.store_order_id(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.store_order_id(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.store_order_id(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.store_order_id(TEXT, TEXT) TO service_role;

-- The first argument is the RevenueCat customer id, not an account id (renamed before any deploy).
DROP FUNCTION IF EXISTS public.credit_store_purchase(TEXT, TEXT, TEXT, TEXT);

-- Returns {ok:true, idempotent, top_up_id, credits, balance_after} or {ok:false, code}
-- with code BAD_CHANNEL, INVALID_TRANSACTION_ID, INVALID_PRODUCT, CUSTOMER_NOT_FOUND,
-- ORDER_ALREADY_USED (the transaction was credited to another account) or PACK_NOT_FOUND.
CREATE OR REPLACE FUNCTION public.credit_store_purchase(
    p_rc_customer_id TEXT,
    p_channel TEXT,
    p_store_product_id TEXT,
    p_transaction_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_pack public.credit_packs%ROWTYPE;
    v_order TEXT;
    v_top_up public.top_ups%ROWTYPE;
    v_top_up_id UUID;
    v_grant JSONB;
    v_balance INTEGER;
BEGIN
    IF p_channel IS NULL OR p_channel NOT IN ('ios', 'android') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_CHANNEL');
    END IF;
    IF p_transaction_id IS NULL OR length(p_transaction_id) NOT BETWEEN 1 AND 200 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSACTION_ID');
    END IF;
    IF p_store_product_id IS NULL OR p_store_product_id !~ '^[A-Za-z0-9._-]{1,128}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_PRODUCT');
    END IF;

    IF p_rc_customer_id IS NULL OR p_rc_customer_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CUSTOMER_NOT_FOUND');
    END IF;
    SELECT sc.user_id INTO v_user_id FROM public.store_customers sc WHERE sc.rc_customer_id = p_rc_customer_id::uuid;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CUSTOMER_NOT_FOUND');
    END IF;
    PERFORM 1 FROM public.users u WHERE u.id = v_user_id FOR NO KEY UPDATE;

    v_order := public.store_order_id(p_channel, p_transaction_id);
    PERFORM pg_advisory_xact_lock(hashtextextended(v_order, 0));

    SELECT * INTO v_top_up FROM public.top_ups t WHERE t.order_id = v_order;
    IF FOUND THEN
        IF v_top_up.user_id <> v_user_id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'ORDER_ALREADY_USED');
        END IF;
        SELECT b.balance INTO v_balance FROM public.credit_balances b WHERE b.user_id = v_user_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'top_up_id', v_top_up.id,
                                  'credits', v_top_up.credits, 'balance_after', v_balance);
    END IF;

    -- Not filtered on active: a pack retired after this purchase was made still credits it.
    SELECT * INTO v_pack FROM public.credit_packs p
    WHERE p.sales_channel = p_channel AND p.store_product_id = p_store_product_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PACK_NOT_FOUND');
    END IF;

    INSERT INTO public.top_ups (user_id, pack_id, idempotency_key, sales_channel, credits,
                                price_usd_cents, variant_id, consent_at, consent_version)
    VALUES (v_user_id, v_pack.id, v_order, p_channel, v_pack.credits,
            v_pack.price_usd_cents, NULL, now(), 'store-purchase-v1')
    RETURNING id INTO v_top_up_id;

    v_grant := public.ledger_grant(v_user_id, v_pack.credits, 'grant:topup');
    IF (v_grant->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'credit_store_purchase: ledger_grant refused (%)', v_grant->>'code';
    END IF;

    UPDATE public.top_ups
    SET status = 'credited', order_id = v_order, credited_at = now(),
        grant_entry_id = (v_grant->>'entry_id')::uuid
    WHERE id = v_top_up_id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'top_up_id', v_top_up_id,
                              'credits', v_pack.credits, 'balance_after', (v_grant->>'balance_after')::int);
END $$;

REVOKE ALL ON FUNCTION public.credit_store_purchase(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.credit_store_purchase(TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.credit_store_purchase(TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.credit_store_purchase(TEXT, TEXT, TEXT, TEXT) TO service_role;

-- A full refund of the top-up the transaction credited. Same verdicts as apply_top_up_refund,
-- plus ORDER_NOT_FOUND when we never credited the transaction.
CREATE OR REPLACE FUNCTION public.apply_store_refund(p_channel TEXT, p_transaction_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_order TEXT;
    v_top_up public.top_ups%ROWTYPE;
BEGIN
    IF p_channel IS NULL OR p_channel NOT IN ('ios', 'android') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_CHANNEL');
    END IF;
    IF p_transaction_id IS NULL OR length(p_transaction_id) NOT BETWEEN 1 AND 200 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSACTION_ID');
    END IF;
    v_order := public.store_order_id(p_channel, p_transaction_id);
    SELECT * INTO v_top_up FROM public.top_ups t WHERE t.order_id = v_order;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
    END IF;
    RETURN public.apply_top_up_refund(v_order, v_top_up.price_usd_cents::bigint, v_top_up.price_usd_cents::bigint, v_top_up.id);
END $$;

REVOKE ALL ON FUNCTION public.apply_store_refund(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_store_refund(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.apply_store_refund(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_store_refund(TEXT, TEXT) TO service_role;

COMMIT;
