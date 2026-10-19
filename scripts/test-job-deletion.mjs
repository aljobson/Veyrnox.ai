#!/usr/bin/env node
// 0351 (ADR-0116): a person deletes one of their own creations. Runs against the full migration replay
// (ledger-tests.yml). Every fixture is rolled back.
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
const del = (authId, jobId) => call('delete_user_job', authId, jobId);

const signUp = async () => {
    const authId = randomUUID();
    await c.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [authId, `${randomUUID()}@test.veyrnox.ai`]);
    const user = await one('SELECT id FROM public.users WHERE auth_id = $1', [authId]);
    return { authId, userId: user.id };
};
const job = (userId, state = 'STORED', inputs = { prompt: 'a private prompt' }) =>
    one(`INSERT INTO public.jobs (user_id, idempotency_key, model_id, credits, state, inputs)
         VALUES ($1, $2, 'test-model', 3, $3::job_state, $4) RETURNING id`, [userId, randomUUID(), state, inputs]);
const asset = async (jobId, held = false) => {
    const key = `generations/${randomUUID()}.png`;
    await c.query(`INSERT INTO public.assets (job_id, r2_key, mime_type, size_bytes, sha256, held_at) VALUES ($1, $2, 'image/png', 10, $3, ${held ? 'now()' : 'NULL'})`,
        [jobId, key, 'a'.repeat(64)]);
    return key;
};
const money = (userId) => one(`SELECT b.balance, b.free_balance, b.subscription_balance,
    (SELECT count(*)::int FROM public.ledger_entries WHERE user_id = b.user_id) AS entries,
    (SELECT COALESCE(sum(delta), 0)::int FROM public.ledger_entries WHERE user_id = b.user_id) AS ledger_sum
    FROM public.credit_balances b WHERE b.user_id = $1`, [userId]);
// Fixtures that point at rows this test does not need (a creator, a brand): foreign keys off for the insert only.
const raw = async (sql, args) => {
    await c.query('SET LOCAL session_replication_role = replica');
    await c.query(sql, args);
    await c.query('SET LOCAL session_replication_role = origin');
};
const refusedAs = async (role, sql, args = []) => {
    await c.query('SAVEPOINT r');
    try { await c.query(`SET LOCAL ROLE ${role}`); await c.query(sql, args); assert.fail(`${role} was allowed: ${sql}`); }
    catch (err) { assert.equal(err.code, '42501', err.message); }
    finally { await c.query('ROLLBACK TO SAVEPOINT r'); }
};
const queued = async (key) => (await one('SELECT count(*)::int AS n FROM public.asset_reap_queue WHERE r2_key = $1', [key])).n;

await c.query('BEGIN');
try {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0351_delete_user_job.sql', import.meta.url), 'utf8');
    await c.query('SAVEPOINT again'); await c.query(migration); await c.query(migration); await c.query('RELEASE SAVEPOINT again');

    const alice = await signUp();
    const bob = await signUp();

    // 1. Ownership, and nothing to learn from a wrong guess.
    const bobsJob = await job(bob.userId);
    assert.deepEqual(await del(alice.authId, bobsJob.id), { ok: false, code: 'NOT_FOUND' }, "another user's job");
    assert.deepEqual(await del(alice.authId, randomUUID()), { ok: false, code: 'NOT_FOUND' }, 'a job that does not exist');
    assert.deepEqual(await del(randomUUID(), bobsJob.id), { ok: false, code: 'NOT_FOUND' }, 'an unknown account');
    assert.equal((await one('SELECT deleted_at FROM public.jobs WHERE id = $1', [bobsJob.id])).deleted_at, null, 'bob untouched');

    // 2. The deletion: file queued, prompt gone, job row and money exactly as they were.
    const spent = await call('ledger_debit', alice.userId, randomUUID(), 4, 'debit:generation', 'test-model', { prompt: 'a prompt on the ledger job' });
    assert.equal(spent.ok, true, JSON.stringify(spent));
    await c.query(`UPDATE public.jobs SET state = 'STORED' WHERE id = $1`, [spent.job_id]);
    const key = await asset(spent.job_id);
    const other = await job(alice.userId);
    const otherKey = await asset(other.id);
    const before = await money(alice.userId);
    const beforeJob = await one('SELECT state, model_id, credits, user_id FROM public.jobs WHERE id = $1', [spent.job_id]);

    assert.deepEqual(await del(alice.authId, spent.job_id), { ok: true, replayed: false });
    assert.equal((await one('SELECT count(*)::int AS n FROM public.assets WHERE job_id = $1', [spent.job_id])).n, 0, 'asset row gone');
    assert.equal(await queued(key), 1, 'the R2 key is queued for the reaper');
    const row = await one('SELECT inputs, deleted_at, state, model_id, credits, user_id FROM public.jobs WHERE id = $1', [spent.job_id]);
    assert.deepEqual(row.inputs, {}, 'prompt erased');
    assert.ok(row.deleted_at);
    assert.deepEqual({ state: row.state, model_id: row.model_id, credits: row.credits, user_id: row.user_id }, beforeJob, 'the job row stays');
    assert.equal((await one('SELECT count(*)::int AS n FROM public.assets WHERE job_id = $1', [other.id])).n, 1, 'another creation untouched');
    assert.equal(await queued(otherKey), 0);
    assert.deepEqual((await one('SELECT inputs FROM public.jobs WHERE id = $1', [other.id])).inputs, { prompt: 'a private prompt' });

    // 3. The money: no ledger write, no balance change, no refund, every reconcile clean.
    assert.deepEqual(await money(alice.userId), before);
    for (const fn of ['reconcile_balances', 'reconcile_free_credits', 'reconcile_top_ups', 'reconcile_subscription_credits']) {
        assert.equal((await q(`SELECT 1 FROM public.${fn}() WHERE user_id = $1`, [alice.userId])).length, 0, `${fn} clean`);
    }

    // 4. Gone for the owner, everywhere it was read.
    assert.deepEqual(await call('get_user_job', alice.authId, spent.job_id), { ok: false, code: 'NOT_FOUND' });
    const listed = (await call('list_user_jobs', alice.authId, 50)).jobs.map((j) => j.job_id);
    assert.ok(!listed.includes(spent.job_id), 'not in the Library list');
    assert.ok(listed.includes(other.id), 'the rest of the list is intact');
    assert.equal((await call('get_user_job', alice.authId, other.id)).ok, true);

    // 5. Idempotent: the same request again is a no-op, and so is a replay after the reaper has run.
    assert.deepEqual(await del(alice.authId, spent.job_id), { ok: true, replayed: true });
    assert.deepEqual(await del(alice.authId, spent.job_id), { ok: true, replayed: true });
    assert.equal(await queued(key), 1, 'still queued once');
    await c.query('DELETE FROM public.asset_reap_queue WHERE r2_key = $1', [key]);
    assert.deepEqual(await del(alice.authId, spent.job_id), { ok: true, replayed: true });
    assert.equal(await queued(key), 0, 'a replay queues nothing');
    assert.deepEqual(await del(bob.authId, spent.job_id), { ok: false, code: 'NOT_FOUND' }, "a replay is still the owner's");
    assert.deepEqual(await money(alice.userId), before);

    // 6. A failed or refunded job has no file; the prompt still goes.
    for (const state of ['FAILED', 'REFUNDED']) {
        const j = await job(alice.userId, state);
        assert.deepEqual(await del(alice.authId, j.id), { ok: true, replayed: false }, state);
        assert.deepEqual((await one('SELECT inputs FROM public.jobs WHERE id = $1', [j.id])).inputs, {});
    }

    // 7. Refusals. Each leaves the file, the prompt and the row exactly as they were.
    const untouched = async (j, key) => {
        const r = await one('SELECT inputs, deleted_at FROM public.jobs WHERE id = $1', [j.id]);
        assert.deepEqual(r.inputs, { prompt: 'a private prompt' });
        assert.equal(r.deleted_at, null);
        if (key) { assert.equal((await one('SELECT count(*)::int AS n FROM public.assets WHERE r2_key = $1', [key])).n, 1); assert.equal(await queued(key), 0); }
    };
    const refuse = async (label, j, code, key) => { assert.deepEqual(await del(alice.authId, j.id), { ok: false, code }, label); await untouched(j, key); };

    for (const state of ['PRICED', 'DEBITED', 'FAILOVER', 'SUBMITTED', 'SUCCEEDED']) {
        await refuse(`in progress: ${state}`, await job(alice.userId, state), 'IN_PROGRESS');
    }
    const open = await job(alice.userId, 'REFUNDED');
    await raw(`INSERT INTO public.fal_dispatch (job_id, endpoint, payload, state) VALUES ($1, 'fal-ai/test', '{"prompt":"x"}', 'UNKNOWN')`, [open.id]);
    await refuse('a fal request that has not closed', open, 'IN_PROGRESS');

    const heldJob = await job(alice.userId); const heldKey = await asset(heldJob.id, true);
    await refuse('an asset under a hold', heldJob, 'ON_HOLD', heldKey);

    const evJob = await job(alice.userId); const evKey = await asset(evJob.id);
    await raw(`INSERT INTO public.evidence_holds (action_id, job_id, r2_key, mime_type, size_bytes) VALUES ($1, $2, $3, 'image/png', 1)`,
        [randomUUID(), evJob.id, `evidence/${randomUUID()}`]);
    await refuse('an unreleased evidence hold', evJob, 'ON_HOLD', evKey);

    const reported = await job(alice.userId); const reportedKey = await asset(reported.id);
    await c.query(`INSERT INTO public.content_reports (reporter_id, subject_kind, subject_id, category, details) VALUES ($1, 'job', $2, 'other', 'x')`, [bob.userId, reported.id]);
    await refuse('an open report', reported, 'ON_HOLD', reportedKey);
    await c.query(`UPDATE public.content_reports SET status = 'resolved', resolved_at = now(), resolved_by = 'test', resolution = 'dismissed' WHERE subject_id = $1`, [reported.id]);
    assert.equal((await del(alice.authId, reported.id)).ok, true, 'a resolved report no longer blocks');

    const brand = await one(`INSERT INTO public.social_brands (owner_user_id, label) VALUES ($1, 'Alice Co') RETURNING id`, [alice.userId]);
    const postWith = async (status, j) => {
        const draft = status === 'draft';
        const p = await one(`INSERT INTO public.social_posts (brand_id, created_by_user_id, status, scheduled_at, global_text, idempotency_key${draft ? ', draft_batch_id' : ''})
            VALUES ($1, $2, $3, now() + interval '1 day', 't', $4${draft ? ', $5' : ''}) RETURNING id`,
            draft ? [brand.id, alice.userId, status, randomUUID(), randomUUID()] : [brand.id, alice.userId, status, randomUUID()]);
        await c.query(`INSERT INTO public.social_post_media (post_id, "position", media_type, source_job_id) VALUES ($1, 0, 'image', $2)`, [p.id, j.id]);
    };
    for (const status of ['draft', 'scheduled', 'published']) {
        const j = await job(alice.userId); const k = await asset(j.id);
        await postWith(status, j);
        await refuse(`used by a ${status} post`, j, 'USED_BY_POST', k);
    }
    for (const status of ['canceled', 'failed']) {
        const j = await job(alice.userId); const k = await asset(j.id);
        await postWith(status, j);
        assert.equal((await del(alice.authId, j.id)).ok, true, `a ${status} post no longer needs the file`);
        assert.equal(await queued(k), 1);
    }

    const cinema = await job(alice.userId); const cinemaKey = await asset(cinema.id);
    await raw(`INSERT INTO public.cinema_uploads (content_id, creator_id, create_key, file_size, fingerprint, source_job_id) VALUES ($1, $2, $3, 1, $4, $5)`,
        [randomUUID(), alice.userId, randomUUID(), 'd'.repeat(64), cinema.id]);
    await refuse('a Cinema upload', cinema, 'USED_BY_CINEMA', cinemaKey);

    const master = await job(alice.userId); const masterKey = await asset(master.id);
    await raw(`INSERT INTO public.film_library_masters (id, user_id, source_job_id, source_sha256, label, r2_key, sha256, size_bytes, width, height, seconds, frame_rate, expires_at)
        VALUES ($1, $2, $3, $4, 'm', $5, $6, 1, 1920, 1080, 1, 24, now() + interval '1 day')`,
        [randomUUID(), alice.userId, master.id, 'b'.repeat(64), `masters/${randomUUID()}`, 'c'.repeat(64)]);
    await refuse('a Film Library master', master, 'USED_BY_LIBRARY', masterKey);

    // 8. A chat reply is not a creation; a Frozen account cannot delete its way out of a dispute.
    const chat = await job(alice.userId, 'STORED', { kind: 'chat', prompt: 'hi' });
    assert.deepEqual(await del(alice.authId, chat.id), { ok: false, code: 'NOT_FOUND' });
    const fred = await signUp(); const fredJob = await job(fred.userId); const fredKey = await asset(fredJob.id);
    await call('freeze_account', fred.userId, 'test freeze', null);
    assert.deepEqual(await del(fred.authId, fredJob.id), { ok: false, code: 'ACCOUNT_FROZEN' });
    assert.equal(await queued(fredKey), 0);

    // 9. A multi-step job: intermediate files are queued and its text goes with the prompt.
    const steps = await job(alice.userId); const stepsKey = await asset(steps.id);
    const stepKey = `steps/${randomUUID()}.mp3`;
    await c.query(`INSERT INTO public.job_steps (job_id, step, provider, provider_endpoint, state, output_r2_key, output_text)
        VALUES ($1, 'voice', 'fal', 'fal-ai/test', 'STORED', $2, '{"text":"the script"}')`, [steps.id, stepKey]);
    await c.query(`INSERT INTO public.fal_dispatch (job_id, endpoint, payload, state) VALUES ($1, 'fal-ai/test', '{"prompt":"secret"}', 'CLOSED')`, [steps.id]);
    assert.equal((await del(alice.authId, steps.id)).ok, true);
    assert.equal(await queued(stepKey), 1); assert.equal(await queued(stepsKey), 1);
    assert.deepEqual(await one('SELECT output_r2_key, output_text FROM public.job_steps WHERE job_id = $1', [steps.id]), { output_r2_key: null, output_text: null });
    assert.deepEqual((await one('SELECT payload FROM public.fal_dispatch WHERE job_id = $1', [steps.id])).payload, {}, 'the provider payload is scrubbed');

    // 10. The rate limit is shared with job reads and answers the same way.
    const limited = await signUp();
    await c.query(`INSERT INTO public.job_read_rate_limits (user_id, window_started_at, request_count) VALUES ($1, clock_timestamp(), 601)`, [limited.userId]);
    const lj = await job(limited.userId);
    const r = await del(limited.authId, lj.id);
    assert.equal(r.ok, false); assert.equal(r.code, 'RATE_LIMITED');
    assert.deepEqual((await one('SELECT inputs FROM public.jobs WHERE id = $1', [lj.id])).inputs, { prompt: 'a private prompt' });

    // 11. Only the service role may call it; the browser roles may not, and the column is not theirs.
    for (const role of ['anon', 'authenticated']) {
        await refusedAs(role, 'SELECT public.delete_user_job($1, $2)', [alice.authId, other.id]);
        await refusedAs(role, 'UPDATE public.jobs SET deleted_at = now()');
    }
    await c.query('SET LOCAL ROLE service_role');
    assert.equal((await call('delete_user_job', alice.authId, other.id)).ok, true, 'the service role can');
    await c.query('RESET ROLE');

    // 12. Every reconcile is still clean for everyone touched.
    for (const fn of ['reconcile_balances', 'reconcile_free_credits', 'reconcile_top_ups', 'reconcile_subscription_credits']) {
        const rows = await q(`SELECT user_id FROM public.${fn}() WHERE user_id = ANY($1::uuid[])`, [[alice.userId, bob.userId, fred.userId, limited.userId]]);
        assert.equal(rows.length, 0, `${fn} clean`);
    }

    console.log('job deletion (0351): all checks passed');
} finally {
    await c.query('ROLLBACK');
    await c.end();
}
