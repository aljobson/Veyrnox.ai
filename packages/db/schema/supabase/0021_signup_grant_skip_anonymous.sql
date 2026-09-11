-- Security audit 2026-09-11, L8: the auth.users trigger granted 50 credits to
-- every new row, including anonymous sign-ins (is_anonymous = true, no
-- email). If anonymous sign-ins are ever enabled in the Supabase dashboard,
-- each POST /auth/v1/signup {} would mint a free 50-credit account. Skip the
-- grant for anonymous and email-less users. The gateway middleware also
-- rejects is_anonymous JWTs.
--
-- Idempotent: CREATE OR REPLACE; trigger unchanged.

CREATE OR REPLACE FUNCTION public.handle_auth_user_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF COALESCE(NEW.is_anonymous, false) OR NEW.email IS NULL THEN
        RETURN NEW;
    END IF;
    PERFORM public.signup_grant(NEW.id::text, NEW.email);
    RETURN NEW;
END $$;
