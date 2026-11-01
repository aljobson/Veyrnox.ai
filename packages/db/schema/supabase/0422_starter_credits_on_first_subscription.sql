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

NOTIFY pgrst, 'reload schema';
