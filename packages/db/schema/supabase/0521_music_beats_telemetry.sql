-- Admit the Music Beats list and detail pages in the privacy-safe route telemetry allowlist.
-- Keep the SQL allowlist aligned with the new phase 1 beat maker page routes.
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0521(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0521;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT p_path IN ('/app/music/beats', '/app/music/beats/:id')
        OR public.telemetry_path_allowed_pre_0521(p_path)
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC, anon, authenticated, service_role;
