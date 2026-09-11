-- Replace the external Database Webhook with an in-database trigger.
-- Fires on auth.users INSERT and calls public.signup_grant to shadow-row
-- the user and grant 50 free credits atomically in the same transaction
-- as the sign-up. No HTTP round trip, no webhook secret to manage.
--
-- (Retires the app/api/webhook/supabase path. Kept as a repo record —
--  the trigger, not the webhook, is the sole user-provisioning path now.)

CREATE OR REPLACE FUNCTION public.handle_auth_user_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.signup_grant(NEW.id::text, NEW.email);
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_created();
