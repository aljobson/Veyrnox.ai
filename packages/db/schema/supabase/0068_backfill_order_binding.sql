-- Bind backfilled orders to the buyer, record collisions, and sweep for second
-- payments whose buyer never came back (#147, #143, ADR-0018 decision 5).
-- Applied name: 0068_backfill_order_binding.
-- Numbered 0068: main has 0064 (#148) and two applied 0066 files (#152, #153);
-- open PR #150 holds 0065 and renumbers 0066_veo_4s_clip_costs to 0067.
--
-- #147  The backfill binds an order to a Top-up only through the order id and
--       identifier the return page recorded, and the identifier travels in a
--       URL. A leaked pair recorded on someone else's pending Top-up of the
--       same pack would credit them, and the victim's order would later be
--       refused as ORDER_ALREADY_USED with no record.
--
--   backfill_credit_top_up   the backfill's crediting path. Refuses
--                  (EMAIL_MISMATCH) unless the re-fetched order's email is the
--                  Top-up owner's, case-insensitive, then calls
--                  credit_top_up_with_refund (0063), so the refunded-order
--                  path is bound too. An ORDER_ALREADY_USED result is written
--                  to top_up_order_collisions. The owner's email is
--                  public.users.email, copied from auth.users at sign-up
--                  (0010); after an auth email change it no longer matches and
--                  the order is left for an Operator, never credited.
--                  The webhook keeps calling credit_top_up: its Top-up id
--                  comes from signed custom data.
--   top_up_order_collisions  append-only. One row per (order, Top-up that
--                  tried to claim it), naming the Top-up that holds it. Never
--                  a grant and never a top_up_flagged_orders row: the order is
--                  credited elsewhere, and a flag would stop its refund
--                  clawback (apply_top_up_refund skips flagged orders).
--   operator_order_collisions(user?, limit)  the Operator read for it, next to
--                  0065's operator_flagged_orders; user matches either side.
--
-- #143  0064 flags a second paid order the buyer came back with. A buyer who
--       never followed the return link left nothing to re-fetch.
--
--   next_top_up_order_sweep_batch  hands out credited Top-ups created 70
--                  minutes, 6 hours, 1 day and 3 days ago (the checkout link
--                  lives 60 minutes), with the owner's email. The route lists
--                  that email's orders in our store and calls
--                  flag_swept_top_up_order for each paid order of the pack
--                  since the Top-up started.
--   flag_swept_top_up_order  flags already_credited only when no Top-up could
--                  still claim the order: not credited to any Top-up, and the
--                  owner has no pending Top-up of that pack started before it
--                  (AMBIGUOUS otherwise, logged for an Operator). It locks
--                  those Top-ups first, as credit_top_up does, so a webhook
--                  crediting one of them concurrently is seen.
--
-- Nothing here grants credits except through credit_top_up. Service_role only.

ALTER TABLE public.top_ups ADD COLUMN IF NOT EXISTS order_sweeps     INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE public.top_ups ADD COLUMN IF NOT EXISTS order_swept_at   TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS top_ups_order_sweep_due_idx ON public.top_ups (created_at)
    WHERE status = 'credited' AND order_sweeps < 4;

CREATE TABLE IF NOT EXISTS public.top_up_order_collisions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            TEXT        NOT NULL CHECK (order_id ~ '^[0-9]{1,20}$'),
    top_up_id           UUID        NOT NULL REFERENCES public.top_ups(id) ON DELETE RESTRICT,
    credited_top_up_id  UUID        NOT NULL REFERENCES public.top_ups(id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id, top_up_id)
);

CREATE OR REPLACE FUNCTION public.top_up_order_collisions_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'top_up_order_collisions is append-only (attempted %)', TG_OP;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                   WHERE tgname = 'top_up_order_collisions_no_update'
                     AND tgrelid = 'public.top_up_order_collisions'::regclass) THEN
        CREATE TRIGGER top_up_order_collisions_no_update
            BEFORE UPDATE OR DELETE ON public.top_up_order_collisions
            FOR EACH ROW EXECUTE FUNCTION public.top_up_order_collisions_append_only();
    END IF;
END $$;

ALTER TABLE public.top_up_order_collisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.top_up_order_collisions FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.top_up_order_collisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.top_up_order_collisions_append_only() FROM PUBLIC, anon, authenticated;

-- p_user_id NULL lists every user's. p_limit is clamped to 1..500. Ids only, as in 0065.
CREATE OR REPLACE FUNCTION public.operator_order_collisions(
    p_user_id UUID,
    p_limit INTEGER
) RETURNS TABLE (
    order_id TEXT, top_up_id UUID, user_id UUID, credited_top_up_id UUID, credited_user_id UUID, created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT c.order_id, c.top_up_id, t.user_id, c.credited_top_up_id, h.user_id, c.created_at
    FROM public.top_up_order_collisions c
    JOIN public.top_ups t ON t.id = c.top_up_id
    JOIN public.top_ups h ON h.id = c.credited_top_up_id
    WHERE p_user_id IS NULL OR t.user_id = p_user_id OR h.user_id = p_user_id
    ORDER BY c.created_at DESC
    LIMIT least(greatest(COALESCE(p_limit, 1), 1), 500);
$$;

-- backfill_credit_top_up
--
-- Returns {ok:false, code:'EMAIL_MISMATCH'} / {ok:false, code:'TOP_UP_NOT_FOUND'},
-- or credit_top_up_with_refund's result, which on ORDER_ALREADY_USED gains
-- collision:true.
CREATE OR REPLACE FUNCTION public.backfill_credit_top_up(
    p_top_up_id UUID,
    p_order_id TEXT,
    p_order_email TEXT,
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
    v_email TEXT;
    v_credit JSONB;
BEGIN
    SELECT u.email INTO v_email
    FROM public.top_ups t JOIN public.users u ON u.id = t.user_id
    WHERE t.id = p_top_up_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TOP_UP_NOT_FOUND');
    END IF;
    IF lower(btrim(p_order_email)) IS DISTINCT FROM lower(btrim(v_email)) OR btrim(p_order_email) = '' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'EMAIL_MISMATCH');
    END IF;

    v_credit := public.credit_top_up_with_refund(p_top_up_id, p_order_id, p_paid_usd_cents, p_currency,
                                                 p_variant_id, p_refunded_cents, p_total_cents);
    IF v_credit->>'code' = 'ORDER_ALREADY_USED' THEN
        INSERT INTO public.top_up_order_collisions (order_id, top_up_id, credited_top_up_id)
        SELECT p_order_id, p_top_up_id, t.id FROM public.top_ups t WHERE t.order_id = p_order_id
        ON CONFLICT (order_id, top_up_id) DO NOTHING;
        RETURN v_credit || jsonb_build_object('collision', true);
    END IF;
    RETURN v_credit;
END $$;

-- next_top_up_order_sweep_batch: up to p_limit (1..100) credited Top-ups due
-- a sweep, counted as they are handed out.
-- ponytail: four sweeps from creation. A checkout re-issued (idempotency key
-- replay) more than 3 days after the Top-up started isn't swept; track the
-- last checkout time on top_ups if that shows up.
CREATE OR REPLACE FUNCTION public.next_top_up_order_sweep_batch(
    p_limit INTEGER
) RETURNS TABLE (top_up_id UUID, order_id TEXT, variant_id TEXT, created_at TIMESTAMPTZ, user_email TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH due AS (
        SELECT t.id
        FROM public.top_ups t
        WHERE t.status = 'credited'
          AND t.order_sweeps < 4
          AND t.created_at > now() - interval '7 days'
          AND now() >= t.created_at + (ARRAY[interval '70 minutes', interval '6 hours',
                                             interval '1 day', interval '3 days'])[t.order_sweeps + 1]
        ORDER BY t.order_swept_at NULLS FIRST, t.created_at
        LIMIT least(greatest(COALESCE(p_limit, 1), 1), 100)
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.top_ups t
    SET order_swept_at = now(), order_sweeps = t.order_sweeps + 1
    FROM due, public.users u
    WHERE t.id = due.id AND u.id = t.user_id
    RETURNING t.id, t.order_id, t.variant_id, t.created_at, u.email;
$$;

-- flag_swept_top_up_order
--
-- Returns {ok:true, flagged:true, idempotent} or {ok:false, code} with code
-- INVALID_ORDER_ID, TOP_UP_NOT_FOUND, VARIANT_MISMATCH, ORDER_BEFORE_TOP_UP
-- (more than 5 minutes of clock skew before the Top-up), EMAIL_MISMATCH,
-- NOT_CREDITED, KNOWN_ORDER (credited to a Top-up) or AMBIGUOUS.
CREATE OR REPLACE FUNCTION public.flag_swept_top_up_order(
    p_top_up_id UUID,
    p_order_id TEXT,
    p_order_email TEXT,
    p_order_created_at TIMESTAMPTZ,
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
    v_email TEXT;
BEGIN
    IF p_order_id IS NULL OR p_order_id !~ '^[0-9]{1,20}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ORDER_ID');
    END IF;

    SELECT t.* INTO v_top_up FROM public.top_ups t WHERE t.id = p_top_up_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TOP_UP_NOT_FOUND');
    END IF;
    IF p_variant_id IS DISTINCT FROM v_top_up.variant_id THEN
        RETURN jsonb_build_object('ok', false, 'code', 'VARIANT_MISMATCH');
    END IF;
    IF p_order_created_at IS NULL OR p_order_created_at < v_top_up.created_at - interval '5 minutes' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ORDER_BEFORE_TOP_UP');
    END IF;
    SELECT u.email INTO v_email FROM public.users u WHERE u.id = v_top_up.user_id;
    IF lower(btrim(p_order_email)) IS DISTINCT FROM lower(btrim(v_email)) OR btrim(p_order_email) = '' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'EMAIL_MISMATCH');
    END IF;

    -- Every Top-up this order could pay: the owner's, of this pack, started
    -- before it. credit_top_up locks the one it credits, so after this a
    -- concurrent credit is either committed and seen, or waits.
    PERFORM 1 FROM public.top_ups t
    WHERE t.user_id = v_top_up.user_id AND t.variant_id = p_variant_id
      AND t.created_at <= p_order_created_at + interval '5 minutes'
    ORDER BY t.id
    FOR UPDATE;

    SELECT t.* INTO v_top_up FROM public.top_ups t WHERE t.id = p_top_up_id;
    IF v_top_up.status <> 'credited' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_CREDITED');
    END IF;
    IF EXISTS (SELECT 1 FROM public.top_ups t WHERE t.order_id = p_order_id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'KNOWN_ORDER');
    END IF;
    IF EXISTS (SELECT 1 FROM public.top_up_flagged_orders f WHERE f.order_id = p_order_id) THEN
        RETURN jsonb_build_object('ok', true, 'flagged', true, 'idempotent', true);
    END IF;
    IF EXISTS (SELECT 1 FROM public.top_ups t
               WHERE t.user_id = v_top_up.user_id AND t.variant_id = p_variant_id AND t.status = 'pending'
                 AND t.created_at <= p_order_created_at + interval '5 minutes') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'AMBIGUOUS');
    END IF;

    INSERT INTO public.top_up_flagged_orders (order_id, top_up_id, user_id, reason, paid_usd_cents, currency, variant_id)
    VALUES (p_order_id, v_top_up.id, v_top_up.user_id, 'already_credited', p_paid_usd_cents,
            left(p_currency, 8), left(p_variant_id, 20))
    ON CONFLICT (order_id) DO NOTHING;
    RETURN jsonb_build_object('ok', true, 'flagged', true, 'idempotent', NOT FOUND);
END $$;

REVOKE ALL ON FUNCTION public.operator_order_collisions(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_order_collisions(UUID, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.backfill_credit_top_up(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_credit_top_up(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, BIGINT, BIGINT) TO service_role;
REVOKE ALL ON FUNCTION public.next_top_up_order_sweep_batch(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_top_up_order_sweep_batch(INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.flag_swept_top_up_order(UUID, TEXT, TEXT, TIMESTAMPTZ, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flag_swept_top_up_order(UUID, TEXT, TEXT, TIMESTAMPTZ, INTEGER, TEXT, TEXT) TO service_role;
