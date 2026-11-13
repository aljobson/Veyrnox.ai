-- Admit the Brand kit page in the privacy-safe route telemetry allowlist.
-- Same wrapper pattern as 0493 to 0495: renaming preserves the revoked ACL of the prior function.
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0496(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT)
            RENAME TO telemetry_path_allowed_pre_0496;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_path = '/app/brand-kit'
        OR public.telemetry_path_allowed_pre_0496(p_path)
$$;

REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
