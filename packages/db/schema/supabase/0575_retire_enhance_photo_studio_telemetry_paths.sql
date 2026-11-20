-- Video Enhance (/app/enhance) and Photo Studio (/app/photo-studio) were
-- removed on 2026-11-20 (owner decision, PR 2550), so the route inventory no
-- longer lists them. Stop admitting the two paths in telemetry. No table,
-- grant or data changes.
--
-- Same wrapper pattern as 0507: renaming preserves the previous function's
-- revoked ACL, and the body reads previous allowlist AND NOT a removed path.
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0575(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT)
            RENAME TO telemetry_path_allowed_pre_0575;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT public.telemetry_path_allowed_pre_0575(p_path)
       AND p_path NOT IN ('/app/enhance', '/app/photo-studio')
$$;

REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
