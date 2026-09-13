-- Credit a backfilled order and claw back any refund in one transaction (#142).
-- Applied name: 0063_credit_top_up_with_refund.
-- Numbered 0063: 0062 is the Freeze credits-taken fix (#141); 0061 was never
-- used, and taking it would sort before a migration production already ran.
--
-- The webhook credits paid, refunded and partly refunded orders, then calls
-- apply_top_up_refund for the re-fetched refunded amount. If that second call
-- fails, LemonSqueezy redelivers the event and both run again. The backfill
-- has no redelivery: once credit_top_up marks the Top-up credited, it leaves
-- the backfill queue, so a failed clawback after it would never be retried.
-- This wrapper does both in one transaction instead. A clawback that can't be
-- applied raises, rolling the grant back, and the Top-up stays pending for
-- the next run.
--
-- credit_top_up_with_refund
--   Returns credit_top_up's result. When it is ok and p_refunded_cents > 0,
--   the result gains `refund`: apply_top_up_refund's result (idempotent on the
--   cumulative amount, so the webhook having applied it already changes
--   nothing). A flagged or refused credit returns as-is, with no refund call.
--
-- Service_role only. Both inner functions are SECURITY DEFINER with the same
-- owner, so their own checks, locks and the inferred Freeze apply unchanged.

CREATE OR REPLACE FUNCTION public.credit_top_up_with_refund(
    p_top_up_id UUID,
    p_order_id TEXT,
    p_paid_usd_cents INTEGER,
    p_currency TEXT,
    p_variant_id TEXT,
    p_refunded_cents BIGINT,
    p_total_cents BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_credit JSONB;
    v_refund JSONB;
BEGIN
    v_credit := public.credit_top_up(p_top_up_id, p_order_id, p_paid_usd_cents, p_currency, p_variant_id);
    IF (v_credit->>'ok')::boolean IS NOT TRUE OR COALESCE(p_refunded_cents, 0) <= 0 THEN
        RETURN v_credit;
    END IF;

    v_refund := public.apply_top_up_refund(p_order_id, p_refunded_cents, p_total_cents, p_top_up_id);
    IF (v_refund->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'credit_top_up_with_refund: apply_top_up_refund refused (%) for order %',
            v_refund->>'code', p_order_id;
    END IF;

    RETURN v_credit || jsonb_build_object('refund', v_refund);
END $$;

REVOKE ALL ON FUNCTION public.credit_top_up_with_refund(UUID, TEXT, INTEGER, TEXT, TEXT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_top_up_with_refund(UUID, TEXT, INTEGER, TEXT, TEXT, BIGINT, BIGINT) TO service_role;
