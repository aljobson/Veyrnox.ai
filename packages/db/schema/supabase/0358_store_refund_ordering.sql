-- Audit A05: a refund must survive delivery before its purchase (0344).
-- Store billing remains gated; this migration does not activate it or infer
-- historical refunds already discarded by an older webhook handler.
-- Retain only the channel-bound opaque order hash and receipt time: no customer
-- id, raw store transaction, payload or user FK. Account deletion cannot erase
-- a refund and make a delayed store purchase grant credits again.
BEGIN;

CREATE TABLE IF NOT EXISTS public.store_refund_tombstones (
    order_id TEXT PRIMARY KEY CHECK (order_id ~ '^st_[0-9a-f]{48}$'),
    refunded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.store_refund_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_refund_tombstones FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.store_refund_tombstones FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.store_refund_tombstones_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'store_refund_tombstones is append-only (attempted %)', TG_OP;
END $$;
REVOKE ALL ON FUNCTION public.store_refund_tombstones_append_only() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS store_refund_tombstones_no_mutation ON public.store_refund_tombstones;
CREATE TRIGGER store_refund_tombstones_no_mutation
    BEFORE UPDATE OR DELETE OR TRUNCATE ON public.store_refund_tombstones
    FOR EACH STATEMENT EXECUTE FUNCTION public.store_refund_tombstones_append_only();

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

    -- Both store paths lock the order BEFORE the user, then top-up/balance.
    -- Different transactions for one account must not reverse this order.
    v_order := public.store_order_id(p_channel, p_transaction_id);
    PERFORM pg_advisory_xact_lock(hashtextextended(v_order, 0));
    PERFORM 1 FROM public.users u WHERE u.id = v_user_id FOR NO KEY UPDATE;

    SELECT * INTO v_top_up FROM public.top_ups t WHERE t.order_id = v_order;
    IF FOUND AND v_top_up.user_id <> v_user_id THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ORDER_ALREADY_USED');
    END IF;
    IF EXISTS (SELECT 1 FROM public.store_refund_tombstones r WHERE r.order_id = v_order) THEN
        SELECT b.balance INTO v_balance FROM public.credit_balances b WHERE b.user_id = v_user_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'refunded', true,
                                  'credits', 0, 'balance_after', v_balance);
    END IF;
    IF v_top_up.id IS NOT NULL THEN
        SELECT b.balance INTO v_balance FROM public.credit_balances b WHERE b.user_id = v_user_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'top_up_id', v_top_up.id,
                                  'credits', v_top_up.credits, 'balance_after', v_balance);
    END IF;

    -- As in 0344, retirement after the purchase cannot remove paid entitlement.
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
REVOKE ALL ON FUNCTION public.credit_store_purchase(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_store_purchase(TEXT, TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_store_refund(p_channel TEXT, p_transaction_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_order TEXT;
    v_top_up public.top_ups%ROWTYPE;
    v_inserted INTEGER;
BEGIN
    IF p_channel IS NULL OR p_channel NOT IN ('ios', 'android') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_CHANNEL');
    END IF;
    IF p_transaction_id IS NULL OR length(p_transaction_id) NOT BETWEEN 1 AND 200 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSACTION_ID');
    END IF;
    v_order := public.store_order_id(p_channel, p_transaction_id);
    PERFORM pg_advisory_xact_lock(hashtextextended(v_order, 0));
    INSERT INTO public.store_refund_tombstones (order_id) VALUES (v_order)
    ON CONFLICT (order_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    SELECT * INTO v_top_up FROM public.top_ups t WHERE t.order_id = v_order;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', v_inserted = 0,
                                  'pending_purchase', true, 'taken', 0);
    END IF;
    PERFORM 1 FROM public.users u WHERE u.id = v_top_up.user_id FOR NO KEY UPDATE;
    -- Keep the canonical paid-bucket cap, shortfall/freeze and ledger logic.
    -- Tombstone and clawback commit together or neither commits.
    RETURN public.apply_top_up_refund(v_order, v_top_up.price_usd_cents::bigint, v_top_up.price_usd_cents::bigint, v_top_up.id);
END $$;
REVOKE ALL ON FUNCTION public.apply_store_refund(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_store_refund(TEXT, TEXT) TO service_role;

COMMIT;
