-- Owner-authorized staging operational data migration (ADR-0049).
-- Execute ONLY against Supabase project yrqzwqywxfesmbvhzjgj.
-- Not part of the shared schema migration runner; never run on production.
-- The exact staging identity and verified TOTP factor must exist.
-- No profile, creator permission, financial permission, or auth bypass is created.
BEGIN;
DO $operation$
DECLARE
  target_user CONSTANT uuid := '9971ef7d-125e-4518-b1f1-9cf5847e9158';
  target_auth CONSTANT uuid := '0320f197-dfbc-42cf-85d3-154368623719';
  affected integer;
BEGIN
  PERFORM 1 FROM public.users
    WHERE id = target_user AND auth_id = target_auth::text
      AND email = 'support@veyrnox.com' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expected staging identity missing'; END IF;
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
COMMIT;
