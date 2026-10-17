-- Refuse a sign-up from a disposable-email domain (#1146).
--
-- Sign-up goes from the browser straight to Supabase Auth, so the Worker never
-- sees it. A BEFORE INSERT trigger on auth.users is the one place that holds
-- whichever way an account is created. The list is data in this repo: no
-- outbound call, no third-party service on the sign-up path.
--
-- The refusal raises 'disposable_email_blocked'. GoTrue reports a trigger
-- failure as "Database error saving new user"; AuthGate words that for the
-- person signing up.
--
-- What it matches: the bare domain or any subdomain of it, case-insensitive,
-- on a dot boundary ("notmailinator.com" is a different domain). Anonymous
-- users have no email and are skipped. Only INSERT is checked: an account that
-- already exists is never locked out by a later list change.
--
-- To add a domain, INSERT into public.blocked_email_domains in a new
-- migration. Never list a mailbox provider, a privacy relay (Apple's
-- privaterelay.appleid.com) or an RFC 2606 name the test suites use.
--
-- Idempotent: IF NOT EXISTS, OR REPLACE, ON CONFLICT DO NOTHING, DROP TRIGGER
-- IF EXISTS, REVOKE re-run.

CREATE TABLE IF NOT EXISTS public.blocked_email_domains (
    domain     TEXT PRIMARY KEY
               CHECK (domain = lower(domain) AND domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.blocked_email_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_email_domains FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.blocked_email_domains FROM PUBLIC, anon, authenticated;

INSERT INTO public.blocked_email_domains (domain) VALUES
    ('10minutemail.com'), ('10minutemail.net'), ('20minutemail.com'),
    ('anonbox.net'), ('burnermail.io'), ('discard.email'), ('dispostable.com'),
    ('dropmail.me'), ('emailondeck.com'), ('fakeinbox.com'), ('getnada.com'),
    ('grr.la'), ('guerrillamail.biz'), ('guerrillamail.com'), ('guerrillamail.de'),
    ('guerrillamail.net'), ('guerrillamail.org'), ('guerrillamailblock.com'),
    ('harakirimail.com'), ('jetable.org'), ('maildrop.cc'), ('mailcatch.com'),
    ('mailforspam.com'), ('mailinator.com'), ('mailnesia.com'), ('mintemail.com'),
    ('moakt.com'), ('mohmal.com'), ('mytemp.email'), ('nada.email'),
    ('pokemail.net'), ('sharklasers.com'), ('spam4.me'), ('spamgourmet.com'),
    ('temp-mail.io'), ('temp-mail.org'), ('tempail.com'), ('tempinbox.com'),
    ('tempmail.com'), ('tempmail.net'), ('tempr.email'), ('throwawaymail.com'),
    ('tmpmail.net'), ('tmpmail.org'), ('trashmail.com'), ('trashmail.de'),
    ('trashmail.net'), ('yopmail.com'), ('yopmail.fr'), ('yopmail.net')
ON CONFLICT (domain) DO NOTHING;

CREATE OR REPLACE FUNCTION public.block_disposable_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_domain TEXT;
BEGIN
    IF COALESCE(NEW.is_anonymous, false) OR NEW.email IS NULL THEN RETURN NEW; END IF;

    v_domain := rtrim(lower(substring(NEW.email FROM '@([^@]*)$')), '.');
    IF v_domain IS NULL OR v_domain = '' THEN RETURN NEW; END IF;

    IF EXISTS (
        SELECT 1
        FROM public.blocked_email_domains b
        WHERE v_domain = b.domain
           OR right(v_domain, length(b.domain) + 1) = '.' || b.domain
    ) THEN
        RAISE EXCEPTION 'disposable_email_blocked';
    END IF;
    RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.block_disposable_email() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'auth' AND tablename = 'users'
    ) THEN
        RAISE NOTICE 'auth.users not present; skipping the disposable-email trigger';
        RETURN;
    END IF;

    -- Named to sort first among BEFORE INSERT triggers, so a refused sign-up
    -- does no other work.
    EXECUTE 'DROP TRIGGER IF EXISTS a_block_disposable_email ON auth.users';
    EXECUTE $trg$
        CREATE TRIGGER a_block_disposable_email
            BEFORE INSERT ON auth.users
            FOR EACH ROW
            EXECUTE FUNCTION public.block_disposable_email();
    $trg$;
END $$;
