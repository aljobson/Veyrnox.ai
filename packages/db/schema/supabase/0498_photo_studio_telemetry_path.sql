-- Local Photo Studio (ADR-0338): admit its one page route to the telemetry
-- path allowlist. The route stays off in production until the owner enables
-- the `photoStudio` runtime flag; this only keeps the code route inventory and
-- the SQL allowlist in agreement.
--
-- Same wrapper pattern as 0493 to 0497; apply after 0497: renaming preserves the
-- revoked ACL of the prior function, and every route the earlier migrations
-- admitted stays admitted because the prior function is what this one falls
-- through to.
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0497(text)') IS NULL THEN
        RAISE EXCEPTION 'telemetry_path_allowed_pre_0497 missing: apply 0497 first';
    END IF;
    IF to_regprocedure('public.telemetry_path_allowed_pre_0498(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT)
            RENAME TO telemetry_path_allowed_pre_0498;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_path = '/app/photo-studio'
        OR public.telemetry_path_allowed_pre_0498(p_path)
$$;

REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
