#!/usr/bin/env node
// 0172 (docs/product/ISSUES.md S5): a new function is not callable by PUBLIC,
// anon or authenticated unless a migration grants it on purpose. Runs against
// the full migration replay (ledger-tests.yml). Every fixture is rolled back.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const can = async (role, fn) => (await q('SELECT has_function_privilege($1, $2, $3) AS p', [role, fn, 'EXECUTE']))[0].p;

// Every function the browser roles may call, each granted explicitly by the
// migration named. A new entry here is a deliberate decision, not a default.
const BROWSER_CALLABLE = new Set([
    'public.applied_migration_names()',         // 0034, anon: migration-ledger CI check
    'public.catalog_watch()',                   // 0030, anon: fal-catalog-watch; active fal rows only since 0256
    'public.reconcile_status()',                // 0128, anon: reconcile-watch
    'public.recovery_status()',                 // 0131, anon: recovery-health
    'public.create_project(uuid,text,text)',    // 0135+, authenticated: tenant wrappers (ADR-0051)
    'public.mutate_project(uuid,integer,text,boolean)',
    'public.save_project_document(uuid,integer,jsonb,text,integer)',
    'public.reserve_project_asset(uuid,text,bigint,text)',
    'public.consume_project_asset_inspection(uuid,uuid)',
    'private.create_project(uuid,text,text)',
    'private.mutate_project(uuid,integer,text,boolean)',
    'private.save_project_document(uuid,integer,jsonb,text,integer)',
    'private.reserve_project_asset(uuid,text,bigint,text)',
    'private.org_role(uuid)',
    'private.workspace_role(uuid)',
    'private.project_role(uuid)',
]);

try {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0172_default_execute_revoke_public.sql', import.meta.url), 'utf8');
    await c.query('BEGIN'); await c.query(migration); await c.query(migration); await c.query('ROLLBACK');

    // A function created now, in either schema, is callable by no browser role.
    await c.query('BEGIN');
    await q('CREATE FUNCTION public.zz_probe_0172() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$');
    await q('CREATE FUNCTION private.zz_probe_0172() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$');
    for (const fn of ['public.zz_probe_0172()', 'private.zz_probe_0172()']) {
        for (const role of ['public', 'anon', 'authenticated']) assert.equal(await can(role, fn), false, `${role} on ${fn}`);
    }
    await c.query('ROLLBACK');

    // Control: with PUBLIC's default restored, the same probe leaks to anon —
    // the check above is not passing by accident.
    await c.query('BEGIN');
    await q('ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC');
    await q('CREATE FUNCTION public.zz_probe_0172() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$');
    assert.equal(await can('anon', 'public.zz_probe_0172()'), true);
    await c.query('ROLLBACK');

    // Today's surface: nothing outside the allowlist, extension members aside.
    const exposed = await q(`
        SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS fn,
               pg_catalog.oidvectortypes(p.proargtypes) AS types, n.nspname, p.proname
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'private')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
          AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`);
    const unexpected = exposed
        .map((r) => `${r.nspname}.${r.proname}(${r.types.replace(/\s+/g, '').replace(/character varying/g, 'varchar')})`)
        .filter((sig) => !BROWSER_CALLABLE.has(sig));
    assert.deepEqual(unexpected, [], 'functions callable by anon/authenticated without an allowlist entry');
    assert.equal(await can('public', 'public.ledger_entries_append_only()'), false);

    console.log(`Default privileges: new functions in public/private are not callable by PUBLIC/anon/authenticated; ${exposed.length} browser-callable functions, all allowlisted.`);
} finally { await c.end(); }
