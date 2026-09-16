-- Hold the 50 Free Credits until the email address is confirmed.
--
-- handle_auth_user_created (0010) grants on INSERT into auth.users, and
-- nothing checks that the address exists. With Supabase Auth's
-- "Confirm email" off, every POST /auth/v1/signup is instantly a funded
-- account: 50 credits buys up to 3 wan-2.5 clips or 25 flux-2-pro images,
-- about $0.75 of real fal.ai spend, per address. check_generation_rate_limit
-- is per user, so it does not see a thousand of them. The Terms say "one
-- account per person"; that was the only control.
--
-- Two halves, so the gate is in the trigger and the primitive keeps its
-- contract:
--   provision_user()  shadow row + zero balance. Always, on INSERT, because
--                     /api/v1/generations 409s user_not_provisioned without
--                     it and an unconfirmed user should get that far.
--   signup_grant()    provision + the one-time grant:signup entry. Unchanged
--                     signature and unchanged behaviour when called directly
--                     (the acceptance tests call it with no auth.users row).
--
-- The INSERT trigger grants only when auth.users already says confirmed; a
-- new UPDATE trigger grants when email_confirmed_at first becomes non-null.
-- The existing `grant:signup` probe inside signup_grant keeps both paths to
-- one grant per user.
--
-- NOTE FOR THE OWNER: with mailer_autoconfirm still on, email_confirmed_at is
-- set during the INSERT, so behaviour is identical to today — this migration
-- makes the switch safe, it does not throw it. Turn on Authentication ->
-- Sign In / Providers -> Email -> "Confirm email", and add Attack Protection
-- (Turnstile/hCaptcha) on sign-up, to actually close the faucet.
--
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, guarded on auth.users
-- existing at all so the file is safe against a bare local Postgres.

CREATE OR REPLACE FUNCTION public.provision_user(p_auth_id TEXT, p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    INSERT INTO public.users (auth_id, email)
    VALUES (p_auth_id, p_email)
    ON CONFLICT (auth_id) DO UPDATE SET email = EXCLUDED.email
    RETURNING id INTO v_user_id;

    INSERT INTO public.credit_balances (user_id, balance)
    VALUES (v_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN v_user_id;
END $$;

REVOKE ALL ON FUNCTION public.provision_user(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_user(TEXT, TEXT) TO service_role;

-- signup_grant keeps its signature and its meaning: provision, then grant
-- once. Only the callers decide when that is allowed to happen.
CREATE OR REPLACE FUNCTION public.signup_grant(p_auth_id TEXT, p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    v_user_id := public.provision_user(p_auth_id, p_email);

    -- Lock the balance row so two replays can't both pass the probe.
    PERFORM 1 FROM public.credit_balances WHERE user_id = v_user_id FOR UPDATE;

    IF NOT EXISTS (
        SELECT 1 FROM public.ledger_entries
        WHERE user_id = v_user_id AND reason = 'grant:signup'
    ) THEN
        INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id)
        VALUES (v_user_id, 50, 50, 'grant:signup', NULL);
        UPDATE public.credit_balances
        SET balance = balance + 50, free_balance = free_balance + 50, updated_at = now()
        WHERE user_id = v_user_id;
    END IF;

    RETURN v_user_id;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'auth' AND tablename = 'users'
    ) THEN
        RAISE NOTICE 'auth.users not present; skipping the sign-up triggers';
        RETURN;
    END IF;

    -- On INSERT: always shadow the user; grant only if already confirmed
    -- (which is what autoconfirm does, and what an admin-created user does).
    EXECUTE $fn$
        CREATE OR REPLACE FUNCTION public.handle_auth_user_created()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = ''
        AS $body$
        BEGIN
            IF COALESCE(NEW.is_anonymous, false) OR NEW.email IS NULL THEN RETURN NEW; END IF;
            IF NEW.email_confirmed_at IS NULL THEN
                PERFORM public.provision_user(NEW.id::text, NEW.email);
            ELSE
                PERFORM public.signup_grant(NEW.id::text, NEW.email);
            END IF;
            RETURN NEW;
        END $body$;
    $fn$;

    -- On confirmation: the grant the INSERT held back. signup_grant's
    -- grant:signup probe makes a second call a no-op, so a user who confirms,
    -- changes address and confirms again is still granted exactly once.
    EXECUTE $fn$
        CREATE OR REPLACE FUNCTION public.handle_auth_user_confirmed()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = ''
        AS $body$
        BEGIN
            IF COALESCE(NEW.is_anonymous, false) OR NEW.email IS NULL THEN RETURN NEW; END IF;
            PERFORM public.signup_grant(NEW.id::text, NEW.email);
            RETURN NEW;
        END $body$;
    $fn$;

    EXECUTE 'REVOKE ALL ON FUNCTION public.handle_auth_user_confirmed() FROM PUBLIC, anon, authenticated';

    EXECUTE 'DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users';
    EXECUTE $trg$
        CREATE TRIGGER on_auth_user_confirmed
            AFTER UPDATE OF email_confirmed_at ON auth.users
            FOR EACH ROW
            WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
            EXECUTE FUNCTION public.handle_auth_user_confirmed();
    $trg$;
END $$;
