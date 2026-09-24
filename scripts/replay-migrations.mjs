#!/usr/bin/env node
/**
 * Rebuild the database from this repo alone, on a fresh Postgres.
 *
 * Applies schema/prereqs.sql, then schema/*.sql, then every
 * schema/supabase/*.sql in name order — the order apply-migrations uses. A
 * failure means the repo cannot reproduce production: a migration that
 * depends on an object no file creates, or one that is not idempotent within
 * its own run.
 *
 * Nothing here talks to production: it wants a DATABASE_URL of its own and
 * refuses a Supabase host outright.
 *
 * Usage: DATABASE_URL=postgres://... node scripts/replay-migrations.mjs
 */
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = join(root, 'packages/db/schema');

const url = process.env.DATABASE_URL;
if (!url) {
    console.error('DATABASE_URL is required (a throwaway database, never production)');
    process.exit(2);
}
if (/supabase\.(co|com)/.test(url)) {
    console.error('refusing to replay migrations against a Supabase host');
    process.exit(2);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

// The three Supabase roles every migration's grants name.
await client.query(`DO $$ DECLARE r TEXT; BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('CREATE ROLE %I NOLOGIN', r);
        END IF;
    END LOOP; END $$`);

const apply = async (label, path) => {
    try {
        await client.query(await readFile(path, 'utf8'));
        return true;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`✖ ${label}: ${err.message}`);
        return false;
    }
};

let failures = 0;
if (!await apply('prereqs.sql', join(SCHEMA, 'prereqs.sql'))) process.exit(1);

const base = (await readdir(SCHEMA)).filter((f) => f.endsWith('.sql') && f !== 'prereqs.sql').sort();
const supabase = (await readdir(join(SCHEMA, 'supabase'))).filter((f) => f.endsWith('.sql')).sort();

for (const f of base) if (!await apply(f, join(SCHEMA, f))) failures += 1;
for (const f of supabase) if (!await apply(f, join(SCHEMA, 'supabase', f))) failures += 1;

await client.end();
const total = base.length + supabase.length;
if (failures) {
    console.error(`\n${failures} of ${total} migrations failed on a fresh database.`);
    process.exit(1);
}
console.log(`all ${total} migrations applied to a fresh database`);
