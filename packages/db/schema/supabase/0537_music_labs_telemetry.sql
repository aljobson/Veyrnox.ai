-- Admit the Music Labs page in the privacy-safe route telemetry allowlist.
-- Labs itself needs no tables: it spends nothing and stores nothing.
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0537(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0537;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT p_path IN ('/app/music/labs')
        OR public.telemetry_path_allowed_pre_0537(p_path)
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC, anon, authenticated, service_role;
