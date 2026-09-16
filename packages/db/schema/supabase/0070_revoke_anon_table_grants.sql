-- Take the table-level grants off the money tables for anon and authenticated.
--
-- Supabase's default privileges for schema public
-- (ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated)
-- hand every new table arwdDxtm to both browser roles. RLS is enabled and
-- FORCEd everywhere and the only policies for `authenticated` are owner-scoped
-- SELECTs, so DML is refused today — but two holes sit under that:
--
--   * RLS does not apply to TRUNCATE. `D` is granted, and
--     ledger_entries_no_update is a FOR EACH ROW trigger, so a TRUNCATE would
--     empty the ledger past both the policy and the append-only guard.
--   * A single future policy, or one anon-callable SECURITY INVOKER function
--     running dynamic SQL, converts the remaining grants into live writes.
--
-- Neither is reachable through PostgREST as it stands (it issues no TRUNCATE),
-- so this is defence in depth, not an incident. It is the same move 0022 and
-- 0028 already made for model_catalog, applied to the rest of the money spine.
--
-- The browser never talks to Postgres (CLAUDE.md: the Worker holds
-- service-role, the client holds a Bearer token for /api/v1). SELECT is
-- granted back to `authenticated` only on the five tables that carry an
-- owner-read policy, so those policies keep meaning what they say and a
-- direct-read client stays possible without reopening writes.
--
-- Idempotent: REVOKE and GRANT are both safe to re-run.

DO $$
DECLARE t TEXT;
BEGIN
    -- Every table the browser roles could reach. asset_reap_queue and
    -- webhook_events are strictly backend and get nothing back.
    FOREACH t IN ARRAY ARRAY[
        'users', 'credit_balances', 'ledger_entries', 'jobs', 'assets',
        'webhook_events', 'asset_reap_queue'
    ]
    LOOP
        -- Skip a table this database has not created yet: the acceptance
        -- tests build a partial schema, and a migration must not depend on
        -- which of its predecessors happen to be in the list.
        CONTINUE WHEN to_regclass('public.' || t) IS NULL;
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    END LOOP;

    -- Read-only, and still filtered by the owner-scoped policy on each.
    FOREACH t IN ARRAY ARRAY['users', 'credit_balances', 'ledger_entries', 'jobs', 'assets']
    LOOP
        CONTINUE WHEN to_regclass('public.' || t) IS NULL;
        EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    END LOOP;
END $$;

-- Stop the next table inheriting the same grant. Without this the default
-- privileges re-open the hole on whatever migration 0074 creates, and the
-- only thing standing between that table and anon is someone remembering.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;

-- Same story for functions: a SECURITY DEFINER RPC created after this line
-- is service_role-only until someone grants it out on purpose. Every money
-- RPC in this tree already revokes explicitly; this makes forgetting safe
-- instead of catastrophic. catalog_watch() and applied_migration_names()
-- hold explicit grants (0030, 0034) and are unaffected.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated;
