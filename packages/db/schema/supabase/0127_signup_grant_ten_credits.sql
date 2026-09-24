-- Reduce future signup grants to 10 Free Credits (ADR-0013 amendment).
-- Existing grants and balances are preserved; replay never grants again.
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
        VALUES (v_user_id, 10, 10, 'grant:signup', NULL);
        UPDATE public.credit_balances
        SET balance = balance + 10, free_balance = free_balance + 10, updated_at = now()
        WHERE user_id = v_user_id;
    END IF;

    RETURN v_user_id;
END $$;

REVOKE ALL ON FUNCTION public.signup_grant(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.signup_grant(TEXT, TEXT) TO service_role;
