-- Clean-room ByeCut parity routes added after the previous telemetry allowlist amendment.
-- Migration 0575 remains immutable: this wrapper deliberately re-admits Photo
-- Studio now that the clean-room editor work has restored that product route.
-- Only normalized route names are admitted; request and feedback content never reaches telemetry.
BEGIN;

DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0614(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(text)
            RENAME TO telemetry_path_allowed_pre_0614;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_path IN (
        '/api/v1/editor/smart-cut-feedback',
        '/api/v1/project-folders',
        '/api/v1/project-folders/:id',
        '/app/photo-studio'
    ) OR public.telemetry_path_allowed_pre_0614(p_path)
$$;

REVOKE ALL ON FUNCTION public.telemetry_path_allowed(text)
    FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
