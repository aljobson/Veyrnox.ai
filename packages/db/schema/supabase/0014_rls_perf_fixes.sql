-- Supabase advisors: auth_rls_initplan + multiple_permissive_policies.
--
-- Two fixes, one migration:
--
-- 1. service_role_all was created FOR ALL TO PUBLIC with a
--    USING (auth.role() = 'service_role') filter. That made the policy
--    "permissive" for every role, overlapping with owner_read on SELECT
--    (multiple_permissive_policies). Restrict TO service_role so the
--    policy only exists for the role it targets — no overlap, no
--    per-row auth.role() evaluation.
--
-- 2. owner_read policies called auth.uid() directly. Postgres re-evaluates
--    it per row. Wrap in (SELECT auth.uid()) so the planner caches it
--    once per query (auth_rls_initplan).
--
-- No behavioural change — RLS still forces service_role bypass and
-- authenticated owner-scoped reads. Just faster.

BEGIN;

-- ---- service_role_all: PUBLIC → service_role only, drop redundant USING
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['users', 'credit_balances', 'ledger_entries', 'jobs', 'assets']
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS service_role_all ON public.%I', t);
        EXECUTE format(
            'CREATE POLICY service_role_all ON public.%I '
            'FOR ALL TO service_role '
            'USING (true) WITH CHECK (true)',
            t
        );
    END LOOP;
END $$;

DROP POLICY IF EXISTS model_catalog_service_role_all ON public.model_catalog;
CREATE POLICY model_catalog_service_role_all ON public.model_catalog
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS webhook_events_service_role_all ON public.webhook_events;
CREATE POLICY webhook_events_service_role_all ON public.webhook_events
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ---- owner_read: auth.uid() → (SELECT auth.uid()), TO authenticated
DROP POLICY IF EXISTS users_owner_read ON public.users;
CREATE POLICY users_owner_read ON public.users
    FOR SELECT TO authenticated
    USING (auth_id = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS credit_balances_owner_read ON public.credit_balances;
CREATE POLICY credit_balances_owner_read ON public.credit_balances
    FOR SELECT TO authenticated
    USING (user_id IN (SELECT id FROM public.users WHERE auth_id = (SELECT auth.uid())::text));

DROP POLICY IF EXISTS ledger_entries_owner_read ON public.ledger_entries;
CREATE POLICY ledger_entries_owner_read ON public.ledger_entries
    FOR SELECT TO authenticated
    USING (user_id IN (SELECT id FROM public.users WHERE auth_id = (SELECT auth.uid())::text));

DROP POLICY IF EXISTS jobs_owner_read ON public.jobs;
CREATE POLICY jobs_owner_read ON public.jobs
    FOR SELECT TO authenticated
    USING (user_id IN (SELECT id FROM public.users WHERE auth_id = (SELECT auth.uid())::text));

DROP POLICY IF EXISTS assets_owner_read ON public.assets;
CREATE POLICY assets_owner_read ON public.assets
    FOR SELECT TO authenticated
    USING (job_id IN (
        SELECT j.id FROM public.jobs j
        JOIN public.users u ON u.id = j.user_id
        WHERE u.auth_id = (SELECT auth.uid())::text
    ));

-- model_catalog is readable by anon + authenticated for the marketing page.
DROP POLICY IF EXISTS model_catalog_read_active ON public.model_catalog;
CREATE POLICY model_catalog_read_active ON public.model_catalog
    FOR SELECT TO anon, authenticated
    USING (active = true);

COMMIT;
