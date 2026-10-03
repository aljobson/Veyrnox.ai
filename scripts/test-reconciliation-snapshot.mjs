// Run only against a throwaway replay database. Every fixture rolls back.
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)) {
    throw new Error('local replay DATABASE_URL required');
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
    await client.query('BEGIN');
    // 0185 replaced 0128's two functions (a fifth count), so it is the file replayed.
    const migration = await readFile(new URL('../packages/db/schema/supabase/0185_reconcile_status_subscription_credits.sql', import.meta.url), 'utf8');
    await client.query(migration);
    await client.query(migration);
    const { rows: [fresh] } = await client.query('SELECT * FROM public.reconcile_status()');
    assert.deepEqual(fresh, { balance_drift: 0, free_credit_drift: 0, top_up_drift: 0, failed_refund_drift: 0, subscription_credit_drift: 0 });
    const { rows: [acl] } = await client.query(`SELECT
        has_function_privilege('anon', 'public.refresh_reconciliation_snapshot()', 'EXECUTE') AS anon_refresh,
        has_function_privilege('authenticated', 'public.reconcile_status()', 'EXECUTE') AS user_read,
        has_table_privilege('anon', 'public.reconciliation_snapshot', 'SELECT') AS anon_table,
        relrowsecurity AND relforcerowsecurity AS rls
        FROM pg_class WHERE oid = 'public.reconciliation_snapshot'::regclass`);
    assert.deepEqual(acl, { anon_refresh: false, user_read: false, anon_table: false, rls: true });
    // Drift in the Subscription bucket reaches the snapshot.
    await client.query('SAVEPOINT sub');
    // This script runs first on a fresh replay, so it makes its own account.
    const auth = randomUUID();
    await client.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [auth, `${auth}@example.invalid`]);
    const { rows: [u] } = await client.query('SELECT b.user_id FROM public.credit_balances b JOIN public.users x ON x.id = b.user_id WHERE x.auth_id = $1', [auth]);
    assert.ok(u, 'the confirmed insert provisioned a balance row');
    await client.query(`UPDATE public.credit_balances SET balance = balance + 5, subscription_balance = 5,
        subscription_expires_at = now() + interval '1 day' WHERE user_id = $1`, [u.user_id]);
    await client.query('SELECT public.refresh_reconciliation_snapshot()');
    const { rows: [drift] } = await client.query('SELECT * FROM public.reconcile_status()');
    assert.equal(drift.subscription_credit_drift, 1);
    await client.query('ROLLBACK TO SAVEPOINT sub');
    const { rows: [granted] } = await client.query(`SELECT has_function_privilege('anon', 'public.reconcile_status()', 'EXECUTE') AS anon,
        has_function_privilege('service_role', 'public.reconcile_status()', 'EXECUTE') AS service`);
    assert.deepEqual(granted, { anon: true, service: true });
    await client.query(`UPDATE public.reconciliation_snapshot SET balance_drift = 7`);
    // If a public read touches the live aggregate, it now fails immediately.
    await client.query(`CREATE OR REPLACE FUNCTION public.reconcile_balances()
        RETURNS TABLE (user_id UUID, balance INTEGER, ledger_sum BIGINT)
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'live aggregate reached'; END $$`);
    await client.query('SET LOCAL ROLE anon');
    const { rows: [cached] } = await client.query('SELECT * FROM public.reconcile_status()');
    assert.equal(cached.balance_drift, 7);
    await client.query('RESET ROLE');
    await client.query(`UPDATE public.reconciliation_snapshot SET observed_at = now() - interval '46 minutes'`);
    await client.query('SAVEPOINT stale');
    await client.query('SET LOCAL ROLE anon');
    await assert.rejects(client.query('SELECT * FROM public.reconcile_status()'), /unavailable or stale/);
    await client.query('ROLLBACK TO SAVEPOINT stale');
    await client.query('DELETE FROM public.reconciliation_snapshot');
    await client.query('SAVEPOINT missing');
    await assert.rejects(client.query('SELECT * FROM public.reconcile_status()'), /unavailable or stale/);
    await client.query('ROLLBACK TO SAVEPOINT missing');
    console.log('snapshot replay, ACL/RLS, cached drift, aggregate isolation and freshness checks passed');
} finally {
    await client.query('ROLLBACK');
    await client.end();
}
