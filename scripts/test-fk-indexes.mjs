#!/usr/bin/env node
// 0176 (docs/product/ISSUES.md S12): every single-column foreign key in
// public/private has an index leading with that column, so lookups by the key
// and RESTRICT checks never scan the child table. Runs against the full replay.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
try {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0176_fk_lookup_indexes.sql', import.meta.url), 'utf8');
    await c.query('BEGIN'); await c.query(migration); await c.query(migration); await c.query('ROLLBACK');

    const { rows } = await c.query(`
        SELECT co.conrelid::regclass::text || '.' || a.attname AS fk
        FROM pg_constraint co
        JOIN pg_class t ON t.oid = co.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = co.conkey[1]
        WHERE co.contype = 'f' AND n.nspname IN ('public', 'private') AND array_length(co.conkey, 1) = 1
          AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = co.conrelid AND i.indkey[0] = co.conkey[1])
        ORDER BY 1`);
    assert.deepEqual(rows.map((r) => r.fk), [], 'single-column foreign keys without a leading index');

    const plan = (await c.query(`EXPLAIN SELECT id FROM public.users WHERE lower(email) = 'x@example.invalid'`)).rows.map((r) => r['QUERY PLAN']).join('\n');
    assert.match(plan, /users_email_lower_idx|Seq Scan/, plan); // tiny tables may still seq-scan
    assert.ok((await c.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'users_email_lower_idx'`)).rowCount === 1);

    console.log('FK indexes: every single-column foreign key in public/private has a leading index; lower(email) is indexed.');
} finally { await c.end(); }
