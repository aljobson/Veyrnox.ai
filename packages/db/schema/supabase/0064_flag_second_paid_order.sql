-- Flag a second paid order on a credited Top-up even when its webhook is lost (#143).
-- Applied name: 0064_flag_second_paid_order.
--
-- A replayed buy request opens a second checkout for the same Top-up, so two
-- paid orders can name it. credit_top_up (0054) credits the first and flags
-- the rest for an Operator refund, but only when each order's webhook reaches
-- it. Before this migration, if order A came back through the return URL and
-- its webhook was lost while order B's webhook credited the Top-up:
--   - next_top_up_backfill_batch (0060) handed out pending rows only, so A was
--     never re-fetched;
--   - record_top_up_return ignored credited Top-ups, so a later return from A
--     was dropped too.
-- A was charged, not credited, and not flagged.
--
-- top_ups gains    return_closed_at  set once a check of the returned order
--                  reached a final answer; the backfill skips the row after.
--
-- record_top_up_return  also records on a credited Top-up, unless the returned
--                  order is the one that credited it. New values reopen a
--                  closed return.
-- next_top_up_backfill_batch  also hands out credited Top-ups whose returned
--                  order differs from the crediting order, and skips any row
--                  whose returned order is closed or already flagged. The
--                  backfill's credit call then gets ALREADY_CREDITED, which
--                  writes the flag, and never grants.
-- close_top_up_return  called by the backfill after a final answer (flagged,
--                  refused, not creditable, not found). Only closes the
--                  return it checked, so a newer return stays open.
--
-- Same signatures as 0060, so re-applying 0060 stays valid. Service_role only.

ALTER TABLE public.top_ups ADD COLUMN IF NOT EXISTS return_closed_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS top_ups_backfill_open_idx ON public.top_ups (returned_at)
    WHERE return_order_id IS NOT NULL AND return_closed_at IS NULL;

CREATE OR REPLACE FUNCTION public.record_top_up_return(
    p_auth_id TEXT,
    p_top_up_id UUID,
    p_order_id TEXT,
    p_order_identifier UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id UUID;
    v_status TEXT;
    v_credited_order TEXT;
BEGIN
    IF p_order_id IS NULL OR p_order_id !~ '^[0-9]{1,20}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ORDER_ID');
    END IF;
    IF p_order_identifier IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ORDER_IDENTIFIER');
    END IF;

    SELECT t.id, t.status, t.order_id INTO v_id, v_status, v_credited_order
    FROM public.top_ups t
    JOIN public.users u ON u.id = t.user_id
    WHERE t.id = p_top_up_id AND u.auth_id = p_auth_id
    FOR UPDATE OF t;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TOP_UP_NOT_FOUND');
    END IF;

    -- The order that credited the Top-up has nothing left to check.
    IF v_status = 'pending' OR p_order_id IS DISTINCT FROM v_credited_order THEN
        UPDATE public.top_ups
        SET return_order_id = p_order_id, return_order_identifier = p_order_identifier,
            returned_at = now(), backfill_attempts = 0, backfill_checked_at = NULL,
            return_closed_at = NULL
        WHERE id = v_id
          AND (return_order_id IS DISTINCT FROM p_order_id
               OR return_order_identifier IS DISTINCT FROM p_order_identifier);
    END IF;

    RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.next_top_up_backfill_batch(
    p_limit INTEGER
) RETURNS TABLE (top_up_id UUID, order_id TEXT, order_identifier UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH due AS (
        SELECT t.id
        FROM public.top_ups t
        WHERE (t.status = 'pending'
               OR (t.status = 'credited' AND t.return_order_id IS DISTINCT FROM t.order_id))
          AND t.return_order_id IS NOT NULL
          AND t.return_order_identifier IS NOT NULL
          AND t.return_closed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.top_up_flagged_orders f WHERE f.order_id = t.return_order_id)
          AND t.returned_at <= now() - interval '10 minutes'
          AND t.created_at > now() - interval '7 days'
          AND (t.backfill_checked_at IS NULL
               OR t.backfill_checked_at <= now() - make_interval(
                      mins => least(5 * (1 << least(greatest(t.backfill_attempts - 1, 0), 10)), 360)))
        ORDER BY t.backfill_checked_at NULLS FIRST, t.returned_at
        LIMIT least(greatest(COALESCE(p_limit, 1), 1), 100)
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.top_ups t
    SET backfill_checked_at = now(), backfill_attempts = t.backfill_attempts + 1
    FROM due
    WHERE t.id = due.id
    RETURNING t.id, t.return_order_id, t.return_order_identifier;
$$;

-- close_top_up_return: {ok:true} or {ok:false, code:'NOT_CURRENT'} when the
-- Top-up's return has since changed (or never matched), so a check of an older
-- return can't close a newer one.
CREATE OR REPLACE FUNCTION public.close_top_up_return(
    p_top_up_id UUID,
    p_order_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.top_ups
    SET return_closed_at = COALESCE(return_closed_at, now())
    WHERE id = p_top_up_id AND return_order_id = p_order_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_CURRENT');
    END IF;
    RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.record_top_up_return(TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_top_up_return(TEXT, UUID, TEXT, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.next_top_up_backfill_batch(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_top_up_backfill_batch(INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.close_top_up_return(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_top_up_return(UUID, TEXT) TO service_role;
