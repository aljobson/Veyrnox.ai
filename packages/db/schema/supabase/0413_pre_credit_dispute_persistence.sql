-- Persist a dispute that arrives before its Top-up is credited (assessment
-- F-06, ADR-0307).
--
-- Stripe does not order deliveries, so charge.dispute.created can arrive before
-- the checkout.session.completed that credits the charge. apply_dispute_event
-- (0098) finds the Top-up by order_id (the PaymentIntent), which is only set
-- when credit_top_up credits it, so a pre-credit dispute returns
-- TOP_UP_NOT_FOUND. The webhook retried only while the event was "young"
-- (1 hour) and then marked it processed, discarding it. A delayed-settlement
-- payment (ACH/bank debit) that credits after that window then granted the pack
-- with no Freeze and no account_actions row — the disputing account kept
-- spendable credits.
--
-- Fix: persist the unresolved dispute by payment identity (the PaymentIntent),
-- and apply it atomically when credit_top_up credits that order — Freezing the
-- account exactly as an in-order dispute would (apply_dispute_event 'created'),
-- in the same transaction as the grant. Event age no longer decides anything.
--
-- Scope: this matches the established in-order dispute behaviour, which Freezes
-- (and logs) but does not claw credits back — the Operator resolves the money
-- once an account is Frozen. A pre-credit dispute now behaves identically
-- instead of being silently dropped. The ordinary refund path
-- (apply_top_up_refund) already retries NOT_CREDITED_YET until the credit
-- lands, so only the dispute half needed this.
--
-- top_up_pending_disputes is keyed by the PaymentIntent, not by a user, so it
-- has no foreign key to users and needs no account-deletion classification; a
-- row is consumed (deleted) when its credit lands. Idempotent (CREATE TABLE IF
-- NOT EXISTS, CREATE OR REPLACE), no catalog UPDATE. The credit path only ever
-- adds a Freeze it would otherwise have missed, never withholds a grant or a
-- refund, so it keeps the previous release working under Worker-only rollback.

CREATE TABLE IF NOT EXISTS public.top_up_pending_disputes (
    order_id  TEXT PRIMARY KEY CHECK (order_id ~ '^[A-Za-z0-9_]{1,64}$'),
    reference TEXT,
    noted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.top_up_pending_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.top_up_pending_disputes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.top_up_pending_disputes FROM PUBLIC, anon, authenticated, service_role;

-- Record a dispute whose Top-up is not credited yet, by PaymentIntent. The
-- webhook calls this only after apply_dispute_event returned TOP_UP_NOT_FOUND
-- and the charge is not a Cinema Pass invoice.
CREATE OR REPLACE FUNCTION public.note_top_up_dispute(p_order_id TEXT, p_reference TEXT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9_]{1,64}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ORDER_ID');
    END IF;
    -- A dispute for an already-credited order must be applied in-order, not
    -- parked here; the caller reaches this RPC only on TOP_UP_NOT_FOUND, so a
    -- credited row cannot occur, but guard it so a stray call cannot hide a
    -- real dispute behind a pending row nothing consumes.
    IF EXISTS (SELECT 1 FROM public.top_ups t WHERE t.order_id = p_order_id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_CREDITED');
    END IF;
    INSERT INTO public.top_up_pending_disputes (order_id, reference)
    VALUES (p_order_id, left(COALESCE(p_reference, ''), 64))
    ON CONFLICT (order_id) DO NOTHING;
    RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.note_top_up_dispute(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.note_top_up_dispute(TEXT, TEXT) TO service_role;

-- credit_top_up: 0097 body, with one addition — when the credit lands, apply
-- any dispute persisted for this PaymentIntent (Freeze + consume the row),
-- atomically with the grant. Everything else is byte-for-byte 0097.
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
    v_disputed BOOLEAN := false;
BEGIN
    IF p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9_]{1,64}$' THEN
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
    -- NULL means the provider has no variant to check (Stripe). A variant the
    -- caller DID name must still match the one the Top-up was started on.
    ELSIF p_variant_id IS NOT NULL AND p_variant_id IS DISTINCT FROM v_top_up.variant_id THEN
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

    -- F-06: a dispute may have arrived before this credit and been persisted by
    -- PaymentIntent. Apply it now, in this same transaction, so the disputed
    -- account is Frozen exactly as an in-order dispute would (0098), instead of
    -- the credit landing unflagged. The pending row is consumed.
    IF EXISTS (SELECT 1 FROM public.top_up_pending_disputes d WHERE d.order_id = p_order_id) THEN
        PERFORM public.freeze_account(v_top_up.user_id,
            left(format('Card dispute on order %s (arrived before credit)', p_order_id), 500),
            v_top_up.id);
        DELETE FROM public.top_up_pending_disputes d WHERE d.order_id = p_order_id;
        v_disputed := true;
    END IF;

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'top_up_id', v_top_up.id,
                              'credits', v_top_up.credits, 'balance_after', (v_grant->>'balance_after')::int,
                              'disputed', v_disputed);
END $$;

REVOKE ALL ON FUNCTION public.credit_top_up(UUID, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_top_up(UUID, TEXT, INTEGER, TEXT, TEXT) TO service_role;
