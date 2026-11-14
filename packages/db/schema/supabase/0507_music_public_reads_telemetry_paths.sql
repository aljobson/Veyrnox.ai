-- The published Music pages and listen-only links are read by signed-out
-- visitors, so their five GET reads moved from /api/v1/music/* (where the
-- gate answers 401 before any handler runs) to /api/music/*. This follows
-- the route inventory: admit the five new normalized paths and stop
-- admitting the five that no longer exist. No table, grant or data changes.
--
-- Same wrapper pattern as 0493: renaming preserves the previous function's
-- revoked ACL. AND binds tighter than OR, so the body reads
--   new paths OR (previous allowlist AND NOT a removed path).
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0507(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT)
            RENAME TO telemetry_path_allowed_pre_0507;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_path IN ('/api/music/profiles/:id', '/api/music/public/:id', '/api/music/public/:id/asset', '/api/music/shared/:id', '/api/music/shared/:id/asset')
        OR public.telemetry_path_allowed_pre_0507(p_path)
       AND p_path NOT IN ('/api/v1/music/profiles/:id', '/api/v1/music/public/:id', '/api/v1/music/public/:id/asset', '/api/v1/music/shared/:id', '/api/v1/music/shared/:id/asset')
$$;

REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
