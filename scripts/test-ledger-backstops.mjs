#!/usr/bin/env node
// 0171 (docs/product/ISSUES.md S6): unique indexes behind the ledger's
// one-per rules. Runs against the full migration replay (ledger-tests.yml),
// after the Cinema scripts, so real unlock rows exist. Every fixture is rolled
// back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const unique = async (sql, args = []) => {
    await c.query('SAVEPOINT u');
    try { await c.query(sql, args); assert.fail('expected a unique violation'); }
    catch (err) { assert.equal(err.code, '23505', err.message); }
    finally { await c.query('ROLLBACK TO SAVEPOINT u'); }
};

async function user() {
    const auth = randomUUID();
    await q('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [auth, `${auth}@example.invalid`]);
    return { auth, id: (await one('SELECT id FROM public.users WHERE auth_id = $1', [auth])).id };
}

try {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0171_ledger_unique_backstops.sql', import.meta.url), 'utf8');
    await c.query('BEGIN'); await c.query(migration); await c.query(migration); await c.query('ROLLBACK');

    for (const name of ['ledger_entries_one_refund_per_job', 'ledger_entries_one_signup_grant',
        'cinema_unlocks_one_per_ledger_entry', 'cinema_unlocks_one_per_reversal_entry']) {
        const idx = await one('SELECT i.indisunique FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1', [name]);
        assert.equal(idx?.indisunique, true, name);
    }

    await c.query('BEGIN');

    // One refund per job: the RPC stays idempotent, a second raw row is impossible.
    const a = await user();
    const debit = (await one(`SELECT public.ledger_debit($1, $2, 3, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb) AS r`,
        [a.id, randomUUID()])).r;
    assert.equal(debit.ok, true, JSON.stringify(debit));
    const first = (await one(`SELECT public.ledger_refund($1, $2, 3, 'refund:provider_failed') AS r`, [debit.job_id, a.id])).r;
    const again = (await one(`SELECT public.ledger_refund($1, $2, 3, 'refund:stuck_submitted') AS r`, [debit.job_id, a.id])).r;
    assert.deepEqual([first.ok, again.ok, again.idempotent, again.entry_id], [true, true, true, first.entry_id]);
    await unique(`INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id)
                  VALUES ($1, 3, 0, 'refund:duplicate', $2)`, [a.id, debit.job_id]);

    // One signup grant per user (the trigger granted it on the confirmed insert).
    assert.equal(Number((await one(`SELECT count(*) FROM public.ledger_entries WHERE user_id = $1 AND reason = 'grant:signup'`, [a.id])).count), 1);
    await one('SELECT public.signup_grant($1, $2)', [a.auth, `${a.auth}@example.invalid`]);
    assert.equal(Number((await one(`SELECT count(*) FROM public.ledger_entries WHERE user_id = $1 AND reason = 'grant:signup'`, [a.id])).count), 1);
    await unique(`INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason) VALUES ($1, 10, 10, 'grant:signup')`, [a.id]);

    // One Cinema unlock per ledger entry, and one per reversal entry.
    const unlock = await one('SELECT * FROM public.cinema_unlocks ORDER BY created_at LIMIT 1');
    assert.ok(unlock, 'test-cinema-unlocks.mjs left unlock rows to check against');
    await unique(`INSERT INTO public.cinema_unlocks (user_id, content_id, ledger_entry_id, credits, consent_version)
                  VALUES ($1, $2, $3, 6, 'x')`, [unlock.user_id, unlock.content_id, unlock.ledger_entry_id]);
    const reversed = await one('SELECT * FROM public.cinema_unlocks WHERE reversal_entry_id IS NOT NULL LIMIT 1');
    assert.ok(reversed, 'test-cinema-unlocks.mjs left a reversed unlock');
    const other = await one('SELECT * FROM public.cinema_unlocks WHERE reversal_entry_id IS NULL AND id <> $1 LIMIT 1', [reversed.id]);
    await unique(`UPDATE public.cinema_unlocks SET reversed_at = now(), reversal_entry_id = $2 WHERE id = $1`,
        [other.id, reversed.reversal_entry_id]);

    await c.query('ROLLBACK');

    // A duplicate already in the table stops the migration with a readable message.
    await c.query('BEGIN');
    const b = await user();
    const d2 = (await one(`SELECT public.ledger_debit($1, $2, 3, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb) AS r`,
        [b.id, randomUUID()])).r;
    await q('DROP INDEX public.ledger_entries_one_refund_per_job');
    for (let i = 0; i < 2; i++) {
        await q(`INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id) VALUES ($1, 3, 0, 'refund:legacy', $2)`, [b.id, d2.job_id]);
    }
    await assert.rejects(c.query(migration), /0171: 1 job\(s\) already have more than one refund row/);
    await c.query('ROLLBACK');

    console.log('Ledger backstops: indexes present, idempotent RPCs unchanged, duplicate refunds/signup grants/unlock entries refused, existing duplicates stop the migration.');
} finally { await c.end(); }
