-- model_catalog was readable by the publishable (anon) key, which ships
-- in the browser and is committed in wrangler.jsonc. That exposed
-- provider_cost_per_unit — our wholesale fal cost — and
-- provider_endpoint, letting anyone compute our exact margin per model.
--
-- Every reader of this table is server-side on service_role:
--   app/veyrnox/page.js, app/api/catalog, app/api/v1/generations,
--   app/api/v1/health.
-- The browser gets the safe projection (id, name, modality, credits,
-- gated) from GET /api/catalog, which never selects cost.
--
-- RLS + FORCE per CLAUDE.md; service_role bypasses by design.

ALTER TABLE public.model_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_catalog FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS model_catalog_service_all ON public.model_catalog;
CREATE POLICY model_catalog_service_all ON public.model_catalog
    FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.model_catalog FROM anon;
REVOKE ALL ON public.model_catalog FROM authenticated;
GRANT ALL ON public.model_catalog TO service_role;
