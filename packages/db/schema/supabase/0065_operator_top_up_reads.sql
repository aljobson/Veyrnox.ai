-- Operator Top-up reads and Top-up reconciliation (#98, ADR-0018).
-- Applied name: 0065_operator_top_up_reads.
-- Numbered 0065: open PR #148 (#143) takes 0064.
--
-- Read-only. Nothing here changes credits, Top-ups or Frozen state; the
-- unfreeze path stays unfreeze_account (0059). Operators call these with the
-- service role (Supabase SQL editor); there is no HTTP route or admin UI
-- (ADR-0018: Operator tooling is service-role functions only). They return
-- ids, amounts and states, never email addresses.
--
-- operator_user_top_ups(user)           a user's Top-ups, newest first: status,
--                                       order, credited, refunded cents, credits
--                                       clawed back, backfill state.
-- operator_top_up_generated_since(top-up)
--                                       whether the user generated since that
--                                       Top-up was credited, with the Freeze's
--                                       definition (0059): a job created after
--                                       credited_at that did not end REFUNDED.
-- operator_pending_top_ups(minutes, limit)
--                                       Top-ups still pending after N minutes,
--                                       newest first. Abandoned checkouts stay
--                                       pending forever, so return_order_id is
--                                       what marks one the buyer paid for.
-- operator_flagged_orders(user?, limit) paid orders never granted, which need
--                                       an Operator refund in LemonSqueezy (0054).
--                                       Nothing records that refund here.
-- operator_account_actions(user?, limit)
--                                       the account-action log, newest first,
--                                       with credits taken and written off and
--                                       the user's current Frozen state.
--
-- reconcile_top_ups()  must return zero rows in production. One row per problem:
--   grant_entry_mismatch      a credited Top-up whose grant_entry_id is not a
--                             grant:topup row of the same user for its credits
--                             (free part 0).
--   unlinked_topup_grant      a grant:topup ledger row no Top-up links to. With
--                             the one above and UNIQUE (grant_entry_id), every
--                             credited Top-up has exactly one grant:topup row.
--   credited_without_order    a credited Top-up with no order id.
--   clawback_exceeds_credits  a Top-up that clawed back more than its credits.
--   clawback_ledger_mismatch  a user whose clawed_back_credits total differs
--                             from their reverse:topup_refund rows. Those rows
--                             carry no Top-up id, so this is per user.
--   frozen_state_mismatch     users.frozen_at set without a Freeze as the last
--                             freeze/unfreeze in account_actions, or the reverse.
-- credited_without_order and clawback_exceeds_credits are also CHECK
-- constraints (0054, 0058); the report catches a constraint that was dropped
-- or never applied.
--
-- The nightly veyrnox-reconcile-balances cron job now fails on any of these
-- rows too, like reconcile_balances and reconcile_free_credits (0037).
--
-- Idempotent: CREATE OR REPLACE, guarded cron reschedule, REVOKE/GRANT re-run.

CREATE OR REPLACE FUNCTION public.operator_user_top_ups(
    p_user_id UUID
) RETURNS TABLE (
    top_up_id UUID, pack_id TEXT, sales_channel TEXT, status TEXT, credits INTEGER,
    price_usd_cents INTEGER, order_id TEXT, created_at TIMESTAMPTZ, credited_at TIMESTAMPTZ,
    refunded_cents INTEGER, clawed_back_credits INTEGER, return_order_id TEXT,
    returned_at TIMESTAMPTZ, backfill_attempts INTEGER, backfill_checked_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT t.id, t.pack_id, t.sales_channel, t.status, t.credits, t.price_usd_cents, t.order_id,
           t.created_at, t.credited_at, t.refunded_cents, t.clawed_back_credits, t.return_order_id,
           t.returned_at, t.backfill_attempts, t.backfill_checked_at
    FROM public.top_ups t
    WHERE t.user_id = p_user_id
    ORDER BY t.created_at DESC;
$$;

-- Returns {ok:true, top_up_id, user_id, credited_at, generated_since} or
-- {ok:false, code} with code TOP_UP_NOT_FOUND or NOT_CREDITED.
CREATE OR REPLACE FUNCTION public.operator_top_up_generated_since(
    p_top_up_id UUID
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        (SELECT CASE WHEN t.status <> 'credited'
                     THEN jsonb_build_object('ok', false, 'code', 'NOT_CREDITED')
                     ELSE jsonb_build_object(
                         'ok', true, 'top_up_id', t.id, 'user_id', t.user_id, 'credited_at', t.credited_at,
                         'generated_since', EXISTS (
                             SELECT 1 FROM public.jobs j
                             WHERE j.user_id = t.user_id
                               AND j.created_at > t.credited_at
                               AND j.state <> 'REFUNDED'))
                END
         FROM public.top_ups t WHERE t.id = p_top_up_id),
        jsonb_build_object('ok', false, 'code', 'TOP_UP_NOT_FOUND')
    );
$$;

-- p_older_than_minutes below 0 counts as 0; p_limit is clamped to 1..500.
CREATE OR REPLACE FUNCTION public.operator_pending_top_ups(
    p_older_than_minutes INTEGER,
    p_limit INTEGER
) RETURNS TABLE (
    top_up_id UUID, user_id UUID, pack_id TEXT, credits INTEGER, price_usd_cents INTEGER,
    created_at TIMESTAMPTZ, return_order_id TEXT, returned_at TIMESTAMPTZ,
    backfill_attempts INTEGER, backfill_checked_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT t.id, t.user_id, t.pack_id, t.credits, t.price_usd_cents, t.created_at,
           t.return_order_id, t.returned_at, t.backfill_attempts, t.backfill_checked_at
    FROM public.top_ups t
    WHERE t.status = 'pending'
      AND t.created_at <= now() - make_interval(mins => greatest(COALESCE(p_older_than_minutes, 0), 0))
    ORDER BY t.created_at DESC
    LIMIT least(greatest(COALESCE(p_limit, 1), 1), 500);
$$;

-- p_user_id NULL lists every user's. p_limit is clamped to 1..500.
CREATE OR REPLACE FUNCTION public.operator_flagged_orders(
    p_user_id UUID,
    p_limit INTEGER
) RETURNS TABLE (
    order_id TEXT, top_up_id UUID, user_id UUID, reason TEXT, paid_usd_cents INTEGER,
    currency TEXT, variant_id TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT f.order_id, f.top_up_id, f.user_id, f.reason, f.paid_usd_cents, f.currency, f.variant_id, f.created_at
    FROM public.top_up_flagged_orders f
    WHERE p_user_id IS NULL OR f.user_id = p_user_id
    ORDER BY f.created_at DESC
    LIMIT least(greatest(COALESCE(p_limit, 1), 1), 500);
$$;

-- p_user_id NULL lists every user's. p_limit is clamped to 1..500.
CREATE OR REPLACE FUNCTION public.operator_account_actions(
    p_user_id UUID,
    p_limit INTEGER
) RETURNS TABLE (
    id UUID, user_id UUID, action TEXT, actor TEXT, reason TEXT, top_up_id UUID,
    credits_taken INTEGER, credits_shortfall INTEGER, created_at TIMESTAMPTZ, frozen BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT a.id, a.user_id, a.action, a.actor, a.reason, a.top_up_id,
           a.credits_taken, a.credits_shortfall, a.created_at, u.frozen_at IS NOT NULL
    FROM public.account_actions a
    JOIN public.users u ON u.id = a.user_id
    WHERE p_user_id IS NULL OR a.user_id = p_user_id
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT least(greatest(COALESCE(p_limit, 1), 1), 500);
$$;

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
           jsonb_build_object('frozen_at', u.frozen_at, 'last_action', l.action)
    FROM public.users u
    LEFT JOIN (SELECT DISTINCT ON (a.user_id) a.user_id, a.action
               FROM public.account_actions a
               WHERE a.action IN ('freeze', 'unfreeze')
               ORDER BY a.user_id, a.created_at DESC) l ON l.user_id = u.id
    WHERE (u.frozen_at IS NOT NULL) <> COALESCE(l.action = 'freeze', false);
$$;

DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.operator_user_top_ups(UUID)',
        'public.operator_top_up_generated_since(UUID)',
        'public.operator_pending_top_ups(INTEGER, INTEGER)',
        'public.operator_flagged_orders(UUID, INTEGER)',
        'public.operator_account_actions(UUID, INTEGER)',
        'public.reconcile_top_ups()'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;

-- ── cron: the nightly reconcile also fails on Top-up drift ───────────────
-- Same job name and schedule as 0037; only the body gains reconcile_top_ups.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN;
    END IF;

    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'veyrnox-reconcile-balances';

    PERFORM cron.schedule(
        'veyrnox-reconcile-balances',
        '17 3 * * *',
        $cmd$ DO $body$ DECLARE n INTEGER; f INTEGER; t INTEGER; BEGIN SELECT count(*) INTO n FROM public.reconcile_balances(); SELECT count(*) INTO f FROM public.reconcile_free_credits(); SELECT count(*) INTO t FROM public.reconcile_top_ups(); IF n > 0 OR f > 0 OR t > 0 THEN RAISE EXCEPTION 'ledger reconcile drift: % balance, % free-credit users, % top-up problems', n, f, t; END IF; END $body$; $cmd$
    );
END $$;
