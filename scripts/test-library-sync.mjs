#!/usr/bin/env node
// 0500 (ADR-0340): Library favourites and the unsent Create draft follow the account. Runs against the full migration
// replay (ledger-tests.yml). Everything is rolled back.
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
const newJob = async (userId) => (await one(
    `INSERT INTO public.jobs (user_id, idempotency_key, model_id, credits, state, inputs)
     VALUES ($1, $2, 'test-model', 3, 'STORED'::job_state, '{}'::jsonb) RETURNING id`, [userId, randomUUID()])).id;
const refusedAs = async (role, sql, args = []) => {
    await c.query('SAVEPOINT r');
    try { await c.query(`SET LOCAL ROLE ${role}`); await c.query(sql, args); assert.fail(`${role} was allowed: ${sql}`); }
    catch (err) { assert.equal(err.code, '42501', err.message); }
    finally { await c.query('ROLLBACK TO SAVEPOINT r'); }
};
const draft = (extra = {}) => ({ v: 1, modelId: 'veo-3', prompt: 'a red fox', duration: 5, aspect: '16:9', count: 1, seed: '', negative: '', voice: '', ...extra });
const put = (authId, d) => call('put_create_draft', authId, JSON.stringify(d));

await c.query('BEGIN');
try {
    const alice = await signUp();
    const bob = await signUp();
    const aJob = await newJob(alice.userId);
    const bJob = await newJob(bob.userId);

    // Nothing stored yet.
    assert.deepEqual(await call('get_library_sync', alice.authId), { ok: true, favourites: [], draft: null, draft_updated_at: null });
    assert.deepEqual(await call('get_library_sync', randomUUID()), { ok: false, error: 'account_not_found' });

    // Star, replay, unstar, replay.
    assert.deepEqual(await call('set_library_favourite', alice.authId, aJob, true), { ok: true, changed: true });
    assert.deepEqual(await call('set_library_favourite', alice.authId, aJob, true), { ok: true, changed: false });
    assert.deepEqual((await call('get_library_sync', alice.authId)).favourites, [aJob]);
    assert.deepEqual(await call('set_library_favourite', alice.authId, aJob, false), { ok: true, changed: true });
    assert.deepEqual(await call('set_library_favourite', alice.authId, aJob, false), { ok: true, changed: false });
    assert.deepEqual((await call('get_library_sync', alice.authId)).favourites, []);

    // Another account's job, and a job that does not exist, are the same answer; nothing is written or leaked.
    assert.deepEqual(await call('set_library_favourite', alice.authId, bJob, true), { ok: false, error: 'job_not_found' });
    assert.deepEqual(await call('set_library_favourite', alice.authId, randomUUID(), true), { ok: false, error: 'job_not_found' });
    assert.deepEqual((await call('get_library_sync', bob.authId)).favourites, []);
    assert.equal((await one('SELECT count(*)::int AS n FROM public.library_favourites')).n, 0);

    // Newest first; a creation the owner deleted (ADR-0116) drops out of the list.
    const j1 = await newJob(alice.userId), j2 = await newJob(alice.userId);
    await call('set_library_favourite', alice.authId, j1, true);
    await c.query(`UPDATE public.library_favourites SET created_at = now() - interval '1 minute' WHERE job_id = $1`, [j1]);
    await call('set_library_favourite', alice.authId, j2, true);
    assert.deepEqual((await call('get_library_sync', alice.authId)).favourites, [j2, j1]);
    await c.query('UPDATE public.jobs SET deleted_at = now() WHERE id = $1', [j2]);
    assert.deepEqual((await call('get_library_sync', alice.authId)).favourites, [j1]);
    assert.deepEqual(await call('set_library_favourite', alice.authId, j2, true), { ok: false, error: 'job_not_found' });

    // The 201st star is refused (1 is already starred).
    for (let i = 0; i < 199; i++) await c.query('INSERT INTO public.library_favourites (user_id, job_id) VALUES ($1, $2)', [alice.userId, await newJob(alice.userId)]);
    assert.equal((await call('get_library_sync', alice.authId)).favourites.length, 200, 'the deleted creation\'s star does not count');
    assert.deepEqual(await call('set_library_favourite', alice.authId, await newJob(alice.userId), true), { ok: false, error: 'too_many_favourites' });

    // Draft: store, read back, replay keeps updated_at, replace changes it, 24 h life, clear.
    assert.deepEqual(await put(alice.authId, draft()), { ok: true });
    assert.equal((await call('get_library_sync', alice.authId)).draft.prompt, 'a red fox');
    const stamp = async () => (await one('SELECT updated_at FROM public.create_drafts WHERE user_id = $1', [alice.userId])).updated_at.getTime();
    const t1 = await stamp();
    await put(alice.authId, draft());
    assert.equal(await stamp(), t1, 'the same draft again changes nothing');
    await put(alice.authId, draft({ prompt: 'a blue fox' }));
    assert.equal((await call('get_library_sync', alice.authId)).draft.prompt, 'a blue fox');
    assert.equal((await call('get_library_sync', bob.authId)).draft, null, "one account never sees another account's draft");
    await c.query(`UPDATE public.create_drafts SET updated_at = now() - interval '25 hours' WHERE user_id = $1`, [alice.userId]);
    assert.equal((await call('get_library_sync', alice.authId)).draft, null, 'older than 24 hours reads as none');
    await put(alice.authId, draft());
    assert.deepEqual(await call('clear_create_draft', alice.authId), { ok: true });
    assert.equal((await call('get_library_sync', alice.authId)).draft, null);

    // Bad drafts are refused.
    for (const bad of [draft({ v: 2 }), draft({ modelId: 'bad id!' }), draft({ prompt: 'x'.repeat(30001) }), draft({ prompt: 5 }), [1], 'x']) {
        assert.deepEqual(await put(alice.authId, bad), { ok: false, error: 'invalid_draft' });
    }

    // The browser roles hold nothing: not the tables, not the functions.
    for (const role of ['anon', 'authenticated']) {
        await refusedAs(role, 'SELECT * FROM public.library_favourites');
        await refusedAs(role, 'SELECT * FROM public.create_drafts');
        await refusedAs(role, 'SELECT public.get_library_sync($1)', [alice.authId]);
        await refusedAs(role, 'SELECT public.set_library_favourite($1, $2, true)', [alice.authId, aJob]);
        await refusedAs(role, 'SELECT public.put_create_draft($1, $2::jsonb)', [alice.authId, JSON.stringify(draft())]);
        await refusedAs(role, 'SELECT public.clear_create_draft($1)', [alice.authId]);
    }
    for (const table of ['library_favourites', 'create_drafts']) {
        assert.equal((await one(`SELECT relrowsecurity AS r, relforcerowsecurity AS f FROM pg_class WHERE oid = $1::regclass`, [`public.${table}`])).f, true, table);
    }

    // Account deletion removes both in the same transaction.
    await put(bob.authId, draft());
    await call('set_library_favourite', bob.authId, bJob, true);
    await c.query('UPDATE public.users SET deleted_at = now() WHERE id = $1', [bob.userId]);
    assert.equal((await one('SELECT count(*)::int AS n FROM public.library_favourites WHERE user_id = $1', [bob.userId])).n, 0);
    assert.equal((await one('SELECT count(*)::int AS n FROM public.create_drafts WHERE user_id = $1', [bob.userId])).n, 0);

    // The telemetry allowlist admits the three routes and keeps the earlier ones.
    for (const p of ['/api/v1/library-sync', '/api/v1/library-sync/favourites', '/api/v1/library-sync/draft', '/api/v1/first-goal', '/app/photo-studio']) {
        assert.equal((await one('SELECT public.telemetry_path_allowed($1) AS ok', [p])).ok, true, p);
    }
    assert.equal((await one('SELECT public.telemetry_path_allowed($1) AS ok', ['/api/v1/library-sync/other'])).ok, false);

    // Ledger and balances are untouched.
    assert.deepEqual(await q('SELECT * FROM public.reconcile_balances()'), []);
    console.log('library sync: ok');
} finally {
    await c.query('ROLLBACK');
    await c.end();
}
