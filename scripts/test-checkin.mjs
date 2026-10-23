#!/usr/bin/env node
// Host-only Postgres acceptance. Transaction fixtures roll back; concurrency uses
// an isolated disposable database so no append-only test grants are left behind.
// Each run requires CREATE DATABASE and permission to replay migrations in it.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { checkinConcurrency } from './lib/test-checkin-concurrency.mjs';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const call = async (fn, auth) => (await one(`SELECT public.${fn}($1) AS r`, [auth])).r;
async function user(confirmed = true) {
    const auth = randomUUID();
    await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,$3)', [auth, `${auth}@example.invalid`, confirmed ? new Date() : null]);
    const { id } = await one('SELECT id FROM public.users WHERE auth_id=$1', [auth]);
    assert.notEqual(id, auth, 'exercise Auth UUID versus internal id');
    return { id, auth };
}
const claim = u => call('daily_checkin', u.auth);
const status = u => call('read_checkin_status', u.auth);
const balance = async u => (await one('SELECT balance FROM public.credit_balances WHERE user_id=$1', [u.id])).balance;
const seed = (u, streak, days) => q(`INSERT INTO public.checkin_streaks(user_id,streak,last_checkin_date)
    VALUES($1,$2,(now() AT TIME ZONE 'utc')::date - $3::integer)
    ON CONFLICT(user_id) DO UPDATE SET streak=EXCLUDED.streak,last_checkin_date=EXCLUDED.last_checkin_date`, [u.id, streak, days]);
async function refused(role, sql, args = []) {
    await q('SAVEPOINT denied');
    try { await q(`SET LOCAL ROLE ${role}`); await q(sql, args); assert.fail('browser role was allowed'); }
    catch (e) { assert.equal(e.code, '42501'); }
    finally { await q('ROLLBACK TO SAVEPOINT denied'); }
}
try {
    await q('BEGIN');
    await q("SET LOCAL timezone='Pacific/Honolulu'"); // dates must still be UTC
    const migration = await readFile(new URL('../packages/db/schema/supabase/0368_daily_checkin.sql', import.meta.url), 'utf8');
    await q(migration); await q(migration);
    const rewards = [1, 1, 2, 2, 2, 3, 3];
    for (let n = 1; n <= 7; n++) {
        const u = await user();
        if (n > 1) await seed(u, n - 1, 1);
        const before = await balance(u);
        const s = await status(u);
        assert.equal(s.streak, n - 1); assert.equal(s.next_day, Math.min(n, 6));
        assert.equal(s.next_credits, rewards[n - 1]); assert.deepEqual(s.rewards, rewards.slice(0, 6));
        const r = await claim(u);
        assert.deepEqual([r.ok, r.already_claimed, r.streak, r.day, r.credits, r.balance_after],
            [true, false, n, Math.min(n, 6), rewards[n - 1], before + rewards[n - 1]]);
        const again = await claim(u);
        assert.deepEqual(again, { ...r, already_claimed: true, credits: 0 });
        assert.equal((await status(u)).claimed_today, true);
        const rows = await q(`SELECT delta,free_delta,subscription_delta,reason FROM public.ledger_entries
            WHERE user_id=$1 AND reason LIKE 'grant:checkin#%'`, [u.id]);
        assert.equal(rows.length, 1);
        const day = (await one("SELECT to_char((now() AT TIME ZONE 'utc')::date,'YYYY-MM-DD') AS d")).d;
        assert.deepEqual(rows[0], { delta: rewards[n - 1], free_delta: 0, subscription_delta: 0, reason: `grant:checkin#${day}` });
        assert.equal(await balance(u), before + rewards[n - 1]);
    }
    const gap = await user(); await seed(gap, 12, 2);
    assert.equal((await status(gap)).streak, 0);
    assert.equal((await status(gap)).next_day, 1);
    assert.equal((await claim(gap)).streak, 1);

    const repair = await user();
    await q(`SELECT public.ledger_grant($1,1,'grant:checkin',to_char((now() AT TIME ZONE 'utc')::date-1,'YYYY-MM-DD'))`, [repair.id]);
    await seed(repair, 1, 1);
    const first = await claim(repair);
    await q('DELETE FROM public.checkin_streaks WHERE user_id=$1', [repair.id]);
    assert.deepEqual(await claim(repair), { ...first, already_claimed: true, credits: 0 });
    assert.equal((await status(repair)).streak, 2);

    for (const fn of ['daily_checkin', 'read_checkin_status']) {
        assert.equal((await call(fn, randomUUID())).code, 'ACCOUNT_UNAVAILABLE');
        assert.equal((await call(fn, repair.id)).code, 'ACCOUNT_UNAVAILABLE');
    }
    const unconfirmed = await user(false);
    assert.deepEqual(await claim(unconfirmed), { ok: false, code: 'ACCOUNT_UNAVAILABLE' });
    assert.equal(await balance(unconfirmed), 0);
    assert.deepEqual(await q('SELECT * FROM public.checkin_streaks WHERE user_id=$1', [unconfirmed.id]), []);
    assert.deepEqual(await q('SELECT * FROM public.ledger_entries WHERE user_id=$1', [unconfirmed.id]), []);
    await q('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1', [unconfirmed.auth]);
    const confirmedBalance = await balance(unconfirmed);
    assert.equal((await claim(unconfirmed)).credits, 1);
    assert.equal(await balance(unconfirmed), confirmedBalance + 1);
    const frozen = await user();
    await q("SELECT public.freeze_account($1,'checkin acceptance',NULL)", [frozen.id]);
    const held = await user();
    await q("UPDATE public.users SET hold_until=now()+interval '1 day' WHERE id=$1", [held.id]);
    const heldBefore = await balance(held);
    assert.equal((await status(held)).ok, true, 'strike holds leave credits unaffected');
    assert.equal((await claim(held)).credits, 1);
    assert.equal(await balance(held), heldBefore + 1);
    assert.equal((await claim(held)).already_claimed, true);
    const assetHeld = await user();
    const heldJob = await one(`INSERT INTO public.jobs(user_id,idempotency_key,model_id,credits,state,inputs)
        VALUES($1,$2,'test-model',3,'STORED','{}') RETURNING id`, [assetHeld.id, randomUUID()]);
    await q(`INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes,sha256,held_at)
        VALUES($1,$2,'image/png',1,$3,now())`, [heldJob.id, `generations/${randomUUID()}.png`, 'b'.repeat(64)]);
    const erased = await user();
    await claim(erased);
    const prep = (await one('SELECT public.prepare_account_deletion($1) AS r', [erased.auth])).r;
    assert.equal(prep.eligible, true);
    assert.equal((await one('SELECT public.erase_account($1,$2) AS r', [erased.auth, prep.confirmation_token])).r.ok, true);
    for (const u of [frozen, assetHeld, erased]) {
        const before = await balance(u);
        assert.equal((await claim(u)).code, 'ACCOUNT_UNAVAILABLE');
        assert.equal((await status(u)).code, 'ACCOUNT_UNAVAILABLE');
        assert.equal(await balance(u), before);
        assert.deepEqual(await q('SELECT * FROM public.checkin_streaks WHERE user_id=$1', [u.id]), []);
    }
    for (const fn of ['reconcile_balances', 'reconcile_free_credits', 'reconcile_subscription_credits']) {
        assert.deepEqual(await q(`SELECT * FROM public.${fn}()`), [], fn);
    }
    assert.deepEqual(await q(`SELECT b.user_id FROM public.credit_balances b
        LEFT JOIN public.ledger_entries e ON e.user_id=b.user_id GROUP BY b.user_id,b.balance
        HAVING b.balance <> COALESCE(sum(e.delta),0)`), []);
    for (const role of ['anon', 'authenticated']) {
        await refused(role, 'SELECT * FROM public.checkin_streaks');
        for (const fn of ['daily_checkin', 'read_checkin_status']) await refused(role, `SELECT public.${fn}($1)`, [repair.auth]);
    }
    for (const fn of ['daily_checkin', 'read_checkin_status']) {
        assert.equal((await one("SELECT has_function_privilege('service_role',$1,'EXECUTE') AS allowed", [`public.${fn}(uuid)`])).allowed, true);
    }
    const rls = await one("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.checkin_streaks'::regclass");
    assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
    console.log('checkin: rewards, UTC, replay, repair, eligibility, erasure, privileges, reconciliation, migration replay passed');
} finally { await q('ROLLBACK'); await c.end(); }
await checkinConcurrency(url);
