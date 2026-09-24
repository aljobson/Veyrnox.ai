// Run only against a throwaway replay database. Every fixture rolls back.
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)) {
    throw new Error('local replay DATABASE_URL required');
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
    await client.query('BEGIN');
    const migration = await readFile(new URL('../packages/db/schema/supabase/0128_reconciliation_snapshot.sql', import.meta.url), 'utf8');
    await client.query(migration);
    await client.query(migration);
    const { rows: [fresh] } = await client.query('SELECT * FROM public.reconcile_status()');
    assert.deepEqual(fresh, { balance_drift: 0, free_credit_drift: 0, top_up_drift: 0, failed_refund_drift: 0 });
    const { rows: [acl] } = await client.query(`SELECT
        has_function_privilege('anon', 'public.refresh_reconciliation_snapshot()', 'EXECUTE') AS anon_refresh,
        has_function_privilege('authenticated', 'public.reconcile_status()', 'EXECUTE') AS user_read,
        has_table_privilege('anon', 'public.reconciliation_snapshot', 'SELECT') AS anon_table,
        relrowsecurity AND relforcerowsecurity AS rls
        FROM pg_class WHERE oid = 'public.reconciliation_snapshot'::regclass`);
    assert.deepEqual(acl, { anon_refresh: false, user_read: false, anon_table: false, rls: true });
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
