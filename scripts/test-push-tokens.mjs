#!/usr/bin/env node
// 0348 (ADR-0113): push tokens and the outbox. Runs against the full migration replay
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
const tok = (n) => `ExponentPushToken[${String(n).padStart(22, 'x')}]`;
const reg = (authId, token, o = {}) => call('register_push_token', authId, token, o.platform ?? 'ios', o.device ?? null, o.version ?? null, o.notify ?? true);
const rows = (userId) => q('SELECT token, platform, device_id, notify_jobs, disabled_at FROM public.push_tokens WHERE user_id = $1 ORDER BY token', [userId]);
const job = (userId, state, provider = 'fal') => one(
    `INSERT INTO public.jobs (user_id, idempotency_key, model_id, credits, state, provider, inputs)
     VALUES ($1, $2, 'test-model', 3, $3::job_state, $4, '{"prompt":"p"}') RETURNING id`, [userId, randomUUID(), state, provider]);
const refusedAs = async (role, sql, args = []) => {
    await c.query('SAVEPOINT r');
    try { await c.query(`SET LOCAL ROLE ${role}`); await c.query(sql, args); assert.fail(`${role} was allowed: ${sql}`); }
    catch (err) { assert.equal(err.code, '42501', err.message); }
    finally { await c.query('ROLLBACK TO SAVEPOINT r'); }
};

await c.query('BEGIN');
try {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0348_push_tokens.sql', import.meta.url), 'utf8');
    await c.query('SAVEPOINT again'); await c.query(migration); await c.query(migration); await c.query('RELEASE SAVEPOINT again');

    const alice = await signUp();
    const bob = await signUp();

    // 1. Register: validation, ownership, idempotency.
    assert.equal((await reg(alice.authId, 'nope')).error, 'token_invalid');
    assert.equal((await reg(alice.authId, tok(1), { platform: 'web' })).error, 'platform_invalid');
    assert.equal((await reg(randomUUID(), tok(1))).error, 'account_not_found');
    assert.deepEqual(await reg(alice.authId, tok(1), { device: 'install-aaaa1111' }), { ok: true, registered: true, notify_jobs: true, changed: true });
    const again = await reg(alice.authId, tok(1), { device: 'install-aaaa1111' });
    assert.equal(again.changed, false, 'a replay changes nothing');
    assert.equal((await rows(alice.userId)).length, 1);
    assert.equal(Number((await one('SELECT count(*) AS n FROM public.push_token_writes WHERE user_id = $1', [alice.userId])).n), 1, 'a replay is not counted');

    // 2. Rotate: the same install with a new token replaces the old one.
    await reg(alice.authId, tok(2), { device: 'install-aaaa1111' });
    assert.deepEqual((await rows(alice.userId)).map((r) => r.token), [tok(2)]);

    // 3. A token moves to whoever signed in on that phone last; the first account loses it.
    await reg(bob.authId, tok(2), { device: 'install-aaaa1111' });
    assert.equal((await rows(alice.userId)).length, 0);
    assert.equal((await rows(bob.userId)).length, 1);

    // 4. Opt-out is per device and survives a re-register without the flag only if sent again.
    assert.equal((await reg(bob.authId, tok(2), { device: 'install-aaaa1111', notify: false })).notify_jobs, false);
    assert.equal((await rows(bob.userId))[0].notify_jobs, false);

    // 5. Remove: owner only, silent otherwise, replay is a no-op.
    assert.deepEqual(await call('remove_push_token', alice.authId, tok(2)), { ok: true });
    assert.equal((await rows(bob.userId)).length, 1, "alice cannot remove bob's token");
    assert.deepEqual(await call('remove_push_token', bob.authId, tok(2)), { ok: true });
    assert.deepEqual(await call('remove_push_token', bob.authId, tok(2)), { ok: true });
    assert.equal((await rows(bob.userId)).length, 0);
    assert.equal((await call('remove_push_token', 'nobody', tok(2))).error, 'account_not_found');

    // 6. Caps: ten devices per person, twenty writes an hour.
    const carol = await signUp();
    for (let i = 10; i < 30; i++) assert.equal((await reg(carol.authId, tok(i))).ok, true);
    assert.equal((await rows(carol.userId)).length, 10, 'oldest devices make way');
    const limited = await reg(carol.authId, tok(99));
    assert.deepEqual([limited.ok, limited.error], [false, 'rate_limited']);
    assert.equal(limited.retry_after_seconds, 600);
    assert.equal((await reg(carol.authId, tok(29))).ok, true, 'a no-op replay is not limited');

    // 7. The outbox: finished jobs are announced once, chat and old or unfinished jobs never.
    const dana = await signUp();
    await reg(dana.authId, tok(200), { device: 'install-dana0001' });
    const done = await job(dana.userId, 'STORED');
    const failed = await job(dana.userId, 'FAILED');
    await job(dana.userId, 'SUBMITTED');
    await job(dana.userId, 'STORED', 'openrouter-chat');
    const old = await job(dana.userId, 'STORED');
    await c.query(`UPDATE public.jobs SET created_at = now() - interval '3 hours' WHERE id = $1`, [old.id]);
    const stale = await job(dana.userId, 'STORED');
    await c.query(`UPDATE public.jobs SET updated_at = now() - interval '1 hour' WHERE id = $1`, [stale.id]);
    const bobsJob = await job(bob.userId, 'STORED');
    assert.equal(await call('push_enqueue_job_events', 200), 2, 'done + failed, for the person with a token');
    assert.equal(await call('push_enqueue_job_events', 200), 0, 'a second sweep queues nothing new');
    const queued = await q('SELECT job_id, kind FROM public.push_outbox WHERE user_id = $1 ORDER BY kind', [dana.userId]);
    assert.deepEqual(queued, [{ job_id: failed.id, kind: 'job_failed' }, { job_id: done.id, kind: 'job_done' }].sort((a, b) => a.kind.localeCompare(b.kind)));
    assert.equal(Number((await one('SELECT count(*) AS n FROM public.push_outbox WHERE job_id = $1', [bobsJob.id])).n), 0, 'no token, no push');
    // FAILED then REFUNDED is still one failure notice.
    await c.query(`UPDATE public.jobs SET state = 'REFUNDED' WHERE id = $1`, [failed.id]);
    assert.equal(await call('push_enqueue_job_events', 200), 0);

    // 8. Claim, lease, settle.
    const batch = await call('push_claim_batch', 50, 120);
    assert.equal(batch.length, 2);
    const first = batch.find((b) => b.kind === 'job_failed');
    assert.equal(first.job_state, 'REFUNDED');
    assert.deepEqual(first.tokens.map((t) => t.token), [tok(200)]);
    assert.deepEqual(await call('push_claim_batch', 50, 120), [], 'a leased item is not handed out twice');
    assert.equal((await call('push_settle', first.id, 'sent', null, [])).state, 'sent');
    assert.equal((await call('push_settle', first.id, 'retry', 'late', [])).state, 'sent', 'a settled item stays settled');
    const second = batch.find((b) => b.kind === 'job_done');
    assert.equal((await call('push_settle', second.id, 'retry', 'MessageRateExceeded', [])).state, 'pending');
    assert.deepEqual(await call('push_claim_batch', 50, 120), [], 'a retry waits');
    await c.query(`UPDATE public.push_outbox SET next_attempt_at = now() WHERE id = $1`, [second.id]);
    assert.equal((await call('push_claim_batch', 50, 120)).length, 1);
    // the fourth failed attempt closes the item
    await c.query(`UPDATE public.push_outbox SET attempts = 4, claimed_until = NULL WHERE id = $1`, [second.id]);
    assert.equal((await call('push_settle', second.id, 'retry', 'x', [])).state, 'dead');

    // 9. A device Expo called unregistered is switched off, and only its own person's tokens can be.
    const erin = await signUp();
    await reg(erin.authId, tok(300));
    const erinJob = await job(erin.userId, 'STORED');
    await call('push_enqueue_job_events', 200);
    const eb = (await call('push_claim_batch', 50, 120)).find((b) => b.job_id === erinJob.id);
    const erinToken = await one('SELECT id FROM public.push_tokens WHERE user_id = $1', [erin.userId]);
    const daneToken = await one('SELECT id FROM public.push_tokens WHERE user_id = $1', [dana.userId]);
    assert.equal((await call('push_settle', eb.id, 'dead', 'DeviceNotRegistered', [erinToken.id, daneToken.id])).state, 'dead');
    assert.notEqual((await one('SELECT disabled_at FROM public.push_tokens WHERE id = $1', [erinToken.id])).disabled_at, null);
    assert.equal((await one('SELECT disabled_at FROM public.push_tokens WHERE id = $1', [daneToken.id])).disabled_at, null, "not another person's token");
    // a disabled device is not enqueued for, and registering again brings it back
    await job(erin.userId, 'STORED');
    assert.equal(await call('push_enqueue_job_events', 200), 0);
    await reg(erin.authId, tok(300));
    assert.equal((await rows(erin.userId))[0].disabled_at, null);
    // an item whose person has no active token left is closed, not sent to no one
    await call('push_enqueue_job_events', 200);
    await c.query(`UPDATE public.push_tokens SET notify_jobs = false WHERE user_id = $1`, [erin.userId]);
    assert.deepEqual((await call('push_claim_batch', 50, 120)).filter((b) => b.job_id), []);
    assert.equal((await one(`SELECT count(*) AS n FROM public.push_outbox WHERE user_id = $1 AND last_error = 'no_active_token'`, [erin.userId])).n, '1');

    // 10. Money is untouched by all of it.
    const money = async () => one(`SELECT (SELECT count(*) FROM public.ledger_entries) AS l, (SELECT coalesce(sum(balance),0) FROM public.credit_balances) AS b,
        (SELECT count(*) FROM public.jobs WHERE state IN ('STORED','FAILED','REFUNDED')) AS j`);
    const before = await money();
    await call('push_enqueue_job_events', 200); await call('push_claim_batch', 50, 120); await call('push_prune');
    assert.deepEqual(await money(), before);

    // 11. Pruning.
    await c.query(`UPDATE public.push_tokens SET last_seen_at = now() - interval '200 days' WHERE user_id = $1`, [carol.userId]);
    assert.equal((await call('push_prune')).tokens, 10);

    // 12. Account deletion (0347) clears tokens and outbox in the same transaction.
    const fay = await signUp();
    await reg(fay.authId, tok(400));
    await job(fay.userId, 'STORED');
    await call('push_enqueue_job_events', 200);
    const prep = await call('prepare_account_deletion', fay.authId);
    assert.equal(prep.eligible, true, JSON.stringify(prep));
    assert.equal((await call('erase_account', fay.authId, prep.confirmation_token)).ok, true);
    assert.equal((await rows(fay.userId)).length, 0);
    assert.equal(Number((await one('SELECT count(*) AS n FROM public.push_outbox WHERE user_id = $1', [fay.userId])).n), 0);
    assert.equal((await reg(fay.authId, tok(401))).error, 'account_not_found', 'an erased account cannot register');

    // 13. Nothing here is reachable from the browser roles; the RPCs are service_role only.
    for (const role of ['anon', 'authenticated']) {
        for (const t of ['push_tokens', 'push_outbox', 'push_token_writes']) await refusedAs(role, `SELECT * FROM public.${t}`);
        await refusedAs(role, 'SELECT public.push_enqueue_job_events(1)');
        await refusedAs(role, `SELECT public.register_push_token('x', 'x', 'ios', NULL, NULL, true)`);
    }
    await refusedAs('service_role', 'SELECT * FROM public.push_tokens');
    await c.query('SAVEPOINT s'); await c.query('SET LOCAL ROLE service_role');
    assert.equal((await one('SELECT public.push_prune() AS r')).r.tokens, 0);
    await c.query('ROLLBACK TO SAVEPOINT s');
    for (const t of ['push_tokens', 'push_outbox', 'push_token_writes']) {
        const f = await one(`SELECT relrowsecurity AS rls, relforcerowsecurity AS forced FROM pg_class WHERE oid = 'public.${t}'::regclass`);
        assert.deepEqual(f, { rls: true, forced: true }, t);
    }
    const defs = await q(`SELECT proname, prosecdef, proconfig FROM pg_proc WHERE (proname LIKE 'push\\_%' OR proname IN ('register_push_token','remove_push_token'))
                           AND pronamespace IN ('public'::regnamespace, 'private'::regnamespace)`);
    assert.ok(defs.length >= 7);
    for (const d of defs) { assert.equal(d.prosecdef, true, d.proname); assert.ok((d.proconfig || []).some((x) => x.startsWith('search_path=')), d.proname); }

    console.log('push tokens: ok');
} finally {
    await c.query('ROLLBACK');
    await c.end();
}
