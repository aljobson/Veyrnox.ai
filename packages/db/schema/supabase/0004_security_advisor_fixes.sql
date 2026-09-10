-- Fix Supabase security-advisor findings from 0003_rls_policies:
--
--   ERROR rls_disabled_in_public — model_catalog and webhook_events were
--         intentionally left RLS-off in 0003 as "shared/admin", but Supabase's
--         PostgREST exposes any public-schema table to REST callers, so the
--         linter (correctly) treats missing RLS as a bug.
--   WARN  function_search_path_mutable — ledger_entries_append_only had no
--         SET search_path, leaving it vulnerable to schema-shadowing.
--
-- Applied against yrqzwqywxfesmbvhzjgj (veyrnox-staging) on 2026-09-10.

ALTER TABLE model_catalog   ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_catalog   FORCE  ROW LEVEL SECURITY;
ALTER TABLE webhook_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events  FORCE  ROW LEVEL SECURITY;

-- model_catalog: readable by any signed-in user (studio UI needs it),
-- writes remain service_role only. anon can also read active rows so
-- unauthenticated landing pages can render pricing.
DROP POLICY IF EXISTS model_catalog_service_role_all ON model_catalog;
CREATE POLICY model_catalog_service_role_all ON model_catalog
    FOR ALL TO PUBLIC
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS model_catalog_read_active ON model_catalog;
CREATE POLICY model_catalog_read_active ON model_catalog
    FOR SELECT TO PUBLIC
    USING (auth.role() IN ('authenticated', 'anon') AND active = true);

-- webhook_events: strictly backend. No end-user policy at any role.
DROP POLICY IF EXISTS webhook_events_service_role_all ON webhook_events;
CREATE POLICY webhook_events_service_role_all ON webhook_events
    FOR ALL TO PUBLIC
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Pin the append-only trigger function's search_path.
ALTER FUNCTION public.ledger_entries_append_only() SET search_path = '';
