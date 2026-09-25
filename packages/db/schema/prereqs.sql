-- What a plain Postgres needs before this repo's migrations will apply.
--
-- Production is Supabase, which ships pg_cron, the auth schema and its
-- request-scoped helpers, and records applied migrations in
-- supabase_migrations. A bare postgres:16-alpine (CI, or embedded-postgres
-- locally) has none of them, which is why several migrations could never be
-- replayed and why the acceptance tests each grew their own stub — two of
-- which disagreed about a parameter name and broke each other (audit
-- 2026-09-23).
--
-- One fixture, used by scripts/replay-migrations.mjs and by the acceptance
-- tests. Never applied to production: everything here already exists there.

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;
    CREATE SCHEMA IF NOT EXISTS cron;
    CREATE TABLE IF NOT EXISTS cron.job (jobid BIGSERIAL PRIMARY KEY, jobname TEXT, schedule TEXT, command TEXT);
    CREATE OR REPLACE FUNCTION cron.schedule(p_name TEXT, p_schedule TEXT, p_command TEXT)
    RETURNS BIGINT LANGUAGE sql AS $fn$
        INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid;
    $fn$;
    CREATE OR REPLACE FUNCTION cron.unschedule(p_name TEXT)
    RETURNS BOOLEAN LANGUAGE sql AS $fn$ DELETE FROM cron.job WHERE jobname = p_name; SELECT true; $fn$;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT,
    email_confirmed_at TIMESTAMPTZ,
    is_anonymous BOOLEAN NOT NULL DEFAULT false,
    raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Existing local fixtures may predate the anonymous-signup guard.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT false;
-- Supabase's request-scoped helpers, which RLS policies read.
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE
AS $$ SELECT COALESCE(current_setting('request.jwt.claim.role', true), current_user::text) $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE
AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
-- Supabase records applied migrations here; 0034 reads it.
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version TEXT PRIMARY KEY, name TEXT, statements TEXT[]);

-- track_event belongs to the sibling wallet product, which shares this
-- Postgres project but not this repo (see 0031's header). 0031 revokes it, so
-- a rebuild from this folder alone needs it to exist.
CREATE OR REPLACE FUNCTION public.track_event(p_user_id UUID, p_name TEXT, p_props JSONB)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT NULL::void $$;
