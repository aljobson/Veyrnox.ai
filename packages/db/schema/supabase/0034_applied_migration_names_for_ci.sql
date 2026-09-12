-- Let CI read the names of applied migrations, and nothing else.
--
-- scripts/check-migration-ledger.mjs fails when the database has applied a
-- migration that this repository does not account for. Twice on 2026-09-12
-- that exact gap went unnoticed for hours, because nothing ran the check.
-- CI has to see the ledger to run it, and PostgREST does not expose the
-- supabase_migrations schema.
--
-- The options were a database credential in Actions or this function. PR
-- #61 removed the service-role key from Actions on purpose and gave the
-- catalog watcher an anon-callable RPC instead; this follows the same
-- pattern for the same reason.
--
-- What it discloses: the name of every applied migration, to anyone holding
-- the publishable key, which ships in the browser bundle. That is the
-- sequence of schema changes, including the security fixes by name. It
-- returns no statements, no versions and no data, and takes no arguments.
-- Accepted as the cost of enforcing the ledger check without a secret; see
-- the "Every applied migration must be accounted for" section of the schema
-- README before widening it.
--
-- The Supabase advisor will flag this as an anon-executable SECURITY DEFINER
-- function. That is expected and recorded in docs/supabase-staging.md.
--
-- Idempotent: CREATE OR REPLACE, and REVOKE/GRANT are safe to re-run.

CREATE OR REPLACE FUNCTION public.applied_migration_names()
RETURNS TABLE (name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT m.name FROM supabase_migrations.schema_migrations m ORDER BY m.version;
$$;

REVOKE ALL ON FUNCTION public.applied_migration_names() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.applied_migration_names() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.applied_migration_names() TO anon;
GRANT EXECUTE ON FUNCTION public.applied_migration_names() TO service_role;
