#!/usr/bin/env node
// Disposable replay DB only. Supabase owns auth.mfa_factors; bare replay needs a fixture.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) throw new Error('local DATABASE_URL required');
const a = new pg.Client({ connectionString: url });
const b = new pg.Client({ connectionString: url });
await a.connect(); await b.connect();
const user = randomUUID(), factor = randomUUID(), newer = randomUUID();
let createdFactors = false;
const call = async (fn, args = [], client = a) => (await client.query(
    `SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) value`, args)).rows[0].value;
const status = () => call('mfa_recovery_status', [user]);
const replace = (hashes, ids = [factor], batch = randomUUID(), client = a) => call('mfa_recovery_replace', [user, hashes, batch, ids], client);
try {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0419_mfa_recovery_codes.sql', import.meta.url), 'utf8');
    await a.query(migration); await a.query(migration);
    const exists = (await a.query("SELECT to_regclass('auth.mfa_factors') value")).rows[0].value;
    if (!exists) {
        await a.query('CREATE TABLE auth.mfa_factors(id uuid PRIMARY KEY,user_id uuid,factor_type text,status text)');
        createdFactors = true;
    }
    // Committed fixture permits two real connections to race. This DB is thrown away.
    await a.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [user, `${user}@test.veyrnox.ai`]);
    await a.query("INSERT INTO auth.mfa_factors(id,user_id,factor_type,status) VALUES($1,$2,'totp','verified')", [factor, user]);
    assert.equal((await status()).needs_regeneration, true);
    assert.equal((await status()).batch_id, null);
    assert.equal(await replace(['a','b','b']), 2, 'deduplicates hashes');
    assert.equal((await status()).usable, 2);
    const consumed = await Promise.all([call('mfa_recovery_consume', [user, 'a']), call('mfa_recovery_consume', [user, 'a'], b)]);
    assert.equal(consumed.filter(r => r.consumed).length, 1, 'concurrent consume is one-time');
    assert.deepEqual(consumed.find(r => r.consumed).factor_ids, [factor]);
    assert.equal((await status()).unused, 1);

    // Hold A's lock while B tries to replace, then commit. Exactly B's batch must remain.
    const batchA = randomUUID(), batchB = randomUUID();
    await a.query('BEGIN'); await replace(['c','d'], [factor], batchA);
    const pidB = (await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    const second = replace(['e','f'], [factor], batchB, b);
    let waiting = false;
    for (let i = 0; i < 100; i++) {
        waiting = (await a.query('SELECT cardinality(pg_blocking_pids($1)) > 0 waiting', [pidB])).rows[0].waiting;
        if (waiting) break;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(waiting, true, 'second replace waits on per-user advisory lock');
    await a.query('COMMIT'); await second;
    const rows = (await a.query('SELECT DISTINCT batch_id FROM public.mfa_recovery_codes WHERE user_id=$1', [user])).rows;
    assert.deepEqual(rows, [{ batch_id: batchB }]);
    assert.equal((await status()).unused, 2, 'replace resets consumed codes');

    // A newly enrolled factor is never authorised by an older batch.
    await a.query("INSERT INTO auth.mfa_factors(id,user_id,factor_type,status) VALUES($1,$2,'totp','verified')", [newer, user]);
    assert.equal((await status()).usable, 2);
    assert.equal((await status()).needs_regeneration, true, 'partial coverage needs regeneration');
    const bound = await call('mfa_recovery_consume', [user, 'e']);
    assert.deepEqual(bound.factor_ids, [factor], 'only the bound factor, never the new factor');
    await a.query('DELETE FROM auth.mfa_factors WHERE id=$1', [factor]);
    assert.equal((await status()).unused, 1);
    assert.equal((await status()).usable, 0);
    assert.equal((await status()).needs_regeneration, true, 'old unused codes do not count as ready');
    assert.deepEqual(await call('mfa_recovery_consume', [user,'f']), { consumed: true, factor_ids: [], stale: true });
    await replace(['g','h'], [newer]);
    assert.equal((await status()).needs_regeneration, false);
    assert.equal((await status()).usable, 2);

    const attempts = await Promise.all(Array.from({ length: 6 }, (_, i) => call('mfa_recovery_attempt', [user], i % 2 ? a : b)));
    assert.equal(attempts.filter(Boolean).length, 5, 'shared hard attempt ceiling');
    await a.query("UPDATE public.mfa_recovery_attempts SET attempted_at=ARRAY[now()-interval '16 minutes'] WHERE user_id=$1", [user]);
    assert.equal(await call('mfa_recovery_attempt', [user]), true, 'sliding window expires');

    for (const role of ['anon','authenticated']) {
        for (const signature of ['mfa_recovery_attempt(uuid)','mfa_recovery_status(uuid)','mfa_recovery_consume(uuid,text)','mfa_recovery_replace(uuid,text[],uuid,uuid[])']) {
            const p = (await a.query("SELECT has_function_privilege($1,'public.' || $2,'EXECUTE') allowed", [role,signature])).rows[0];
            assert.equal(p.allowed, false, `${role}: ${signature}`);
        }
        for (const table of ['mfa_recovery_codes','mfa_recovery_attempts']) {
            assert.equal((await a.query("SELECT has_table_privilege($1,'public.' || $2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed", [role,table])).rows[0].allowed, false);
        }
    }
    const secure = (await a.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.mfa_recovery_codes'::regclass")).rows[0];
    assert.deepEqual(secure, { relrowsecurity: true, relforcerowsecurity: true });
    await a.query('DELETE FROM auth.users WHERE id=$1', [user]);
    for (const table of ['mfa_recovery_codes','mfa_recovery_attempts']) {
        assert.equal((await a.query(`SELECT count(*)::int n FROM public.${table} WHERE user_id=$1`, [user])).rows[0].n, 0, 'erased with auth account');
    }
    console.log('mfa recovery SQL: ok (idempotence, consume race, replace race, factor binding, stale/partial coverage, rate limit, ACL/RLS, account cascade)');
} finally {
    await a.query('ROLLBACK'); await b.query('ROLLBACK');
    await a.query('DELETE FROM auth.mfa_factors WHERE user_id=$1', [user]);
    await a.query('DELETE FROM auth.users WHERE id=$1', [user]);
    if (createdFactors) await a.query('DROP TABLE auth.mfa_factors');
    await a.end(); await b.end();
}
