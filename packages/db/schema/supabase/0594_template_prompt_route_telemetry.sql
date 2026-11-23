-- ADR-0351 amendment 23: the signed-in template prompt read, GET /api/v1/templates/:id/prompt.
-- Admit its route pattern to the admin telemetry allowlist and keep every earlier pattern. No table, no data, no price change.
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0594(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT)
            RENAME TO telemetry_path_allowed_pre_0594;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_path = '/api/v1/templates/:id/prompt' OR public.telemetry_path_allowed_pre_0594(p_path)
$$;

REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
