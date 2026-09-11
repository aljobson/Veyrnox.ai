-- Slice 3b — atomic signup grant.
--
-- Called from the Supabase user.created webhook to atomically:
--   1. Insert a users row (idempotent on auth_id — a replayed webhook is a no-op)
--   2. Ensure a credit_balances row exists
--   3. Append a +50 ledger entry (reason='grant:signup')
--   4. Update the materialised balance to match
--
-- The webhook handler in app/api/webhook/supabase/route.js calls this
-- via `supabase.rpc('signup_grant', { p_auth_id, p_email })`. Wrapping it
-- server-side keeps Ledger.grant's transactional semantics without needing
-- direct-Postgres connectivity from the Worker (that's Slice 4).
--
-- Grant amount is pinned to 50 credits per ADR-0005 §4.

CREATE OR REPLACE FUNCTION public.signup_grant(
    p_auth_id TEXT,
    p_email TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Idempotent user creation. Returns existing id on conflict.
    INSERT INTO public.users (auth_id, email)
    VALUES (p_auth_id, p_email)
    ON CONFLICT (auth_id) DO UPDATE SET email = EXCLUDED.email
    RETURNING id INTO v_user_id;

    -- Ensure balance row exists.
    INSERT INTO public.credit_balances (user_id, balance)
    VALUES (v_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    -- Grant free-tier credits only if we haven't already for this user.
    -- Idempotency guard: check for an existing grant:signup row.
    IF NOT EXISTS (
        SELECT 1 FROM public.ledger_entries
        WHERE user_id = v_user_id AND reason = 'grant:signup'
    ) THEN
        INSERT INTO public.ledger_entries (user_id, delta, reason, job_id)
        VALUES (v_user_id, 50, 'grant:signup', NULL);
        UPDATE public.credit_balances
        SET balance = balance + 50, updated_at = now()
        WHERE user_id = v_user_id;
    END IF;

    RETURN v_user_id;
END $$;

-- Only the backend (service_role) may invoke this. Anon and authenticated
-- callers must go through the webhook, which is signature-verified.
REVOKE ALL ON FUNCTION public.signup_grant(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.signup_grant(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.signup_grant(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.signup_grant(TEXT, TEXT) TO service_role;
