#!/usr/bin/env node
// Disposable local Postgres only. Migration, fixtures and every assertion roll back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !['postgres:', 'postgresql:'].includes(url.protocol)) throw Error('local throwaway database required');
const db = new pg.Client({ connectionString: url.href });
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const value = async (sql, args = []) => (await q(sql, args))[0].value;
const migration = (await readFile(new URL('../packages/db/schema/supabase/0290_reconciliation_observations.sql', import.meta.url), 'utf8'))
    .replace(/^BEGIN;\n/m, '').replace(/^COMMIT;\n?$/m, '');
const columns = 'observed_at, balance_drift, free_credit_drift, top_up_drift, failed_refund_drift, subscription_credit_drift, free_allowance_drift, referral_drift';
const latest = async () => (await q(`SELECT ${columns} FROM private.reconciliation_observations ORDER BY id DESC LIMIT 1`))[0];
const snapshot = async () => (await q(`SELECT ${columns} FROM public.reconciliation_snapshot WHERE singleton`))[0];
const size = async () => value('SELECT count(*)::integer AS value FROM private.reconciliation_observations');
const expected = { balance_drift: 0, free_credit_drift: 0, top_up_drift: 0, failed_refund_drift: 0,
    subscription_credit_drift: 0, free_allowance_drift: 0, referral_drift: 0 };
let passed = 0;
async function check(name, fn) {
    await db.query('SAVEPOINT test_case');
    try { await fn(); passed++; console.log('  ok  ' + name); }
    finally { await db.query('ROLLBACK TO test_case'); }
}
async function rejects(sql, pattern, args = []) {
    await db.query('SAVEPOINT rejected');
    try { await assert.rejects(q(sql, args), pattern); }
    finally { await db.query('ROLLBACK TO rejected'); }
}
await db.connect();
try {
    await db.query('BEGIN');
    await check('migration replay appends real measurements without replacing history', async () => {
        const before = await size();
        const retained = await q('SELECT * FROM private.reconciliation_observations ORDER BY id');
        await q('UPDATE public.reconciliation_snapshot SET balance_drift=77');
        await db.query(migration); await db.query(migration);
        assert.equal(await size(), before + 2);
        assert.deepEqual((await q('SELECT * FROM private.reconciliation_observations ORDER BY id')).slice(0, before), retained);
        assert.deepEqual(await latest(), await snapshot());
        const { observed_at, ...counts } = await latest();
        assert.ok(observed_at instanceof Date); assert.deepEqual(counts, expected);
        assert.deepEqual((await q('SELECT * FROM public.reconcile_status()'))[0], expected);
    });
    await check('nonzero live drift remains recorded after a later clean refresh', async () => {
        const auth = randomUUID();
        await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, auth + '@example.invalid']);
        const user = await value('SELECT id AS value FROM public.users WHERE auth_id=$1', [auth]);
        // Deliberately corrupt and restore only this disposable fixture, never a remote balance.
        await q('UPDATE public.credit_balances SET balance=balance+1 WHERE user_id=$1', [user]);
        await q('SELECT public.refresh_reconciliation_snapshot()');
        const drift = (await q('SELECT * FROM private.reconciliation_observations ORDER BY id DESC LIMIT 1'))[0];
        assert.equal(drift.balance_drift, 1); assert.deepEqual(await latest(), await snapshot());
        await q('UPDATE public.credit_balances SET balance=balance-1 WHERE user_id=$1', [user]);
        await q('SELECT public.refresh_reconciliation_snapshot()');
        assert.equal((await latest()).balance_drift, 0);
        assert.deepEqual((await q('SELECT * FROM private.reconciliation_observations WHERE id=$1', [drift.id]))[0], drift);
    });
    await check('a failed aggregate commits neither partial history nor a new snapshot', async () => {
        const before = await size(), cached = await snapshot();
        await q(`CREATE OR REPLACE FUNCTION public.reconcile_balances()
            RETURNS TABLE(user_id UUID,balance INTEGER,ledger_sum BIGINT) LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'fixture aggregate failed'; END $$`);
        await rejects('SELECT public.refresh_reconciliation_snapshot()', /fixture aggregate failed/);
        assert.equal(await size(), before); assert.deepEqual(await snapshot(), cached);
        await q('SET LOCAL ROLE anon');
        assert.deepEqual((await q('SELECT * FROM public.reconcile_status()'))[0], expected);
        await q('RESET ROLE');
    });
    await check('even owner updates, deletes and truncation cannot rewrite observed counts', async () => {
        const before = await q('SELECT * FROM private.reconciliation_observations ORDER BY id');
        for (const sql of ['UPDATE private.reconciliation_observations SET balance_drift=1',
            'DELETE FROM private.reconciliation_observations', 'TRUNCATE private.reconciliation_observations']) {
            await rejects(sql, /append-only/);
        }
        assert.deepEqual(await q('SELECT * FROM private.reconciliation_observations ORDER BY id'), before);
    });
    await check('history is forced-RLS, service-readable and unwritable by API roles', async () => {
        assert.equal(await value(`SELECT relrowsecurity AND relforcerowsecurity AS value FROM pg_class
            WHERE oid='private.reconciliation_observations'::regclass`), true);
        for (const role of ['anon', 'authenticated', 'service_role']) {
            for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
                assert.equal(await value('SELECT has_table_privilege($1,$2,$3) AS value',
                    [role, 'private.reconciliation_observations', privilege]), role === 'service_role' && privilege === 'SELECT');
            }
            assert.equal(await value('SELECT has_sequence_privilege($1,$2,$3) AS value',
                [role, 'private.reconciliation_observations_id_seq', 'USAGE']), false);
        }
        for (const role of ['anon', 'authenticated']) {
            await q('SET LOCAL ROLE ' + role);
            await rejects('SELECT * FROM private.reconciliation_observations', /permission denied/);
            await rejects('SELECT public.refresh_reconciliation_snapshot()', /permission denied/);
            await q('RESET ROLE');
        }
        await q('SET LOCAL ROLE service_role');
        assert.ok((await q('SELECT * FROM private.reconciliation_observations')).length > 0);
        await q('SELECT public.refresh_reconciliation_snapshot()');
        const serviceSample = await latest();
        await q('RESET ROLE');
        assert.deepEqual(serviceSample, await snapshot());
    });
    console.log('\n' + passed + ' observation checks passed; all fixture changes rolled back');
} finally { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
