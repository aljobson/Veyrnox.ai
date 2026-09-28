-- Owner designated support@veyrnox.com on 2026-09-28 (ADR-0049).
-- Provision only the exact production identity. Other environments and clean
-- rebuilds omit it; matching either identity requires all checks to pass.
DO $operation$
DECLARE
  target_user CONSTANT uuid := '3e3dfd74-a099-4c1b-8bb4-8a336d4f1895';
  target_auth CONSTANT uuid := 'cbb38593-f293-48fb-9012-0c5f7357dfc6';
  affected integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users
    WHERE id = target_user OR auth_id = target_auth::text) THEN
    RETURN;
  END IF;
  PERFORM 1 FROM public.users
    WHERE id = target_user AND auth_id = target_auth::text
      AND email = 'support@veyrnox.com' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expected production identity missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.mfa_factors
    WHERE user_id = target_auth AND factor_type = 'totp' AND status = 'verified') THEN
    RAISE EXCEPTION 'Verified authenticator required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cinema_memberships WHERE user_id = target_user
    AND (account_status <> 'active' OR role NOT IN ('viewer', 'administrator'))) THEN
    RAISE EXCEPTION 'Unexpected existing Cinema membership; review required';
  END IF;
  INSERT INTO public.cinema_memberships (user_id, role, account_status)
    VALUES (target_user, 'administrator', 'active')
    ON CONFLICT (user_id) DO UPDATE SET role = 'administrator'
      WHERE cinema_memberships.account_status = 'active'
        AND cinema_memberships.role IN ('viewer', 'administrator');
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Expected exactly one membership'; END IF;
END $operation$;
