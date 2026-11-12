-- Admit the Music Instruments page in the privacy-safe route telemetry allowlist.
-- Same wrapper pattern as 0493 and 0494: renaming preserves the revoked ACL of the prior function.
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0495(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT)
            RENAME TO telemetry_path_allowed_pre_0495;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_path = '/app/music/instruments'
        OR public.telemetry_path_allowed_pre_0495(p_path)
$$;

REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
