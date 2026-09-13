-- Follow-up to 0037_free_credit_expiry (PR #109 review).
--
-- 1. A SUCCEEDED job with no asset is not settled: sweep_stuck_jobs (0019)
--    fails and refunds it once its R2 copy is given up on. The expiry sweep
--    treated it as settled, so it could expire a grant and the later refund
--    would restore Free Credits that never expire again. It now waits for
--    such a job too. STORED and REFUNDED are the only settled states.
--
-- 2. The candidate scan filters ledger_entries on reason = 'grant:signup',
--    which the (user_id, created_at) index doesn't serve once generation
--    rows pile up. A partial index covers exactly the grant rows.
--
-- 3. p_limit caps one run at 500 users. Daily, a backlog above 500/day would
--    never clear; hourly, the cap is 12,000/day and an eligible grant is
--    expired within the hour.
--
-- Idempotent: CREATE OR REPLACE, IF NOT EXISTS, cron.unschedule guard.

CREATE INDEX IF NOT EXISTS ledger_entries_signup_grant
    ON public.ledger_entries (created_at, user_id) WHERE reason = 'grant:signup';

CREATE OR REPLACE FUNCTION public.expire_free_credits(
    p_as_of TIMESTAMPTZ DEFAULT now(),
    p_limit INTEGER DEFAULT 500
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_free INTEGER;
    v_users INTEGER := 0;
    v_credits INTEGER := 0;
BEGIN
    FOR v_user_id IN
        SELECT b.user_id
        FROM public.ledger_entries g
        JOIN public.credit_balances b ON b.user_id = g.user_id
        WHERE g.reason = 'grant:signup'
          AND g.created_at <= p_as_of - interval '90 days'
          AND b.free_balance > 0
          AND NOT EXISTS (SELECT 1 FROM public.ledger_entries e
                          WHERE e.user_id = b.user_id AND e.reason = 'expire:free')
        ORDER BY g.created_at
        LIMIT p_limit
    LOOP
        -- Same lock as ledger_debit; skip a user another run holds.
        SELECT free_balance INTO v_free FROM public.credit_balances
        WHERE user_id = v_user_id
        FOR UPDATE SKIP LOCKED;

        -- Re-check under the lock: fresh statements see commits the scan missed.
        CONTINUE WHEN v_free IS NULL OR v_free <= 0;
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.ledger_entries e
                              WHERE e.user_id = v_user_id AND e.reason = 'expire:free');
        -- Any job that took Free Credits and could still be refunded.
        CONTINUE WHEN EXISTS (
            SELECT 1 FROM public.jobs j
            JOIN public.ledger_entries d ON d.job_id = j.id AND d.delta < 0
            WHERE j.user_id = v_user_id
              AND j.state NOT IN ('STORED', 'REFUNDED')
              AND COALESCE(d.free_delta, d.delta) < 0);

        -- free_balance <= balance (constraint), so this never goes below zero.
        INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id)
        VALUES (v_user_id, -v_free, -v_free, 'expire:free', NULL);

        UPDATE public.credit_balances
        SET balance = balance - v_free, free_balance = 0, updated_at = now()
        WHERE user_id = v_user_id;

        v_users := v_users + 1;
        v_credits := v_credits + v_free;
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'expired_users', v_users, 'expired_credits', v_credits);
END $$;

REVOKE ALL ON FUNCTION public.expire_free_credits(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_free_credits(TIMESTAMPTZ, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.expire_free_credits(TIMESTAMPTZ, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_free_credits(TIMESTAMPTZ, INTEGER) TO service_role;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN;
    END IF;
    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'veyrnox-expire-free-credits';
    PERFORM cron.schedule(
        'veyrnox-expire-free-credits',
        '41 * * * *',
        $cmd$ SELECT public.expire_free_credits(); $cmd$
    );
END $$;
