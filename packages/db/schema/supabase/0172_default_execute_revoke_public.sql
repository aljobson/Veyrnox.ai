-- 0172: new functions are not callable by PUBLIC by default
-- (docs/product/ISSUES.md S5).
--
-- 0070 said a function created after it "is service_role-only until someone
-- grants it out on purpose". It was not. Postgres grants EXECUTE on every new
-- function to PUBLIC, which anon and authenticated inherit, and 0070's
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ... FROM anon` cannot take
-- that away: per-schema default privileges can only add to the global
-- defaults, never remove them. Every migration since has revoked from PUBLIC
-- by hand, which is the only reason nothing leaked.
--
-- This removes PUBLIC's EXECUTE from the global defaults for the role that
-- applies migrations — `postgres` on Supabase (Management API), the database
-- owner in CI and local replays — and for `postgres` too when it exists and
-- this role may act for it. It covers every schema (public, private, ...).
-- Existing functions are untouched; their grants are already explicit.
--
-- The rule in CLAUDE.md stands: every new function still revokes and grants
-- by full signature. This makes forgetting it safe.
--
-- Consequence: a future migration that runs CREATE EXTENSION gets extension
-- functions with no PUBLIC EXECUTE and must grant what it needs. Extensions
-- enabled from the Supabase dashboard are installed by supabase_admin and are
-- unaffected.
--
-- Also: ledger_entries_append_only() (0001) was never revoked from PUBLIC.
-- A trigger function cannot be called directly, so this is hygiene only.

DO $$
DECLARE r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY[current_user::TEXT, 'postgres'] LOOP
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
        CONTINUE WHEN NOT pg_has_role(current_user, r, 'MEMBER');
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', r);
    END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.ledger_entries_append_only() FROM PUBLIC, anon, authenticated;
