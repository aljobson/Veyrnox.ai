#!/usr/bin/env node
// Real local SQL drift -> counts-only HTTP -> actual hourly CLI exit code.
// Everything rolls back; no production credentials, provider requests or production grants.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !['postgres:', 'postgresql:'].includes(url.protocol)) throw Error('local throwaway database required');
const db = new pg.Client({ connectionString: url.href });
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const value = async (sql, args = []) => (await q(sql, args))[0].value;
const sql = (await readFile(new URL('../packages/db/schema/supabase/0264_reconciliation_free_allowance_referrals.sql', import.meta.url), 'utf8'))
    .replace(/^BEGIN;\n/m, '').replace(/^COMMIT;\n?$/m, '');
const legacy = await readFile(new URL('../packages/db/schema/supabase/0185_reconcile_status_subscription_credits.sql', import.meta.url), 'utf8');
let response = [];
const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/rest/v1/rpc/reconcile_status') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(response));
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const watch = async row => {
    response = [row];
    try {
        const result = await promisify(execFile)(process.execPath, ['scripts/check-reconcile.mjs'], {
            env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:' + server.address().port, SUPABASE_ANON_KEY: 'local-fixture' },
        });
        return { code: 0, output: result.stdout + result.stderr };
    } catch (e) { return { code: e.code, output: e.stdout + e.stderr }; }
};
let passed = 0;
async function check(name, fn) {
    await db.query('SAVEPOINT test_case');
    try { await fn(); passed++; console.log('  ok  ' + name); }
    finally { await db.query('ROLLBACK TO test_case'); }
}
async function person() {
    const auth = randomUUID();
    await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, auth + '@example.invalid']);
    return value('SELECT id AS value FROM public.users WHERE auth_id=$1', [auth]);
}
const snapshot = async () => (await q('SELECT * FROM public.reconcile_status()'))[0];
const expected = { balance_drift: 0, free_credit_drift: 0, top_up_drift: 0, failed_refund_drift: 0,
    subscription_credit_drift: 0, free_allowance_drift: 0, referral_drift: 0 };
await db.connect();
try {
    await db.query('BEGIN'); await db.query(sql); await db.query(sql);
    await check('safe replay populates all seven actual zero counts and the watcher exits clean', async () => {
        assert.deepEqual(await snapshot(), expected);
        assert.equal((await watch(await snapshot())).code, 0);
    });
    await check('allowance drift hidden by 0185 reaches the refreshed snapshot and hourly failure', async () => {
        const user = await person();
        await q(`INSERT INTO public.model_free_allowance_claims(user_id,idempotency_key,model_id,day,state)
            SELECT $1,'drift-'||i,'chat-mistral-small',(now() AT TIME ZONE 'UTC')::date,'TAKEN'
            FROM generate_series(1,4) i`, [user]);
        assert.equal((await q('SELECT * FROM public.reconcile_free_allowance()')).length, 1);
        await db.query(legacy);
        assert.equal((await snapshot()).free_allowance_drift, undefined, 'old public snapshot misses this live drift');
        await db.query(sql);
        const measured = await snapshot();
        assert.deepEqual(measured, { ...expected, free_allowance_drift: 1 });
        const result = await watch(measured);
        assert.equal(result.code, 1); assert.match(result.output, /free_allowance_drift/);
    });
    await check('unmatched local referral grant reaches the hourly failure while balances still reconcile', async () => {
        const user = await person();
        const grant = await value('SELECT public.ledger_grant($1,1,$2,$3) AS value', [user, 'grant:referral', 'referral-' + randomUUID()]);
        assert.equal(grant.ok, true);
        await db.query('SELECT public.refresh_reconciliation_snapshot()');
        const measured = await snapshot();
        assert.deepEqual(measured, { ...expected, referral_drift: 1 });
        const result = await watch(measured);
        assert.equal(result.code, 1); assert.match(result.output, /referral_drift/);
    });
    await check('public reads use only cached counts and keep table/refresh/live aggregates private', async () => {
        const acl = (await q(`SELECT has_function_privilege('anon','public.refresh_reconciliation_snapshot()','EXECUTE') AS refresh,
            has_function_privilege('authenticated','public.reconcile_status()','EXECUTE') AS authenticated_read,
            has_function_privilege('anon','public.reconcile_free_allowance()','EXECUTE') AS allowance,
            has_function_privilege('anon','public.reconcile_referrals()','EXECUTE') AS referrals,
            has_table_privilege('anon','public.reconciliation_snapshot','SELECT') AS direct_read,
            relrowsecurity AND relforcerowsecurity AS rls FROM pg_class WHERE oid='public.reconciliation_snapshot'::regclass`))[0];
        assert.deepEqual(acl, { refresh: false, authenticated_read: false, allowance: false, referrals: false, direct_read: false, rls: true });
        await db.query(`CREATE OR REPLACE FUNCTION public.reconcile_free_allowance() RETURNS TABLE(kind TEXT,ref TEXT,detail TEXT)
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'live aggregate reached'; END $$`);
        await db.query('SET LOCAL ROLE anon'); assert.deepEqual(await snapshot(), expected); await db.query('RESET ROLE');
    });
    await check('stale or future snapshots still fail, and invalid measurements never look clean', async () => {
        for (const delta of ['-46 minutes', '1 minute']) {
            await db.query('SAVEPOINT invalid_time');
            await q('UPDATE public.reconciliation_snapshot SET observed_at=statement_timestamp()+$1::interval', [delta]);
            await assert.rejects(snapshot(), /unavailable or stale/);
            await db.query('ROLLBACK TO invalid_time');
        }
        for (const invalid of [null, -1, '0']) {
            const result = await watch({ ...expected, referral_drift: invalid });
            assert.equal(result.code, 2, 'unknown is not zero or drift');
        }
    });
    console.log('\n' + passed + ' checks passed');
} finally {
    await db.query('ROLLBACK').catch(() => {}); await db.end();
    await new Promise(resolve => server.close(resolve));
}
