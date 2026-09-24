-- Make the lost-webhook recovery reachable under Stripe, and alarm when it
-- does not work (ADR-0033, round-3 audit finding 08).
--
-- A Credit Pack is credited by exactly one path: a verified
-- checkout.session.completed webhook calling credit_top_up. If that delivery
-- never succeeds the money is taken and the credits are not given, and today
-- nothing recovers it and nothing notices.
--
-- The audit named two guards. There are five, and three of them are not
-- validators at all — they are predicates that silently never match a Stripe
-- row, which is why widening a regex would have changed nothing:
--
--   1. top_ups_return_order_id_format — a LENGTH cap, not the digits cap the
--      audit reported. 0060 wrote digits-only, but 0097 already replaced it
--      with `^[A-Za-z0-9_]{1,64}$`. A Stripe Checkout Session id is about 66
--      to 72 characters, so it is refused on length while looking like it
--      ought to pass. The audit, ADR-0033 and this file's first draft all had
--      this one wrong.
--   2. record_top_up_return (0060) — digits guard, and demands an
--      order_identifier UUID that Stripe has no equivalent for.
--   3. next_top_up_backfill_batch (0064) — `return_order_identifier IS NOT
--      NULL` in the due-row predicate, so a Stripe row is never handed out.
--   4. close_top_up_return (0064) — matches on
--      `return_order_identifier = p_order_identifier`, which is NULL, never
--      true, for a Stripe row.
--   5. reconcile_top_ups (0065) — six branches, every one starting from a
--      credited row or a ledger entry. A pending row with a real charge
--      behind it matches none of them.
--
-- This migration is the database half. The app half (success_url gains
-- {CHECKOUT_SESSION_ID}, the browser posts it, and the backfill verifies
-- against the Session instead of a LemonSqueezy order) follows separately,
-- and nothing here changes behaviour until it lands: no existing caller
-- passes a session id yet.
--
-- Two deviations from ADR-0033 as written, both deliberate:
--
--   - The ADR says the LemonSqueezy shape is "retired, not widened". That
--     holds for the app-layer validators, but NOT for the table CHECK: every
--     row already in the table must stay legal or ADD CONSTRAINT fails when it
--     validates. So the CHECK becomes a superset and the writer is the strict
--     one.
--   - The ADR says record_top_up_return's argument list changes. Dropping the
--     4-argument version would break the deployed app the moment this is
--     applied, and a same-name 3-argument overload is ambiguous to PostgREST.
--     So the Stripe writer gets its own name, and the LemonSqueezy pair is
--     left alone to be dropped once no caller remains.
--
-- Idempotent: the CHECK is dropped and re-added, functions are OR REPLACE.

-- 1. Raise the length cap so a Stripe Checkout Session id fits.
--
--    0097's `^[A-Za-z0-9_]{1,64}$` already allows the right character class;
--    only 64 is wrong. Keeping that class and raising the bound to 255 makes
--    this a strict SUPERSET of what is enforced today, so it cannot fail on an
--    existing row — which matters, because ADD CONSTRAINT validates the whole
--    table and this runs against live data.
--
--    The `cs_` prefix is deliberately NOT asserted here. A table CHECK is a
--    coarse sanity bound; the writer below pins the Stripe shape, and a
--    permissive constraint means no historical row can block the migration.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'top_ups_return_order_id_format') THEN
        ALTER TABLE public.top_ups DROP CONSTRAINT top_ups_return_order_id_format;
    END IF;
    ALTER TABLE public.top_ups ADD CONSTRAINT top_ups_return_order_id_format
        CHECK (return_order_id IS NULL OR return_order_id ~ '^[A-Za-z0-9_]{1,255}$');
END $$;

-- 2. record_top_up_return_session — the Stripe return writer.
--
-- One token, not two. LemonSqueezy needed order_identifier because its
-- order_id was a short sequential integer a stranger could guess; a `cs_...`
-- is unguessable, and the session carries metadata[top_up_sig], an HMAC the
-- adapter already verifies, so the backfill has a cryptographic binding
-- without a second parameter.
--
-- Same shape as record_top_up_return otherwise: caller-scoped by auth_id,
-- a credited Top-up is left alone, and re-posting the same session id changes
-- nothing so a reload of the return page cannot postpone the backfill.
CREATE OR REPLACE FUNCTION public.record_top_up_return_session(
    p_auth_id TEXT,
    p_top_up_id UUID,
    p_session_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id UUID;
    v_status TEXT;
BEGIN
    IF p_session_id IS NULL OR p_session_id !~ '^cs_[A-Za-z0-9_]{1,251}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION_ID');
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
        SET return_order_id = p_session_id,
            -- Stripe has no second token; leave the LemonSqueezy column empty.
            return_order_identifier = NULL,
            returned_at = now(), backfill_attempts = 0, backfill_checked_at = NULL
        WHERE id = v_id AND return_order_id IS DISTINCT FROM p_session_id;
    END IF;

    RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.record_top_up_return_session(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_top_up_return_session(TEXT, UUID, TEXT) TO service_role;

-- 3. next_top_up_backfill_batch — stop requiring the LemonSqueezy identifier.
--
-- Byte-for-byte 0064's body but for the removed
-- `return_order_identifier IS NOT NULL`. Signature and returned columns are
-- unchanged, so this is a replacement and the existing grants stand;
-- order_identifier simply comes back NULL for a Stripe row, which is how the
-- consumer tells the two providers apart.
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

-- 4. close_top_up_return — compare the identifier without tripping over NULL.
--
-- `return_order_identifier = p_order_identifier` is NULL, never true, for a
-- Stripe row, so a completed Stripe check could never close its own return and
-- the row would be handed out again forever. IS NOT DISTINCT FROM keeps the
-- LemonSqueezy behaviour exactly (both non-null must match) and makes
-- NULL = NULL match for Stripe.
CREATE OR REPLACE FUNCTION public.close_top_up_return(
    p_top_up_id UUID,
    p_order_id TEXT,
    p_order_identifier UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.top_ups
    SET return_closed_at = COALESCE(return_closed_at, now())
    WHERE id = p_top_up_id
      AND return_order_id = p_order_id
      AND return_order_identifier IS NOT DISTINCT FROM p_order_identifier;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_CURRENT');
    END IF;
    RETURN jsonb_build_object('ok', true);
END $$;

-- 5. reconcile_top_ups — the alarm.
--
-- 0065's six branches, plus `returned_not_credited`: pending, the buyer came
-- back from checkout, and 24 hours later we still have not credited them.
--
-- It deliberately does NOT flag every stale pending row. An abandoned checkout
-- is also pending forever and is the common case, so "pending and old" would
-- keep the nightly cron permanently red and train everyone to ignore it.
-- Gating on returned_at is what makes the signal clean: the buyer returned, so
-- a charge almost certainly exists, and the backfill has had a full day and
-- roughly eight attempts (5, 10, 20 ... capped at 360 minutes) to credit it.
-- Still pending after that means the backfill is wedged, which no existing
-- branch detects.
--
-- Not bounded by age at the far end, on purpose: a row the backfill gave up on
-- after 7 days is more alarming, not less. return_closed_at is the operator's
-- escape hatch — closing a return that will never credit clears the row.
--
-- reconcile_status() (0100) and the nightly cron both count this function's
-- rows generically, so the new branch reaches both with no change to either.
CREATE OR REPLACE FUNCTION public.reconcile_top_ups()
RETURNS TABLE (problem TEXT, user_id UUID, top_up_id UUID, detail JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT 'grant_entry_mismatch', t.user_id, t.id,
           jsonb_build_object('credits', t.credits, 'grant_entry_id', t.grant_entry_id,
                              'entry_user_id', le.user_id, 'entry_reason', le.reason, 'entry_delta', le.delta)
    FROM public.top_ups t
    LEFT JOIN public.ledger_entries le ON le.id = t.grant_entry_id
    WHERE t.status = 'credited'
      AND (le.id IS NULL OR le.user_id <> t.user_id OR le.reason <> 'grant:topup'
           OR le.delta <> t.credits OR COALESCE(le.free_delta, le.delta) <> 0)

    UNION ALL
    SELECT 'unlinked_topup_grant', le.user_id, NULL,
           jsonb_build_object('entry_id', le.id, 'delta', le.delta)
    FROM public.ledger_entries le
    WHERE le.reason = 'grant:topup'
      AND NOT EXISTS (SELECT 1 FROM public.top_ups t WHERE t.grant_entry_id = le.id)

    UNION ALL
    SELECT 'credited_without_order', t.user_id, t.id, jsonb_build_object('credited_at', t.credited_at)
    FROM public.top_ups t
    WHERE t.status = 'credited' AND t.order_id IS NULL

    UNION ALL
    SELECT 'clawback_exceeds_credits', t.user_id, t.id,
           jsonb_build_object('credits', t.credits, 'clawed_back_credits', t.clawed_back_credits)
    FROM public.top_ups t
    WHERE t.clawed_back_credits > t.credits

    UNION ALL
    SELECT 'clawback_ledger_mismatch', COALESCE(c.user_id, r.user_id), NULL,
           jsonb_build_object('clawed_back_credits', COALESCE(c.total, 0), 'ledger_reversed', COALESCE(r.total, 0))
    FROM (SELECT t.user_id, SUM(t.clawed_back_credits) AS total
          FROM public.top_ups t GROUP BY t.user_id) c
    FULL OUTER JOIN (SELECT le.user_id, -SUM(le.delta) AS total
                     FROM public.ledger_entries le WHERE le.reason = 'reverse:topup_refund'
                     GROUP BY le.user_id) r ON r.user_id = c.user_id
    WHERE COALESCE(c.total, 0) <> COALESCE(r.total, 0)

    UNION ALL
    SELECT 'frozen_state_mismatch', u.id, NULL,
           jsonb_build_object('frozen_at', u.frozen_at, 'last_freeze', l.freeze, 'last_unfreeze', l.unfreeze)
    FROM public.users u
    LEFT JOIN (SELECT a.user_id,
                      bool_or(a.action = 'freeze') AS freeze,
                      bool_or(a.action = 'unfreeze') AS unfreeze
               FROM public.account_actions a
               WHERE a.action IN ('freeze', 'unfreeze')
                 AND a.created_at = (SELECT max(b.created_at) FROM public.account_actions b
                                     WHERE b.user_id = a.user_id AND b.action IN ('freeze', 'unfreeze'))
               GROUP BY a.user_id) l ON l.user_id = u.id
    WHERE CASE WHEN u.frozen_at IS NOT NULL THEN NOT COALESCE(l.freeze, false)
               ELSE COALESCE(l.freeze AND NOT l.unfreeze, false) END

    UNION ALL
    SELECT 'returned_not_credited', t.user_id, t.id,
           jsonb_build_object('returned_at', t.returned_at, 'return_order_id', t.return_order_id,
                              'backfill_attempts', t.backfill_attempts,
                              'backfill_checked_at', t.backfill_checked_at)
    FROM public.top_ups t
    WHERE t.status = 'pending'
      AND t.return_order_id IS NOT NULL
      AND t.return_closed_at IS NULL
      AND t.returned_at <= now() - interval '24 hours';
$$;

-- reconcile_top_ups keeps 0065's grants; restated because a replacement of a
-- STABLE definer function is exactly where a missing revoke goes unnoticed.
REVOKE ALL ON FUNCTION public.reconcile_top_ups() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_top_ups() TO service_role;
