-- Keep authenticated album artwork requests visible in aggregate traffic telemetry.
-- The collector records only this reviewed route pattern, never a raw URL or slug.
DO $$ BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0606(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0606;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path='' AS $$
    SELECT p_path = '/api/v1/music/explore/albums/:id/artwork'
        OR public.telemetry_path_allowed_pre_0606(p_path);
$$;

REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC,anon,authenticated,service_role;
