-- Admit the public ready-template catalogue used by the signed-in Home page.
-- Only the normalized route is retained; query strings and response data are not.
BEGIN;

DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0624(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(text)
            RENAME TO telemetry_path_allowed_pre_0624;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_path = '/api/template-catalog/ready'
        OR public.telemetry_path_allowed_pre_0624(p_path)
$$;

REVOKE ALL ON FUNCTION public.telemetry_path_allowed(text)
    FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
