-- 0404: does this account have a verified authenticator?
--
-- middleware.js asks this (when REQUIRE_AAL2_WHEN_ENROLLED is on) before letting an
-- aal1 token reach /api/v1, so a password alone cannot act for an account that turned
-- on two-factor sign-in. Same factor test as start_privacy_export (0362), and plpgsql
-- like it, so the body is resolved at call time: auth.mfa_factors exists on Supabase
-- but not in the bare replay database. Service role only: whether an account uses
-- two-factor is nobody else's business.
BEGIN;

CREATE OR REPLACE FUNCTION public.account_mfa_enrolled(p_auth_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM auth.mfa_factors
                  WHERE user_id = p_auth_id::uuid AND factor_type = 'totp' AND status = 'verified');
END $$;
REVOKE ALL ON FUNCTION public.account_mfa_enrolled(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.account_mfa_enrolled(TEXT) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
