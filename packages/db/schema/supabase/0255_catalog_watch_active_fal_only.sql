-- 0255_catalog_watch_active_fal_only.sql
-- catalog_watch() returns only the rows the fal catalog watcher compares
-- (audit 2026-10-09, P-04).
--
-- The function is anon-callable on purpose (0030, 0031: the weekly watcher
-- runs in GitHub Actions with the publishable key so no service-role key
-- lives there), and ADR-0014's addendum of 2026-09-12 records that fal's list
-- prices are not a secret. What it also returned was every other row: 19
-- inactive models, with their endpoints and costs, before anyone could buy
-- them, and the endpoints of every other provider, which 0028 withholds from
-- the same role on the table itself. scripts/check-fal-catalog.mjs keeps only
-- `active AND provider = 'fal'` before it does anything, so nothing the
-- watcher does changes; the rest simply stops being readable.
--
-- Same signature and columns, so the allowlist in
-- scripts/test-default-privileges.mjs and the watcher's fixture still hold.
-- Idempotent: OR REPLACE, REVOKE and GRANT re-run.

CREATE OR REPLACE FUNCTION public.catalog_watch()
RETURNS TABLE (id TEXT, provider TEXT, provider_endpoint TEXT, credits_5s INTEGER, provider_cost_per_unit NUMERIC, cost_unit TEXT, billing_seconds NUMERIC, active BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT id, provider, provider_endpoint, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, active
    FROM public.model_catalog
    WHERE active AND provider = 'fal'
    ORDER BY id;
$$;

REVOKE ALL ON FUNCTION public.catalog_watch() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.catalog_watch() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_watch() TO anon, service_role;
