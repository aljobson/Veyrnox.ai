-- Local Photo Studio (ADR-0335): admit its one page route to the telemetry
-- path allowlist. The route stays off in production until the owner enables
-- the `photoStudio` runtime flag; this only keeps the code route inventory and
-- the SQL allowlist in agreement.
--
-- Same shape as 0493: rename the current function (0493's wrapper, whose ACL
-- is already revoked) and put a one-route wrapper in front of it.
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0493(text)') IS NULL THEN
        RAISE EXCEPTION 'telemetry_path_allowed_pre_0493 missing: apply 0493 first';
    END IF;
    IF to_regprocedure('public.telemetry_path_allowed_pre_0494(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT)
            RENAME TO telemetry_path_allowed_pre_0494;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_path = '/app/photo-studio'
        OR public.telemetry_path_allowed_pre_0494(p_path)
$$;

REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
