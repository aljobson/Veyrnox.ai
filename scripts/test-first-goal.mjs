#!/usr/bin/env node
// 0494 (ADR-0336): the first-goal answer follows the account. Runs against the full migration replay
// (ledger-tests.yml). Everything is rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const call = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) AS r`, args)).r;

const signUp = async () => {
    const authId = randomUUID();
    await c.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [authId, `${randomUUID()}@test.veyrnox.ai`]);
    const user = await one('SELECT id FROM public.users WHERE auth_id = $1', [authId]);
    return { authId, userId: user.id };
};
const set = (authId, goal) => call('set_first_goal', authId, goal);
const get = (authId) => call('get_first_goal', authId);
const stored = (userId) => one('SELECT * FROM public.first_goals WHERE user_id = $1', [userId]);
const refusedAs = async (role, sql, args = []) => {
    await c.query('SAVEPOINT r');
    try { await c.query(`SET LOCAL ROLE ${role}`); await c.query(sql, args); assert.fail(`${role} was allowed: ${sql}`); }
    catch (err) { assert.equal(err.code, '42501', err.message); }
    finally { await c.query('ROLLBACK TO SAVEPOINT r'); }
};

await c.query('BEGIN');
try {
    // The replay database has no Supabase auth schema beyond what the migrations create; the export reads this table.
    await c.query('CREATE TABLE IF NOT EXISTS auth.mfa_factors(user_id uuid,factor_type text,status text)');
    const alice = await signUp();
    const bob = await signUp();

    // Nothing stored yet.
    assert.deepEqual(await get(alice.authId), { ok: true, goal: null });

    // First answer is stored; the same answer again changes nothing and leaves updated_at alone.
    assert.deepEqual(await set(alice.authId, 'unsure'), { ok: true, changed: true, goal: 'unsure' });
    const first = await stored(alice.userId);
    assert.deepEqual(await set(alice.authId, 'unsure'), { ok: true, changed: false, goal: 'unsure' });
    assert.equal((await stored(alice.userId)).updated_at.getTime(), first.updated_at.getTime());

    // A real goal replaces "not sure"; "not sure" and "skipped" can never lower it again.
    assert.deepEqual(await set(alice.authId, 'video'), { ok: true, changed: true, goal: 'video' });
    assert.deepEqual(await set(alice.authId, 'unsure'), { ok: true, changed: false, goal: 'video' });
    assert.deepEqual(await set(alice.authId, 'skipped'), { ok: true, changed: false, goal: 'video' });
    assert.equal((await get(alice.authId)).goal, 'video');
    // One real goal may be replaced by another (the person changed their mind).
    assert.deepEqual(await set(alice.authId, 'audio'), { ok: true, changed: true, goal: 'audio' });

    // "Skipped" is stored when nothing better exists, and a later real goal replaces it.
    assert.deepEqual(await set(bob.authId, 'skipped'), { ok: true, changed: true, goal: 'skipped' });
    assert.deepEqual(await set(bob.authId, 'edit'), { ok: true, changed: true, goal: 'edit' });

    // Accounts are independent.
    assert.equal((await get(alice.authId)).goal, 'audio');
    assert.equal((await get(bob.authId)).goal, 'edit');

    // Bad input is refused and nothing is written.
    for (const bad of ['', 'rm -rf', 'IMAGE', 'image ', null]) {
        assert.deepEqual(await set(alice.authId, bad), { ok: false, error: 'invalid_goal' }, String(bad));
    }
    assert.equal((await stored(alice.userId)).goal, 'audio');
    await c.query('SAVEPOINT chk');
    await assert.rejects(c.query("INSERT INTO public.first_goals(user_id, goal) VALUES ($1, 'bogus') ON CONFLICT (user_id) DO UPDATE SET goal = 'bogus'", [alice.userId]), (err) => err.code === '23514');
    await c.query('ROLLBACK TO SAVEPOINT chk');

    // Unknown accounts.
    assert.deepEqual(await set(randomUUID(), 'image'), { ok: false, error: 'account_not_found' });
    assert.deepEqual(await get(randomUUID()), { ok: false, error: 'account_not_found' });

    // The browser roles hold no grant on the table or the functions; the service role reaches it only through them.
    for (const role of ['anon', 'authenticated', 'service_role']) {
        await refusedAs(role, 'SELECT * FROM public.first_goals');
        await refusedAs(role, 'DELETE FROM public.first_goals');
    }
    for (const role of ['anon', 'authenticated']) {
        await refusedAs(role, "SELECT public.set_first_goal('x', 'image')");
        await refusedAs(role, "SELECT public.get_first_goal('x')");
    }
    await c.query('SET LOCAL ROLE service_role');
    assert.equal((await one("SELECT public.get_first_goal($1) AS r", [alice.authId])).r.goal, 'audio');
    await c.query('RESET ROLE');
    const rls = await one("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.first_goals'::regclass");
    assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });

    // The privacy export carries the answer in the profile section, and only the caller's own.
    const exportId = (await call('start_privacy_export', alice.authId, 'aal1')).export_id;
    const page = await call('read_privacy_export_page', alice.authId, 'aal1', exportId, 'profile', null, null, null, null);
    assert.equal(page.ok, true);
    assert.equal(page.rows[0].first_goal.goal, 'audio');
    assert.deepEqual(Object.keys(page.rows[0].first_goal).sort(), ['created_at', 'goal', 'updated_at']);
    assert.ok(Object.hasOwn(page.rows[0], 'voice_profiles'), 'the existing wrapper key survives');
    assert.ok(Object.hasOwn(page.rows[0], 'creator_profile'), 'the existing profile keys survive');
    for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal((await one('SELECT has_function_privilege($1, $2, $3) AS allowed', [role, 'private.read_privacy_export_page_without_first_goal(text,text,uuid,text,uuid,text,text,integer)', 'EXECUTE'])).allowed, false, role);
    }
    // An export taken before the answer existed shows none.
    const early = (await one(`INSERT INTO public.privacy_export_requests(user_id, created_at, as_of, expires_at, aal)
        VALUES ($1, now() - interval '3 days', now() - interval '3 days', now() + interval '1 hour', 'aal1') RETURNING id`, [alice.userId])).id;
    assert.equal((await call('read_privacy_export_page', alice.authId, 'aal1', early, 'profile', null, null, null, null)).rows[0].first_goal, null);

    // Account deletion removes the row in the same transaction.
    assert.ok(await stored(bob.userId));
    await c.query('UPDATE public.users SET deleted_at = now() WHERE id = $1', [bob.userId]);
    assert.equal(await stored(bob.userId), undefined);
    assert.deepEqual(await get(bob.authId), { ok: false, error: 'account_not_found' });

    console.log('first goal: ok');
} finally {
    await c.query('ROLLBACK');
    await c.end();
}
