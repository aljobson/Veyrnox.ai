-- Record a Top-up's LemonSqueezy order from the checkout redirect, so the
-- backfill can credit it when the webhook is lost (#94, ADR-0018 decision 5).
-- Applied name: 0060_top_up_checkout_order.
-- Numbered 0060: 0058 is the refund clawback (#96), 0059 the chargeback
-- freeze (#97).
--
-- Why a redirect: LemonSqueezy's API order object carries no custom data and
-- no checkout id, and GET /v1/orders filters only by store, email and order
-- number, so the API cannot map a Top-up to its order. The checkout's
-- redirect URL carries the link variables [order_id] and [order_identifier];
-- the return page posts them back, and the route re-fetches the order and
-- checks the secret identifier before calling this function. A guessed
-- numeric order id alone never reaches here.
--
-- top_ups.checkout_order_id  the order captured on return, unique. Separate
--                            from order_id, which credit_top_up sets when it
--                            grants; the backfill passes this one to
--                            credit_top_up, which stays the only granter.
--
-- record_top_up_order is the only writer. It scopes by the verified auth id,
-- locks the Top-up row, keeps the first captured order, refuses an order that
-- belongs to another Top-up, and refuses a variant, pre-tax amount or currency
-- that differs from the row. Nothing is granted here.
--
-- No browser access: service_role only.

ALTER TABLE public.top_ups ADD COLUMN IF NOT EXISTS checkout_order_id TEXT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'top_ups_checkout_order_id_key') THEN
        ALTER TABLE public.top_ups ADD CONSTRAINT top_ups_checkout_order_id_key UNIQUE (checkout_order_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'top_ups_checkout_order_id_format') THEN
        ALTER TABLE public.top_ups ADD CONSTRAINT top_ups_checkout_order_id_format
            CHECK (checkout_order_id IS NULL OR checkout_order_id ~ '^[0-9]{1,20}$');
    END IF;
END $$;

-- The backfill's scan: pending Top-ups that have a captured order.
CREATE INDEX IF NOT EXISTS top_ups_backfill_idx ON public.top_ups (created_at)
    WHERE status = 'pending' AND checkout_order_id IS NOT NULL;

-- record_top_up_order
--
-- Returns {ok:true, idempotent} or {ok:false, code} with code INVALID_ORDER_ID,
-- TOP_UP_NOT_FOUND (also for another user's Top-up), ORDER_ALREADY_RECORDED,
-- ALREADY_CREDITED, ORDER_ALREADY_USED, VARIANT_MISMATCH, AMOUNT_MISMATCH or
-- CURRENCY_MISMATCH.
--
-- The caller has already re-fetched the order from LemonSqueezy, matched its
-- identifier to the one on the redirect, and checked the mode. p_paid_usd_cents
-- is its pre-tax amount.
CREATE OR REPLACE FUNCTION public.record_top_up_order(
    p_auth_id TEXT,
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
BEGIN
    IF p_order_id IS NULL OR p_order_id !~ '^[0-9]{1,20}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ORDER_ID');
    END IF;

    SELECT t.* INTO v_top_up
    FROM public.top_ups t
    JOIN public.users u ON u.id = t.user_id
    WHERE t.id = p_top_up_id AND u.auth_id = p_auth_id
    FOR UPDATE OF t;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TOP_UP_NOT_FOUND');
    END IF;

    IF v_top_up.checkout_order_id = p_order_id
       OR (v_top_up.status = 'credited' AND v_top_up.order_id = p_order_id) THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true);
    END IF;
    IF v_top_up.checkout_order_id IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ORDER_ALREADY_RECORDED');
    END IF;
    IF v_top_up.status = 'credited' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_CREDITED');
    END IF;

    IF EXISTS (SELECT 1 FROM public.top_ups t
               WHERE t.id <> v_top_up.id AND (t.order_id = p_order_id OR t.checkout_order_id = p_order_id)) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ORDER_ALREADY_USED');
    END IF;

    IF p_variant_id IS DISTINCT FROM v_top_up.variant_id THEN
        RETURN jsonb_build_object('ok', false, 'code', 'VARIANT_MISMATCH');
    ELSIF p_paid_usd_cents IS DISTINCT FROM v_top_up.price_usd_cents THEN
        RETURN jsonb_build_object('ok', false, 'code', 'AMOUNT_MISMATCH');
    ELSIF p_currency IS DISTINCT FROM 'USD' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CURRENCY_MISMATCH');
    END IF;

    UPDATE public.top_ups SET checkout_order_id = p_order_id WHERE id = v_top_up.id;
    RETURN jsonb_build_object('ok', true, 'idempotent', false);
END $$;

REVOKE ALL ON FUNCTION public.record_top_up_order(TEXT, UUID, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_top_up_order(TEXT, UUID, TEXT, INTEGER, TEXT, TEXT) TO service_role;
