#!/usr/bin/env node
// 0363 (ADR-0251): the Vibe Check profile. Runs against the full migration replay
// (ledger-tests.yml). Everything is rolled back.
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
const call = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) AS r`, args)).r;

const signUp = async () => {
    const authId = randomUUID();
    await c.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [authId, `${randomUUID()}@test.veyrnox.ai`]);
    const user = await one('SELECT id FROM public.users WHERE auth_id = $1', [authId]);
    return { authId, userId: user.id };
};
const good = (o = {}) => ({ look: 'neon_rain', goal: 'story', pace: 'octopus', chaos: 2, destination: 'tiktok', audience: 'me', voice: 'calm', ...o });
const save = (authId, answers) => call('save_creator_profile', authId, JSON.stringify(answers));
const stored = (userId) => one('SELECT * FROM public.creator_profiles WHERE user_id = $1', [userId]);
const refusedAs = async (role, sql, args = []) => {
    await c.query('SAVEPOINT r');
    try { await c.query(`SET LOCAL ROLE ${role}`); await c.query(sql, args); assert.fail(`${role} was allowed: ${sql}`); }
    catch (err) { assert.equal(err.code, '42501', err.message); }
    finally { await c.query('ROLLBACK TO SAVEPOINT r'); }
};

await c.query('BEGIN');
try {
    // The migration is idempotent: apply it twice inside the transaction.
    const migration = await readFile(new URL('../packages/db/schema/supabase/0363_creator_profile.sql', import.meta.url), 'utf8');
    await c.query('SAVEPOINT again'); await c.query(migration); await c.query(migration); await c.query('RELEASE SAVEPOINT again');

    const alice = await signUp();
    const bob = await signUp();

    // 1. Nothing stored yet.
    assert.deepEqual(await call('get_creator_profile', alice.authId), { ok: true, status: 'none' });
    assert.equal((await call('get_creator_profile', randomUUID())).error, 'account_not_found');
    assert.equal((await save(randomUUID(), good())).error, 'account_not_found');

    // 2. Validation: every unknown, missing or out-of-range answer is refused and stores nothing.
    const bad = [
        {}, null, [], 'x',
        good({ look: 'sepia' }), good({ goal: 7 }), good({ pace: 'dog' }), good({ chaos: 5 }), good({ chaos: -1 }),
        good({ chaos: 1.5 }), good({ chaos: '2' }), good({ destination: 'myspace' }), good({ audience: null }), good({ voice: 'loud' }),
        { ...good(), extra: 'nope' }, { ...good(), is_admin: true },
        good({ studio_name: 'x'.repeat(41) }), good({ studio_name: '<b>hi</b>' }), good({ studio_name: 'a\u0007b' }), good({ studio_name: 12 }),
    ];
    for (const b of bad) assert.equal((await save(alice.authId, b)).error, 'invalid_answers', JSON.stringify(b));
    for (const key of ['look', 'goal', 'pace', 'chaos', 'destination', 'audience', 'voice']) {
        const missing = good(); delete missing[key];
        assert.equal((await save(alice.authId, missing)).error, 'invalid_answers', `missing ${key}`);
    }
    assert.equal(await stored(alice.userId), undefined, 'a refused save writes nothing');

    // 3. Save: stored cleaned, with the studio name trimmed; an empty name is dropped.
    const first = await save(alice.authId, good({ studio_name: '  Night Owl Films  ' }));
    assert.equal(first.ok, true); assert.equal(first.changed, true);
    assert.equal(first.answers.studio_name, 'Night Owl Films');
    assert.equal((await save(alice.authId, good({ studio_name: '   ' }))).answers.studio_name, undefined);
    const full = await call('get_creator_profile', alice.authId);
    assert.equal(full.status, 'completed'); assert.equal(full.answers.chaos, 2); assert.ok(full.completed_at);

    // 4. Idempotency: the same answers again change nothing, not even updated_at.
    const before = await stored(alice.userId);
    const replay = await save(alice.authId, good());
    assert.equal(replay.changed, false);
    const after = await stored(alice.userId);
    assert.equal(after.updated_at.getTime(), before.updated_at.getTime());
    assert.equal(after.completed_at.getTime(), before.completed_at.getTime());
    // A retake with different answers replaces them.
    assert.equal((await save(alice.authId, good({ look: 'doc_grit', chaos: 4 }))).changed, true);
    assert.equal((await stored(alice.userId)).answers.look, 'doc_grit');

    // 5. People are separate.
    assert.equal((await call('get_creator_profile', bob.authId)).status, 'none');

    // 6. Skip: records once, never throws away completed answers.
    assert.deepEqual(await call('skip_creator_profile', bob.authId), { ok: true, changed: true, status: 'skipped' });
    assert.deepEqual(await call('skip_creator_profile', bob.authId), { ok: true, changed: false, status: 'skipped' });
    const skipped = await call('get_creator_profile', bob.authId);
    assert.equal(skipped.status, 'skipped'); assert.deepEqual(skipped.answers, {});
    assert.deepEqual(await call('skip_creator_profile', alice.authId), { ok: true, changed: false, status: 'completed' });
    assert.equal((await stored(alice.userId)).answers.look, 'doc_grit');
    // Completing after a skip clears the skip.
    assert.equal((await save(bob.authId, good())).changed, true);
    const bobRow = await stored(bob.userId);
    assert.equal(bobRow.skipped_at, null); assert.ok(bobRow.completed_at);

    // 7. Reset deletes the row; a replay is a no-op; unknown account is refused.
    assert.deepEqual(await call('reset_creator_profile', bob.authId), { ok: true, changed: true });
    assert.deepEqual(await call('reset_creator_profile', bob.authId), { ok: true, changed: false });
    assert.equal(await stored(bob.userId), undefined);
    assert.equal((await call('reset_creator_profile', randomUUID())).error, 'account_not_found');

    // 8. The table itself refuses a half-state, whatever writes to it.
    await c.query('SAVEPOINT s');
    await assert.rejects(c.query(`INSERT INTO public.creator_profiles (user_id, answers) VALUES ($1, '{}')`, [bob.userId]), /creator_profiles_state_ck/);
    await c.query('ROLLBACK TO SAVEPOINT s');
    await c.query('SAVEPOINT s');
    await assert.rejects(c.query(`INSERT INTO public.creator_profiles (user_id, answers, completed_at, skipped_at) VALUES ($1, $2, now(), now())`, [bob.userId, good()]), /creator_profiles_state_ck/);
    await c.query('ROLLBACK TO SAVEPOINT s');

    // 9. Account deletion: the row goes with the person, in the same transaction.
    assert.ok(await stored(alice.userId));
    await c.query('UPDATE public.users SET deleted_at = now() WHERE id = $1', [alice.userId]);
    assert.equal(await stored(alice.userId), undefined, 'erased with the account');
    assert.equal((await call('get_creator_profile', alice.authId)).error, 'account_not_found', 'a deleted account is not served');

    // 10. Privileges: the browser roles and service_role cannot touch the table; only service_role runs the functions.
    const carol = await signUp();
    await save(carol.authId, good());
    for (const role of ['anon', 'authenticated', 'service_role']) {
        await refusedAs(role, 'SELECT * FROM public.creator_profiles');
        await refusedAs(role, 'DELETE FROM public.creator_profiles');
        await refusedAs(role, 'TRUNCATE public.creator_profiles');
    }
    for (const role of ['anon', 'authenticated']) {
        await refusedAs(role, 'SELECT public.get_creator_profile($1)', [carol.authId]);
        await refusedAs(role, 'SELECT public.save_creator_profile($1, $2)', [carol.authId, JSON.stringify(good())]);
        await refusedAs(role, 'SELECT public.skip_creator_profile($1)', [carol.authId]);
        await refusedAs(role, 'SELECT public.reset_creator_profile($1)', [carol.authId]);
        await refusedAs(role, 'SELECT private.creator_profile_clean($1)', [JSON.stringify(good())]);
    }
    await c.query('SAVEPOINT s'); await c.query('SET LOCAL ROLE service_role');
    assert.equal((await one('SELECT public.get_creator_profile($1) AS r', [carol.authId])).r.status, 'completed');
    await c.query('ROLLBACK TO SAVEPOINT s');

    // 11. Row security is on and forced; every function pins its search_path.
    const f = await one(`SELECT relrowsecurity AS rls, relforcerowsecurity AS forced FROM pg_class WHERE oid = 'public.creator_profiles'::regclass`);
    assert.deepEqual(f, { rls: true, forced: true });
    const defs = await q(`SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname LIKE '%creator\\_profile%'
                           AND pronamespace IN ('public'::regnamespace, 'private'::regnamespace)`);
    assert.ok(defs.length >= 6);
    for (const d of defs) assert.ok((d.proconfig || []).some((x) => x.startsWith('search_path=')), d.proname);
    for (const d of defs.filter((x) => x.proname !== 'creator_profile_clean' && x.proname !== 'creator_profile_forget_erased_user')) {
        assert.equal(d.prosecdef, true, d.proname);
    }

    console.log('creator profile: ok');
} finally {
    await c.query('ROLLBACK');
    await c.end();
}
