-- Referral clawback (ADR-0071 part 3, accepted 2026-10-05): a reward already released is taken back when the friend's Pack is later refunded
-- or disputed. Part 2 (0218) cancels a reward refunded or disputed BEFORE release; this covers AFTER.
--
-- It runs inside referral_sweep(), never on a request path, and writes one compensating ledger row, reason 'reverse:referral' (never an edit):
--   * a refund claws back the share of the reward that matches the share refunded (a later, larger refund takes the difference);
--   * a dispute (a Freeze tied to the Pack) claws back the whole reward;
--   * it takes only Pack Credits the referrer still has (balance - free - subscription, never below zero), the same cap as a Top-up clawback;
--   * what cannot be taken is recorded as clawback_shortfall and not chased; the reward counts as settled either way.
-- referral_rewards gains clawed_back_credits, clawback_shortfall and last_clawback_at. The release cap still counts a reward that was later
-- clawed back, so refunding cannot be used to recycle the monthly cap. reconcile_referrals() gains a check that the ledger's 'reverse:referral'
-- rows equal the rewards' recorded clawbacks per referrer.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, guarded constraints, OR REPLACE and the same revokes by full signature.

ALTER TABLE public.referral_rewards ADD COLUMN IF NOT EXISTS clawed_back_credits INTEGER     NOT NULL DEFAULT 0 CHECK (clawed_back_credits >= 0);
ALTER TABLE public.referral_rewards ADD COLUMN IF NOT EXISTS clawback_shortfall  INTEGER     NOT NULL DEFAULT 0 CHECK (clawback_shortfall >= 0);
ALTER TABLE public.referral_rewards ADD COLUMN IF NOT EXISTS last_clawback_at    TIMESTAMPTZ NULL;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_rewards_clawback_within_reward') THEN
        ALTER TABLE public.referral_rewards ADD CONSTRAINT referral_rewards_clawback_within_reward
            CHECK (clawed_back_credits + clawback_shortfall <= credits AND (status = 'released' OR (clawed_back_credits = 0 AND clawback_shortfall = 0)));
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.referral_sweep(p_limit INTEGER DEFAULT 200)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_qualified INTEGER := 0; v_released INTEGER := 0; v_cancelled INTEGER := 0; v_deferred INTEGER := 0;
    v_month_start TIMESTAMPTZ := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    w public.referral_rewards%ROWTYPE; t public.top_ups%ROWTYPE; v_grant JSONB; v_n INTEGER; v_sum INTEGER;
    v_frozen_friend BOOLEAN; v_ok_referrer BOOLEAN;
    v_clawed INTEGER := 0; v_short INTEGER := 0; v_target INTEGER; v_owed INTEGER; v_take INTEGER;
    v_bal INTEGER; v_free INTEGER; v_sub INTEGER; v_disputed BOOLEAN;
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

    -- 3. Claw back what was released and then refunded or disputed. Refund: the share of the reward matching the share refunded (a later,
    -- larger refund takes the difference). Dispute (a Freeze tied to the Pack): the whole reward. It takes only Pack Credits the referrer still
    -- has (never Free or Subscription Credits, never below zero); what cannot be taken is recorded as a shortfall and not chased.
    FOR w IN SELECT rw.* FROM public.referral_rewards rw JOIN public.top_ups tt ON tt.id = rw.top_up_id
              WHERE rw.status = 'released' AND rw.clawed_back_credits + rw.clawback_shortfall < rw.credits
                AND (tt.refunded_cents > 0 OR EXISTS (SELECT 1 FROM public.account_actions a
                       WHERE a.user_id = rw.referee_user_id AND a.action = 'freeze' AND a.top_up_id = rw.top_up_id))
              ORDER BY rw.released_at, rw.referee_user_id LIMIT p_limit FOR UPDATE OF rw SKIP LOCKED
    LOOP
        SELECT * INTO t FROM public.top_ups WHERE id = w.top_up_id;
        SELECT EXISTS (SELECT 1 FROM public.account_actions a WHERE a.user_id = w.referee_user_id AND a.action = 'freeze' AND a.top_up_id = w.top_up_id) INTO v_disputed;
        v_target := CASE WHEN v_disputed THEN w.credits
                         ELSE LEAST(w.credits, (w.credits::BIGINT * t.refunded_cents / t.price_usd_cents)::INTEGER) END;
        v_owed := v_target - w.clawed_back_credits - w.clawback_shortfall;
        IF v_owed <= 0 THEN CONTINUE; END IF;

        SELECT b.balance, b.free_balance, b.subscription_balance INTO v_bal, v_free, v_sub
          FROM public.credit_balances b WHERE b.user_id = w.referrer_user_id FOR UPDATE;
        v_take := GREATEST(0, LEAST(v_owed, COALESCE(v_bal, 0) - COALESCE(v_free, 0) - COALESCE(v_sub, 0)));
        IF v_take > 0 THEN
            INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id)
            VALUES (w.referrer_user_id, -v_take, 0, 'reverse:referral', NULL);
            UPDATE public.credit_balances SET balance = balance - v_take, updated_at = now() WHERE user_id = w.referrer_user_id;
        END IF;
        UPDATE public.referral_rewards
           SET clawed_back_credits = clawed_back_credits + v_take, clawback_shortfall = clawback_shortfall + (v_owed - v_take), last_clawback_at = now()
         WHERE referee_user_id = w.referee_user_id;
        v_clawed := v_clawed + v_take; v_short := v_short + (v_owed - v_take);
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'qualified', v_qualified, 'released', v_released, 'cancelled', v_cancelled, 'deferred', v_deferred,
                              'clawed_back', v_clawed, 'shortfall', v_short);
END $$;

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
    UNION ALL
    SELECT 'clawback_ledger_mismatch', NULL::uuid, format('%s: ledger %s, rewards %s', COALESCE(l.user_id, c.referrer_user_id), COALESCE(l.taken, 0), COALESCE(c.recorded, 0))
      FROM (SELECT user_id, sum(-delta)::int AS taken FROM public.ledger_entries WHERE reason = 'reverse:referral' GROUP BY user_id) l
      FULL JOIN (SELECT referrer_user_id, sum(clawed_back_credits)::int AS recorded FROM public.referral_rewards GROUP BY referrer_user_id) c ON c.referrer_user_id = l.user_id
     WHERE COALESCE(l.taken, 0) <> COALESCE(c.recorded, 0)
$$;

REVOKE ALL ON FUNCTION public.referral_sweep(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_referrals()   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_sweep(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_referrals()   TO service_role;
