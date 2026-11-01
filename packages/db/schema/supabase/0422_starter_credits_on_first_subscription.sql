-- 0422: the first 10 credits arrive with the first paid subscription, not at sign-up (ADR-0313).
--
-- Today handle_auth_user_created / handle_auth_user_confirmed (0071) call
-- signup_grant, which mints 10 Free Credits (reason grant:signup, ADR-0013).
-- The hard paywall (apps and web) promises the opposite order: subscribe first,
-- the 10 credits come with the subscription. This migration moves the same
-- grant, it does not add a second one:
--
--   switch OFF (default, shipped):  nothing changes. Sign-up still grants.
--   switch ON  (owner, after approval): the auth triggers only provision the
--     shadow row and a zero balance; the first successful subscription_grant
--     (Stripe invoice, yearly month, App Store / Play event: all three call it)
--     calls grant_starter_credits, which calls signup_grant once.
--
-- Why signup_grant and not ledger_grant: it is the only writer of Free
-- Credits, so the existing 90-day expiry sweep, free-first spending order,
-- reconcile_free_credits(), the erased-email guard (0347) and the
-- one-grant:signup-per-user probe all apply with no new ledger shape and no
-- raw ledger write here. One grant per user, not per subscription, because the
-- probe is on the user.
--
-- Accounts that already received the sign-up grant are untouched: the probe
-- finds their grant:signup row, so they get nothing more and lose nothing.
-- A Frozen or erased account is skipped; a later paid cycle after an unfreeze
-- grants then. A refund or dispute of the first invoice reverses only the
-- subscription bucket (reverse_subscription_grant, unchanged); the starter
-- credits stay and expire 90 days after they were granted.
--
-- The switch lives in the database because the triggers do: a Worker var is
-- not visible to Postgres. It is one row, changed only by
-- set_starter_credits_on_subscription (service_role), and ships false.
--
-- Idempotent: IF NOT EXISTS, ON CONFLICT DO NOTHING, CREATE OR REPLACE, and the
-- trigger rewrite is guarded on auth.users existing (bare local Postgres).

CREATE TABLE IF NOT EXISTS public.starter_credit_config (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    grant_on_first_subscription BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.starter_credit_config (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;
ALTER TABLE public.starter_credit_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.starter_credit_config FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.starter_credit_config FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_starter_credits_on_subscription(p_enabled BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_enabled IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_VALUE');
    END IF;
    UPDATE public.starter_credit_config
    SET grant_on_first_subscription = p_enabled,
        updated_at = CASE WHEN grant_on_first_subscription IS DISTINCT FROM p_enabled THEN now() ELSE updated_at END
    WHERE singleton;
    RETURN jsonb_build_object('ok', true, 'enabled', p_enabled);
END $$;

REVOKE ALL ON FUNCTION public.set_starter_credits_on_subscription(BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_starter_credits_on_subscription(BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.starter_credits_on_subscription_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((SELECT c.grant_on_first_subscription FROM public.starter_credit_config c WHERE c.singleton), false);
$$;

REVOKE ALL ON FUNCTION public.starter_credits_on_subscription_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.starter_credits_on_subscription_enabled() TO service_role;

-- ── grant_starter_credits: the one-time grant, by user id ──────────────────
-- Replay-safe by construction: signup_grant probes for the user's grant:signup
-- row under the balance lock. 'granted' is the credits this call minted.

CREATE OR REPLACE FUNCTION public.grant_starter_credits(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_before INTEGER;
    v_after INTEGER;
BEGIN
    IF NOT public.starter_credits_on_subscription_enabled() THEN
        RETURN jsonb_build_object('ok', true, 'granted', 0, 'skipped', 'DISABLED');
    END IF;

    SELECT * INTO v_user FROM public.users u WHERE u.id = p_user_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND', 'granted', 0);
    END IF;
    IF v_user.frozen_at IS NOT NULL OR v_user.deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'granted', 0, 'skipped', 'ACCOUNT_NOT_ELIGIBLE');
    END IF;

    SELECT COALESCE(SUM(l.free_delta), 0) INTO v_before FROM public.ledger_entries l
    WHERE l.user_id = p_user_id AND l.reason = 'grant:signup';

    -- The 0347 wrapper: grants once, and nothing to an erased email.
    PERFORM public.signup_grant(v_user.auth_id, v_user.email);

    SELECT COALESCE(SUM(l.free_delta), 0) INTO v_after FROM public.ledger_entries l
    WHERE l.user_id = p_user_id AND l.reason = 'grant:signup';

    RETURN jsonb_build_object('ok', true, 'granted', v_after - v_before,
                              'idempotent', v_after = v_before);
END $$;

REVOKE ALL ON FUNCTION public.grant_starter_credits(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_starter_credits(UUID) TO service_role;

-- ── subscription_grant: the 0184 body, plus the starter grant at the end ───

CREATE OR REPLACE FUNCTION public.subscription_grant(
    p_user_id UUID,
    p_credits INTEGER,
    p_period_end TIMESTAMPTZ,
    p_grant_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reason TEXT;
    v_existing public.ledger_entries%ROWTYPE;
    v_balance INTEGER;
    v_leftover INTEGER;
    v_spendable INTEGER;
    v_expires TIMESTAMPTZ;
    v_cycle INTEGER;
    v_entry_id UUID;
    v_starter JSONB;
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 OR p_credits > 100000 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS');
    END IF;
    IF p_grant_key IS NULL OR p_grant_key !~ '^[A-Za-z0-9_]{1,100}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_GRANT_KEY');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    v_reason := 'grant:subscription:' || p_grant_key;

    INSERT INTO public.credit_balances (user_id, balance)
    VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    -- Same lock as every other money function.
    SELECT balance, subscription_balance, subscription_expires_at, subscription_cycle
    INTO v_balance, v_leftover, v_expires, v_cycle
    FROM public.credit_balances WHERE user_id = p_user_id FOR UPDATE;
    -- What can be spent: credits past their cycle end are left out.
    v_spendable := v_balance - CASE WHEN v_expires > now() THEN 0 ELSE v_leftover END;

    -- The second condition restates the partial index's predicate so the
    -- planner can use it.
    SELECT * INTO v_existing FROM public.ledger_entries
    WHERE reason = v_reason AND reason LIKE 'grant:subscription:%';
    IF FOUND THEN
        IF v_existing.user_id <> p_user_id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'GRANT_KEY_REUSED');
        END IF;
        RETURN jsonb_build_object('ok', true, 'entry_id', v_existing.id, 'idempotent', true,
                                  'expired', 0, 'balance_after', v_spendable);
    END IF;

    -- Checked after the replay probe, so a late retry of a granted invoice is
    -- still a no-op. A cycle ends in the future and is at most a year long.
    IF p_period_end IS NULL OR p_period_end <= now() OR p_period_end > now() + interval '400 days' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_PERIOD_END');
    END IF;
    IF v_expires IS NOT NULL AND p_period_end <= v_expires THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PERIOD_NOT_NEWER');
    END IF;

    -- No rollover: the previous cycle's remainder goes before the new grant.
    -- One block, so a key another user already holds undoes the expiry too.
    BEGIN
        IF v_leftover > 0 THEN
            INSERT INTO public.ledger_entries (user_id, delta, free_delta, subscription_delta, subscription_cycle, reason, job_id)
            VALUES (p_user_id, -v_leftover, 0, -v_leftover, v_cycle, 'expire:subscription', NULL);
        END IF;

        INSERT INTO public.ledger_entries (user_id, delta, free_delta, subscription_delta, subscription_cycle, reason, job_id)
        VALUES (p_user_id, p_credits, 0, p_credits, v_cycle + 1, v_reason, NULL)
        RETURNING id INTO v_entry_id;
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('ok', false, 'code', 'GRANT_KEY_REUSED');
    END;

    UPDATE public.credit_balances
    SET balance = balance - v_leftover + p_credits,
        subscription_balance = p_credits,
        subscription_expires_at = p_period_end,
        subscription_cycle = v_cycle + 1,
        updated_at = now()
    WHERE user_id = p_user_id
    RETURNING balance INTO v_balance;

    -- 0422: the first paid cycle also carries the one-time starter Free Credits,
    -- when the owner has switched that on. Same transaction, same balance lock;
    -- a replay returned above, so it never reaches here twice.
    v_starter := public.grant_starter_credits(p_user_id);
    IF COALESCE((v_starter->>'granted')::INTEGER, 0) > 0 THEN
        SELECT balance INTO v_balance FROM public.credit_balances WHERE user_id = p_user_id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'entry_id', v_entry_id, 'idempotent', false,
                              'expired', v_leftover, 'balance_after', v_balance,
                              'starter_granted', COALESCE((v_starter->>'granted')::INTEGER, 0));
END $$;

REVOKE ALL ON FUNCTION public.subscription_grant(UUID, INTEGER, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_grant(UUID, INTEGER, TIMESTAMPTZ, TEXT) TO service_role;

-- ── The auth triggers: with the switch on, sign-up grants nothing ──────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'auth' AND tablename = 'users'
    ) THEN
        RAISE NOTICE 'auth.users not present; skipping the sign-up trigger functions';
        RETURN;
    END IF;

    EXECUTE $fn$
        CREATE OR REPLACE FUNCTION public.handle_auth_user_created()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = ''
        AS $body$
        BEGIN
            IF COALESCE(NEW.is_anonymous, false) OR NEW.email IS NULL THEN RETURN NEW; END IF;
            IF NEW.email_confirmed_at IS NULL OR public.starter_credits_on_subscription_enabled() THEN
                PERFORM public.provision_user(NEW.id::text, NEW.email);
            ELSE
                PERFORM public.signup_grant(NEW.id::text, NEW.email);
            END IF;
            RETURN NEW;
        END $body$;
    $fn$;

    EXECUTE $fn$
        CREATE OR REPLACE FUNCTION public.handle_auth_user_confirmed()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = ''
        AS $body$
        BEGIN
            IF COALESCE(NEW.is_anonymous, false) OR NEW.email IS NULL THEN RETURN NEW; END IF;
            IF public.starter_credits_on_subscription_enabled() THEN
                PERFORM public.provision_user(NEW.id::text, NEW.email);
            ELSE
                PERFORM public.signup_grant(NEW.id::text, NEW.email);
            END IF;
            RETURN NEW;
        END $body$;
    $fn$;

    EXECUTE 'REVOKE ALL ON FUNCTION public.handle_auth_user_created() FROM PUBLIC, anon, authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.handle_auth_user_confirmed() FROM PUBLIC, anon, authenticated';
END $$;


-- ── Free trials (owner, 2026-11-01): the starter credits come with the trial ─────────────────────────
-- The 10 credits are granted when the trial STARTS, once per user, by the same grant_starter_credits
-- (so: switch on, one grant:signup per user, Frozen/deleted/erased skipped). A trial mints no plan
-- credits. Cancelling before the first charge leaves the starter credits in place and they expire 90 days
-- after they were granted. Trial abuse: one grant per user, never per trial; a second account reusing the
-- same App Store / Play subscription is refused by SUBSCRIPTION_OWNED_BY_OTHER, and the stores offer a
-- trial once per Apple ID / Google account. Not covered: a person with a new email, card and Apple ID.

-- Stripe: the webhook reports a subscription that is in 'trialing' (the adapter folds it into 'active').
CREATE OR REPLACE FUNCTION public.grant_trial_starter_credits(p_stripe_subscription_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sub public.credit_subscriptions%ROWTYPE;
    v_grant JSONB;
BEGIN
    IF p_stripe_subscription_id IS NULL OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9_]{1,250}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SUBSCRIPTION');
    END IF;
    SELECT * INTO v_sub FROM public.credit_subscriptions x WHERE x.stripe_subscription_id = p_stripe_subscription_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND');
    END IF;
    -- Pending, ended or flagged (a duplicate that is being cancelled) subscriptions get nothing.
    IF v_sub.status NOT IN ('active', 'past_due') THEN
        RETURN jsonb_build_object('ok', true, 'granted', 0, 'skipped', 'SUBSCRIPTION_NOT_LIVE');
    END IF;
    -- Same balance lock as every other money function, so two deliveries cannot both pass the probe.
    PERFORM 1 FROM public.credit_balances b WHERE b.user_id = v_sub.user_id FOR UPDATE;
    v_grant := public.grant_starter_credits(v_sub.user_id);
    RETURN jsonb_build_object('ok', COALESCE((v_grant->>'ok')::BOOLEAN, false), 'granted', COALESCE((v_grant->>'granted')::INTEGER, 0),
                              'skipped', v_grant->>'skipped', 'user_id', v_sub.user_id);
END $$;

REVOKE ALL ON FUNCTION public.grant_trial_starter_credits(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_trial_starter_credits(TEXT) TO service_role;

-- App Store / Play: the 0393 body with one branch for p_type 'initial_purchase_trial'.
CREATE OR REPLACE FUNCTION public.apply_store_generation_event(
    p_rc_customer_id TEXT,
    p_channel TEXT,
    p_store_product_id TEXT,
    p_original_transaction_id TEXT,
    p_event_id TEXT,
    p_action TEXT,
    p_type TEXT,
    p_period_end TIMESTAMPTZ,
    p_occurred_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_event_key TEXT;
    v_sub public.credit_subscriptions%ROWTYPE;
    v_plan public.credit_subscription_plans%ROWTYPE;
    v_event public.credit_subscription_events%ROWTYPE;
    v_new TEXT;
    v_flagged BOOLEAN := false;
    v_grant JSONB;
    v_reverse JSONB;
    v_grant_key TEXT;
    v_grant_end TIMESTAMPTZ;
    v_yearly BOOLEAN := false;
    v_granted INTEGER := 0;
    v_starter JSONB;
    v_starter_n INTEGER := 0;
BEGIN
    IF p_channel IS NULL OR p_channel NOT IN ('ios', 'android')
       OR p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9._-]{8,128}$'
       OR p_action IS NULL OR p_action NOT IN ('activate', 'cancel_at_period_end', 'past_due', 'expire', 'refund')
       OR p_type IS NULL OR p_type !~ '^[a-z_.]{1,64}$'
       OR p_original_transaction_id IS NULL OR char_length(p_original_transaction_id) NOT BETWEEN 1 AND 200
       OR p_store_product_id IS NULL OR p_store_product_id !~ '^ai\.veyrnox\.generation\.[A-Za-z0-9._:-]{1,170}$'
       OR p_occurred_at IS NULL OR p_occurred_at > now() + interval '5 minutes'
       OR (p_action = 'activate' AND p_period_end IS NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT');
    END IF;
    IF p_rc_customer_id IS NULL OR p_rc_customer_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CUSTOMER_NOT_FOUND');
    END IF;
    SELECT sc.user_id INTO v_user_id FROM public.store_customers sc WHERE sc.rc_customer_id = p_rc_customer_id::uuid;
    IF v_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'CUSTOMER_NOT_FOUND'); END IF;

    v_event_key := 'rc_' || regexp_replace(p_event_id, '[^A-Za-z0-9_]', '_', 'g');
    PERFORM pg_advisory_xact_lock(hashtextextended('generation:' || p_channel || ':' || p_original_transaction_id, 0));
    SELECT * INTO v_event FROM public.credit_subscription_events e WHERE e.stripe_event_id = v_event_key;
    IF FOUND THEN
        SELECT s.* INTO v_sub FROM public.credit_subscriptions s WHERE s.id = v_event.subscription_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'subscription_id', v_sub.id,
            'status', v_sub.status, 'flagged', v_sub.status = 'flagged', 'granted', 0);
    END IF;

    SELECT * INTO v_sub FROM public.credit_subscriptions s
     WHERE s.store_channel = p_channel AND s.store_original_transaction_id = p_original_transaction_id FOR UPDATE;
    IF v_sub.id IS NOT NULL AND v_sub.user_id <> v_user_id THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_OWNED_BY_OTHER');
    END IF;
    IF p_action = 'activate' THEN
        SELECT p.* INTO v_plan FROM public.credit_subscription_store_products sp
        JOIN public.credit_subscription_plans p ON p.id = sp.plan_id
        WHERE sp.channel = p_channel AND sp.store_product_id = p_store_product_id AND p.active;
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'PLAN_NOT_FOUND'); END IF;
    END IF;
    IF v_sub.id IS NULL THEN
        IF p_action <> 'activate' THEN RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND'); END IF;
        INSERT INTO public.credit_subscriptions
            (user_id, plan_id, idempotency_key, price_usd_cents, credits, consent_version, status,
             store_channel, store_original_transaction_id)
        VALUES (v_user_id, v_plan.id, 'rcgen_' || md5(p_channel || ':' || p_original_transaction_id),
                v_plan.price_usd_cents, v_plan.credits, 'store-subscription-v1', 'pending', p_channel, p_original_transaction_id)
        RETURNING * INTO v_sub;
    END IF;

    PERFORM 1 FROM public.credit_balances b WHERE b.user_id = v_sub.user_id FOR UPDATE;
    IF (v_sub.last_event_at IS NOT NULL AND p_occurred_at < v_sub.last_event_at)
       OR v_sub.status = 'flagged'
       OR (v_sub.status IN ('ended', 'pending') AND p_action <> 'activate') THEN
        INSERT INTO public.credit_subscription_events (subscription_id, stripe_event_id, type, status, period_end, occurred_at)
        VALUES (v_sub.id, v_event_key, p_type, v_sub.status, p_period_end, p_occurred_at);
        RETURN jsonb_build_object('ok', true, 'idempotent', false, 'stale', true,
            'subscription_id', v_sub.id, 'status', v_sub.status, 'flagged', v_sub.status = 'flagged', 'granted', 0);
    END IF;

    v_new := CASE p_action WHEN 'activate' THEN 'active' WHEN 'past_due' THEN 'past_due'
        WHEN 'expire' THEN 'ended' WHEN 'refund' THEN 'ended' ELSE v_sub.status END;
    IF v_new IN ('active', 'past_due') AND v_sub.status NOT IN ('active', 'past_due') AND EXISTS (
        SELECT 1 FROM public.credit_subscriptions other WHERE other.user_id = v_sub.user_id
          AND other.id <> v_sub.id AND other.status IN ('active', 'past_due')) THEN
        v_new := 'flagged'; v_flagged := true;
    END IF;

    UPDATE public.credit_subscriptions SET
        status = v_new,
        plan_id = CASE WHEN p_action = 'activate' THEN v_plan.id ELSE plan_id END,
        price_usd_cents = CASE WHEN p_action = 'activate' THEN v_plan.price_usd_cents ELSE price_usd_cents END,
        credits = CASE WHEN p_action = 'activate' THEN v_plan.credits ELSE credits END,
        current_period_end = CASE WHEN p_action = 'activate' THEN p_period_end ELSE COALESCE(p_period_end, current_period_end) END,
        cancel_at_period_end = CASE WHEN p_action = 'activate' THEN false WHEN p_action = 'cancel_at_period_end' THEN true ELSE cancel_at_period_end END,
        started_at = CASE WHEN v_new IN ('active','past_due') THEN COALESCE(started_at, p_occurred_at) ELSE started_at END,
        ended_at = CASE WHEN v_new = 'ended' THEN COALESCE(ended_at, p_occurred_at) WHEN v_new IN ('active','past_due') THEN NULL ELSE ended_at END,
        end_reason = CASE WHEN v_new = 'ended' THEN 'subscription_ended' WHEN v_new = 'flagged' THEN 'superseded'
                          WHEN v_new IN ('active','past_due') THEN NULL ELSE end_reason END,
        last_event_at = p_occurred_at, updated_at = now()
    WHERE id = v_sub.id RETURNING * INTO v_sub;

    IF p_action = 'activate' AND p_type = 'initial_purchase_trial' AND v_new = 'active' THEN
        -- 0422 amendment: a store free trial entitles the account but mints no plan credits (nothing was paid);
        -- it carries the one-time starter credits. The paid RENEWAL that ends the trial grants the plan.
        v_starter := public.grant_starter_credits(v_sub.user_id);
        v_starter_n := COALESCE((v_starter->>'granted')::INTEGER, 0);
    ELSIF p_action = 'activate' AND p_type IN ('initial_purchase', 'renewal') AND v_new = 'active' THEN
        SELECT p.billing_interval = 'year' INTO v_yearly FROM public.credit_subscription_plans p WHERE p.id = v_sub.plan_id;
        v_grant_key := 'rcg_' || md5(p_event_id || ':' || p_original_transaction_id);
        v_grant_end := CASE WHEN v_yearly THEN LEAST(p_period_end, p_occurred_at + interval '1 month') ELSE p_period_end END;
        v_grant := public.subscription_grant(v_sub.user_id, v_sub.credits, v_grant_end, v_grant_key);
        IF (v_grant->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'store generation grant refused: %', v_grant->>'code'; END IF;
        v_granted := CASE WHEN (v_grant->>'idempotent')::boolean THEN 0 ELSE v_sub.credits END;
        IF v_yearly THEN
            UPDATE public.credit_subscriptions SET cycles_granted = 1, cycle_anchor = p_occurred_at,
                cycle_key_base = 'ysub_' || replace(id::text, '-', '') || '_' || substr(md5(v_grant_key), 1, 12), updated_at = now()
            WHERE id = v_sub.id;
        END IF;
    ELSIF p_action = 'refund' THEN
        SELECT e.detail INTO v_grant_key FROM public.credit_subscription_events e
         WHERE e.subscription_id = v_sub.id AND e.status = 'granted' AND e.detail IS NOT NULL
         ORDER BY e.occurred_at DESC LIMIT 1;
        IF v_grant_key IS NOT NULL THEN
            v_reverse := public.reverse_subscription_grant(v_sub.user_id, v_grant_key);
            IF (v_reverse->>'ok')::boolean IS NOT TRUE AND v_reverse->>'code' <> 'GRANT_NOT_FOUND' THEN
                RAISE EXCEPTION 'store generation reversal refused: %', v_reverse->>'code';
            END IF;
        END IF;
    END IF;

    INSERT INTO public.credit_subscription_events (subscription_id, stripe_event_id, type, status, detail, period_end, occurred_at)
    VALUES (v_sub.id, v_event_key, p_type, CASE WHEN v_granted > 0 THEN 'granted' ELSE v_new END,
            CASE WHEN v_granted > 0 THEN v_grant_key ELSE NULL END, p_period_end, p_occurred_at);
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'stale', false, 'flagged', v_flagged,
        'subscription_id', v_sub.id, 'user_id', v_sub.user_id, 'status', v_new, 'granted', v_granted,
        'starter_granted', v_starter_n);
END $$;

REVOKE ALL ON FUNCTION public.apply_store_generation_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_store_generation_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

NOTIFY pgrst, 'reload schema';
