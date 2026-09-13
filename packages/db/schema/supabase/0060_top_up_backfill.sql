-- Backfill Top-ups whose webhook was missed (#94, ADR-0018 decision 5).
-- Applied name: 0060_top_up_backfill.
--
-- LemonSqueezy's order API has no custom data and no filter for it, so an
-- order can't be found from a Top-up id. The checkout return URL carries
-- LemonSqueezy's [order_id] and [order_identifier] link variables, and the
-- return page records them on the buyer's own pending Top-up. The backfill
-- (POST /api/admin/top-up-backfill) re-fetches that order and only credits
-- it if the order's identifier, an unguessable UUID, matches.
--
-- top_ups gains    return_order_id          order id the buyer came back with
--                  return_order_identifier  that order's identifier
--                  returned_at              when it was (last changed and) recorded
--                  backfill_attempts        checks since then
--                  backfill_checked_at      last check
--
-- None of these credit anything: credit_top_up (0054) stays the only path,
-- keyed on the Top-up row, so the backfill racing the webhook grants once.
--
-- record_top_up_return       caller-scoped writer for the return page.
-- next_top_up_backfill_batch hands out due rows: pending, returned more than
--                  10 minutes ago, created less than 7 days ago. Each hand-out
--                  backs the row off (5, 10, 20 ... capped at 360 minutes),
--                  and SKIP LOCKED keeps concurrent runs apart.
--
-- No browser access: service_role only.

ALTER TABLE public.top_ups ADD COLUMN IF NOT EXISTS return_order_id         TEXT        NULL;
ALTER TABLE public.top_ups ADD COLUMN IF NOT EXISTS return_order_identifier UUID        NULL;
ALTER TABLE public.top_ups ADD COLUMN IF NOT EXISTS returned_at             TIMESTAMPTZ NULL;
ALTER TABLE public.top_ups ADD COLUMN IF NOT EXISTS backfill_attempts       INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE public.top_ups ADD COLUMN IF NOT EXISTS backfill_checked_at     TIMESTAMPTZ NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'top_ups_return_order_id_format') THEN
        ALTER TABLE public.top_ups ADD CONSTRAINT top_ups_return_order_id_format
            CHECK (return_order_id IS NULL OR return_order_id ~ '^[0-9]{1,20}$');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS top_ups_backfill_due_idx ON public.top_ups (returned_at)
    WHERE status = 'pending' AND return_order_id IS NOT NULL;

-- record_top_up_return
--
-- Returns {ok:true} or {ok:false, code} with code INVALID_ORDER_ID,
-- INVALID_ORDER_IDENTIFIER or TOP_UP_NOT_FOUND (also for another user's
-- Top-up). A credited Top-up is left alone. Recording the same values again
-- (a reload of the return page) changes nothing, so it can't postpone the
-- backfill; different values restart the 10-minute wait.
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
BEGIN
    IF p_order_id IS NULL OR p_order_id !~ '^[0-9]{1,20}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ORDER_ID');
    END IF;
    IF p_order_identifier IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ORDER_IDENTIFIER');
    END IF;

    SELECT t.id, t.status INTO v_id, v_status
    FROM public.top_ups t
    JOIN public.users u ON u.id = t.user_id
    WHERE t.id = p_top_up_id AND u.auth_id = p_auth_id
    FOR UPDATE OF t;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TOP_UP_NOT_FOUND');
    END IF;

    IF v_status = 'pending' THEN
        UPDATE public.top_ups
        SET return_order_id = p_order_id, return_order_identifier = p_order_identifier,
            returned_at = now(), backfill_attempts = 0, backfill_checked_at = NULL
        WHERE id = v_id
          AND (return_order_id IS DISTINCT FROM p_order_id
               OR return_order_identifier IS DISTINCT FROM p_order_identifier);
    END IF;

    RETURN jsonb_build_object('ok', true);
END $$;

-- next_top_up_backfill_batch: up to p_limit (1..100) due Top-ups, marked
-- checked as they are handed out. A row whose check failed transiently is
-- simply due again after its backoff.
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
        WHERE t.status = 'pending'
          AND t.return_order_id IS NOT NULL
          AND t.return_order_identifier IS NOT NULL
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

REVOKE ALL ON FUNCTION public.record_top_up_return(TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_top_up_return(TEXT, UUID, TEXT, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.next_top_up_backfill_batch(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_top_up_backfill_batch(INTEGER) TO service_role;
