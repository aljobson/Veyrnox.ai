-- Owner-proof discovery telemetry only; no offer, price or supplier changes.
-- HARD MERGE PRECONDITION: PR 2685 / 0604_route_failure_accounting.sql must
-- be merged and applied before 0607. Main's 0600-0603 migrations are separate.
-- Recheck main and all open PRs immediately before merging for numbering/order.
BEGIN;
-- Validate both schema markers before changing the telemetry wrapper.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'model_routes'
          AND column_name = 'breaker_first_opened_at'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'job_route_close_refused'
          AND p.prokind = 'f'
    ) THEN
        RAISE EXCEPTION '0607 requires 0604_route_failure_accounting.sql (PR 2685)';
    END IF;
END $$;
DO $$ BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0607(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0607;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path='' AS $$
    SELECT p_path = '/api/v1/owner-proof' OR public.telemetry_path_allowed_pre_0607(p_path)
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
