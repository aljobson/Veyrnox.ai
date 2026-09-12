-- Reconciles two migrations that disagreed, applied 3 minutes apart.
--
-- 0020_lock_model_catalog_from_anon (193ab35) closed anon access to
-- model_catalog entirely: every reader is server-side on service_role, and
-- the browser gets the safe projection from GET /api/catalog.
--
-- 0019_catalog_column_grants (PR #57, written earlier but applied later,
-- 2026-09-12 14:47) took the weaker position: keep anon access, narrow it
-- to the non-margin columns. Applying it after 0020 re-granted SELECT on
-- seven columns and, with the `model_catalog_read_active` policy still in
-- place, anon could read all 11 rows again.
--
-- The wholesale-cost leak stayed closed throughout: provider_cost_per_unit
-- and provider_endpoint were never re-granted. What came back was the
-- public price list, which /api/catalog already serves unauthenticated. So
-- this is a duplicate path to public data rather than an exposure — but the
-- later decision is the deliberate one, and two routes to the same table
-- is how the next margin column leaks by accident.
--
-- Resolution: the restrictive position wins. Drop the anon read policy and
-- the column grants. Readers verified server-side on service_role:
--   app/veyrnox/page.js, app/api/catalog, app/api/v1/generations,
--   app/api/v1/health.
--
-- Idempotent: DROP POLICY IF EXISTS + REVOKE are safe to re-run.

DROP POLICY IF EXISTS model_catalog_read_active ON public.model_catalog;

REVOKE ALL ON public.model_catalog FROM anon;
REVOKE ALL ON public.model_catalog FROM authenticated;
GRANT ALL ON public.model_catalog TO service_role;

-- Duplicate of model_catalog_service_all left by 0004; same predicate,
-- same role. One policy per role reads more honestly.
DROP POLICY IF EXISTS model_catalog_service_role_all ON public.model_catalog;
