-- Referral rewards (ADR-0071 part 2, accepted 2026-10-05): a Credit reward for the referrer, released only after the friend's FIRST Credit Pack
-- purchase is past its window with no refund and no dispute. This is the first referral migration that moves Credits, and it does so ONLY through
-- ledger_grant with the idempotency key 'referral-<referee id>' (so a replay mints nothing, and the reason reads grant:referral#referral-<id>).
--
--   referral_rewards   one row per referred friend (the referee is the primary key): pending -> released | cancelled
--   referral_sweep()   hourly: qualify (first credited Pack -> a pending reward of 10%, rounded down, eligible 14 days after it was credited), then
--                      release (refund or dispute -> cancelled; both parties unfrozen and signed-up; monthly caps; otherwise ledger_grant)
--   reconcile_referrals()  zero rows when healthy; joined to the nightly reconcile job below
--
-- Nothing mints at purchase time: no request path calls the sweep. Referrals exist only once the (flag-gated) attach route has run, so with
-- REFERRALS_ENABLED off the sweep finds nothing. A friend's refund or dispute AFTER release is the clawback in part 3; it is not handled here.
-- Caps (owner, 2026-10-05): at most 20 released rewards and 2,000 reward Credits per referrer per UTC calendar month. A capped reward stays
-- pending and is released when the month rolls over.
--
-- Idempotent: IF NOT EXISTS, OR REPLACE, explicit revokes naming each full signature, and the job is unscheduled and rescheduled by name.

CREATE TABLE IF NOT EXISTS public.referral_rewards (
    referee_user_id  UUID        PRIMARY KEY REFERENCES public.referrals(referee_user_id) ON DELETE RESTRICT,
    referrer_user_id UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    top_up_id        UUID        NOT NULL UNIQUE REFERENCES public.top_ups(id) ON DELETE RESTRICT,
    credits          INTEGER     NOT NULL CHECK (credits > 0),
    status           TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'released', 'cancelled')),
    eligible_at      TIMESTAMPTZ NOT NULL,
    released_at      TIMESTAMPTZ NULL,
    ledger_entry_id  UUID        NULL UNIQUE REFERENCES public.ledger_entries(id) ON DELETE RESTRICT,
    cancel_reason    TEXT        NULL CHECK (cancel_reason IN ('refunded', 'disputed')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (referee_user_id <> referrer_user_id),
    CHECK ((status = 'released') = (released_at IS NOT NULL AND ledger_entry_id IS NOT NULL)),
    CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS referral_rewards_referrer_idx ON public.referral_rewards (referrer_user_id, status, released_at);
CREATE INDEX IF NOT EXISTS referral_rewards_pending_idx  ON public.referral_rewards (eligible_at) WHERE status = 'pending';

ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_rewards FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.referral_rewards FROM PUBLIC, anon, authenticated, service_role;

-- The sweep. Returns counts only. p_limit bounds one run; the next hourly run takes the rest.
CREATE OR REPLACE FUNCTION public.referral_sweep(p_limit INTEGER DEFAULT 200)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_qualified INTEGER := 0; v_released INTEGER := 0; v_cancelled INTEGER := 0; v_deferred INTEGER := 0;
    v_month_start TIMESTAMPTZ := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    w public.referral_rewards%ROWTYPE; t public.top_ups%ROWTYPE; v_grant JSONB; v_n INTEGER; v_sum INTEGER;
    v_frozen_friend BOOLEAN; v_ok_referrer BOOLEAN;
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN p_limit := 200; END IF;

    -- 1. Qualify: the friend's first credited Pack, once. Reward = 10% of its Credits, rounded down; a Pack too small to earn a whole Credit earns none.
    INSERT INTO public.referral_rewards (referee_user_id, referrer_user_id, top_up_id, credits, eligible_at)
    SELECT r.referee_user_id, r.referrer_user_id, t0.id, (t0.credits::BIGINT * 10 / 100)::INTEGER, t0.credited_at + interval '14 days'
      FROM public.referrals r
      JOIN LATERAL (SELECT x.* FROM public.top_ups x
                     WHERE x.user_id = r.referee_user_id AND x.status = 'credited' AND x.credited_at IS NOT NULL
                     ORDER BY x.credited_at, x.id LIMIT 1) t0 ON true
     WHERE (t0.credits::BIGINT * 10 / 100) > 0
       AND NOT EXISTS (SELECT 1 FROM public.referral_rewards w0 WHERE w0.referee_user_id = r.referee_user_id)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_qualified = ROW_COUNT;

    -- 2. Release what is due. SKIP LOCKED so two overlapping runs never take the same row.
    FOR w IN SELECT * FROM public.referral_rewards
              WHERE status = 'pending' AND eligible_at <= now()
              ORDER BY eligible_at, referee_user_id LIMIT p_limit FOR UPDATE SKIP LOCKED
    LOOP
        SELECT * INTO t FROM public.top_ups WHERE id = w.top_up_id;

        -- A refund (any amount) cancels it. A dispute is a Freeze tied to this Pack (account_actions), which also cancels.
        IF t.refunded_cents > 0 OR t.clawed_back_credits > 0 THEN
            UPDATE public.referral_rewards SET status = 'cancelled', cancel_reason = 'refunded' WHERE referee_user_id = w.referee_user_id;
            v_cancelled := v_cancelled + 1; CONTINUE;
        END IF;
        IF EXISTS (SELECT 1 FROM public.account_actions a WHERE a.user_id = w.referee_user_id AND a.action = 'freeze' AND a.top_up_id = w.top_up_id) THEN
            UPDATE public.referral_rewards SET status = 'cancelled', cancel_reason = 'disputed' WHERE referee_user_id = w.referee_user_id;
            v_cancelled := v_cancelled + 1; CONTINUE;
        END IF;

        -- Either account frozen (for any other reason), or the referrer not a signed-up account: wait, it may clear.
        SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = w.referee_user_id AND u.frozen_at IS NOT NULL) INTO v_frozen_friend;
        SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = w.referrer_user_id AND u.frozen_at IS NULL)
           AND EXISTS (SELECT 1 FROM public.ledger_entries l WHERE l.user_id = w.referrer_user_id AND l.reason = 'grant:signup') INTO v_ok_referrer;
        IF v_frozen_friend OR NOT v_ok_referrer THEN v_deferred := v_deferred + 1; CONTINUE; END IF;

        -- Monthly caps, counted under a per-referrer lock so two runs cannot both pass the check.
        PERFORM pg_advisory_xact_lock(hashtextextended('referral:' || w.referrer_user_id::text, 0));
        SELECT count(*)::int, COALESCE(sum(credits), 0)::int INTO v_n, v_sum FROM public.referral_rewards
         WHERE referrer_user_id = w.referrer_user_id AND status = 'released' AND released_at >= v_month_start;
        IF v_n >= 20 OR v_sum + w.credits > 2000 THEN v_deferred := v_deferred + 1; CONTINUE; END IF;

        v_grant := public.ledger_grant(w.referrer_user_id, w.credits, 'grant:referral', 'referral-' || w.referee_user_id::text);
        IF v_grant IS NULL OR (v_grant->>'ok')::boolean IS NOT TRUE THEN v_deferred := v_deferred + 1; CONTINUE; END IF;
        UPDATE public.referral_rewards
           SET status = 'released', released_at = now(),
               ledger_entry_id = COALESCE((v_grant->>'entry_id')::uuid,
                   (SELECT l.id FROM public.ledger_entries l WHERE l.user_id = w.referrer_user_id AND l.reason = 'grant:referral#referral-' || w.referee_user_id::text))
         WHERE referee_user_id = w.referee_user_id;
        v_released := v_released + 1;
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'qualified', v_qualified, 'released', v_released, 'cancelled', v_cancelled, 'deferred', v_deferred);
END $$;

-- Zero rows when healthy: every released reward has its one ledger entry for the right Credits and the right account; no stray referral grant
-- exists without a released reward; every reward is 10% (rounded down) of its friend's credited Pack; and no referrer is over either monthly cap.
CREATE OR REPLACE FUNCTION public.reconcile_referrals()
RETURNS TABLE (problem TEXT, referee_user_id UUID, detail TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT 'released_without_ledger_entry'::text, w.referee_user_id, 'no matching grant:referral row'::text
      FROM public.referral_rewards w
     WHERE w.status = 'released'
       AND NOT EXISTS (SELECT 1 FROM public.ledger_entries l WHERE l.id = w.ledger_entry_id AND l.user_id = w.referrer_user_id AND l.delta = w.credits
                          AND l.reason = 'grant:referral#referral-' || w.referee_user_id::text)
    UNION ALL
    SELECT 'ledger_entry_without_released_reward', NULL::uuid, l.reason
      FROM public.ledger_entries l
     WHERE l.reason LIKE 'grant:referral#referral-%'
       AND NOT EXISTS (SELECT 1 FROM public.referral_rewards w WHERE w.ledger_entry_id = l.id AND w.status = 'released')
    UNION ALL
    SELECT 'reward_not_ten_percent_of_first_pack', w.referee_user_id, format('reward %s, pack %s', w.credits, t.credits)
      FROM public.referral_rewards w JOIN public.top_ups t ON t.id = w.top_up_id
     WHERE w.credits <> (t.credits::bigint * 10 / 100)::int OR t.user_id <> w.referee_user_id OR t.status <> 'credited'
    UNION ALL
    SELECT 'referrer_over_monthly_cap', NULL::uuid, format('%s: %s rewards, %s credits', x.referrer_user_id, x.n, x.total)
      FROM (SELECT referrer_user_id, date_trunc('month', released_at AT TIME ZONE 'UTC') AS m, count(*) AS n, sum(credits) AS total
              FROM public.referral_rewards WHERE status = 'released' GROUP BY 1, 2) x
     WHERE x.n > 20 OR x.total > 2000
$$;

REVOKE ALL ON FUNCTION public.referral_sweep(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_referrals()   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_sweep(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_referrals()   TO service_role;

-- Hourly sweep and the nightly reconcile, both by name. The reconcile command is the 0207 command with a seventh check, so the other six are unchanged.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN;
    END IF;

    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'veyrnox-referral-sweep';
    PERFORM cron.schedule('veyrnox-referral-sweep', '23 * * * *', 'SELECT public.referral_sweep()');

    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'veyrnox-reconcile-balances';
    PERFORM cron.schedule(
        'veyrnox-reconcile-balances',
        '17 3 * * *',
        $cmd$ DO $body$ DECLARE n INTEGER; f INTEGER; t INTEGER; u INTEGER; s INTEGER; a INTEGER; r INTEGER; BEGIN SELECT count(*) INTO n FROM public.reconcile_balances(); SELECT count(*) INTO f FROM public.reconcile_free_credits(); SELECT count(*) INTO t FROM public.reconcile_top_ups(); SELECT count(*) INTO u FROM public.reconcile_failed_refunds(); SELECT count(*) INTO s FROM public.reconcile_subscription_credits(); SELECT count(*) INTO a FROM public.reconcile_free_allowance(); SELECT count(*) INTO r FROM public.reconcile_referrals(); IF n > 0 OR f > 0 OR t > 0 OR u > 0 OR s > 0 OR a > 0 OR r > 0 THEN RAISE EXCEPTION 'ledger reconcile drift: % balance, % free-credit users, % top-up problems, % unpaid failures, % subscription-credit users, % free-allowance problems, % referral problems', n, f, t, u, s, a, r; END IF; END $body$; $cmd$
    );
END $$;
