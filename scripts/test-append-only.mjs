#!/usr/bin/env node
// 0177 (docs/product/ISSUES.md S13): every append-only table refuses TRUNCATE,
// not just row UPDATE/DELETE. Runs against the full replay; fixtures roll back.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
try {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0177_append_only_no_truncate.sql', import.meta.url), 'utf8');
    await c.query('BEGIN'); await c.query(migration); await c.query(migration); await c.query('ROLLBACK');

    // Tables with a row trigger that refuses UPDATE and DELETE (append-only),
    // minus project_assets, whose row trigger guards a state machine instead.
    const { rows } = await c.query(`
        SELECT DISTINCT t.tgrelid::regclass::text AS tbl,
               EXISTS (SELECT 1 FROM pg_trigger s WHERE s.tgrelid = t.tgrelid AND (s.tgtype & 32) <> 0) AS has_truncate
        FROM pg_trigger t
        JOIN pg_class r ON r.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal
          AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 8) <> 0 AND (t.tgtype & 16) <> 0
          AND r.relname <> 'project_assets'
        ORDER BY 1`);
    assert.ok(rows.length >= 15, `expected the 15 append-only tables, found ${rows.length}`);
    assert.deepEqual(rows.filter((r) => !r.has_truncate).map((r) => r.tbl), [], 'append-only tables without a TRUNCATE guard');

    for (const { tbl } of rows) {
        await c.query('BEGIN');
        await assert.rejects(c.query(`TRUNCATE ${tbl} CASCADE`), /append-only \(attempted TRUNCATE\)/, tbl);
        await c.query('ROLLBACK');
    }
    console.log(`Append-only: ${rows.length} tables refuse TRUNCATE as well as UPDATE/DELETE.`);
} finally { await c.end(); }
