-- Admit only the normalized template catalog page and its public metadata proxy.
-- Provider queries, credentials and response content never reach telemetry.
BEGIN;

DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0619(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(text)
            RENAME TO telemetry_path_allowed_pre_0619;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_path IN (
        '/api/template-catalog',
        '/app/templates'
    ) OR public.telemetry_path_allowed_pre_0619(p_path)
$$;

REVOKE ALL ON FUNCTION public.telemetry_path_allowed(text)
    FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
