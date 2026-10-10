#!/usr/bin/env node
// 0242 (ADR-0067 amendment 11): a chat send is asked about by its own key, and closed when it made no job. Runs
// against the full migration replay (ledger-tests.yml). Fixtures are committed so the race between a close and a
// debit can use real connections; the replay database is throwaway.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: url, max: 12 });
const one = async (sql, args = []) => (await pool.query(sql, args)).rows[0];
const rpc = async (sql, args = []) => (await one(`SELECT ${sql} AS r`, args)).r;
const CHAT = `close-chat-${randomUUID().slice(0, 8)}`;
const FREE = `close-free-${randomUUID().slice(0, 8)}`;
const newKey = () => `vx-${randomUUID()}`;

async function user() {
    const auth = randomUUID();
    await pool.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [auth, `${auth}@example.invalid`]);
    return { auth, id: (await one('SELECT id FROM public.users WHERE auth_id = $1', [auth])).id };
}
const close = (u, key) => rpc('public.chat_close_send($1, $2)', [u.auth, key]);
// The debit the chat turn makes (lib/chatTurn.js): `kind: chat` in the job's inputs.
const debit = (u, key, { inputs = { kind: 'chat', thread_id: randomUUID() }, model = CHAT, credits = 2 } = {}) =>
    rpc(`public.ledger_debit($1, $2, $3, 'debit:chat', $4, $5::jsonb)`, [u.id, key, credits, model, JSON.stringify(inputs)]);
const freeJob = (u, key) => rpc('public.submit_free_job($1, $2, $3, $4::jsonb, 0, 60)', [u.id, key, FREE, JSON.stringify({ kind: 'chat', thread_id: randomUUID() })]);
const balance = async (u) => Number((await one('SELECT balance FROM public.credit_balances WHERE user_id = $1', [u.id])).balance);
const count = async (sql, args) => (await one(`SELECT count(*)::int AS n FROM ${sql}`, args)).n;
const jobsFor = (u, key) => count('public.jobs WHERE user_id = $1 AND idempotency_key = $2', [u.id, key]);
const closedRows = (u) => count('public.chat_closed_sends WHERE user_id = $1', [u.id]);
// The trigger's refusal, as the Worker's database client sees it: SQLSTATE PT409 (PostgREST answers 409) and this message.
async function refusedClosed(run) {
    try { await run(); assert.fail('the debit was allowed'); }
    catch (err) { assert.deepEqual([err.code, err.message], ['PT409', 'CHAT_SEND_CLOSED']); }
}
const reconciles = async (u) => {
    for (const fn of ['reconcile_subscription_credits', 'reconcile_free_credits', 'reconcile_balances']) {
        assert.deepEqual((await pool.query(`SELECT * FROM public.${fn}() WHERE user_id = $1`, [u.id])).rows, [], fn);
    }
};

let failed = 0;
async function check(name, fn) {
    try { await fn(); console.log(`  ok  ${name}`); }
    catch (err) { failed += 1; console.error(`  FAIL ${name}\n       ${err.message}`); }
}

try {
    // Safe to apply twice, and a replay keeps what was closed.
    const migration = await readFile(new URL('../packages/db/schema/supabase/0242_chat_close_send.sql', import.meta.url), 'utf8');
    await pool.query(migration); await pool.query(migration);
    for (const id of [CHAT, FREE]) {
        await pool.query(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, active)
            VALUES ($1, $1, 'openrouter-chat', 'test/model', 'text', 2, 0.0004, true)`, [id]);
    }
    // Within 0205's limits: 20 a day for a person at most, and a daily budget worth $1.00 of provider cost at most.
    const allowance = await pool.query('UPDATE public.model_catalog SET free_allowance_per_day = 20, free_allowance_daily_budget = 2000 WHERE id = $1', [FREE]);
    assert.equal(allowance.rowCount, 1);

    await check('a send that made no job is closed, once, and says so every time it is asked', async () => {
        const u = await user(); const key = newKey();
        assert.deepEqual(await close(u, key), { ok: true, closed: true });
        assert.deepEqual(await close(u, key), { ok: true, closed: true });
        assert.equal(await closedRows(u), 1);
        await pool.query(migration);
        assert.deepEqual(await close(u, key), { ok: true, closed: true }, 'still closed after the migration is applied again');
    });

    await check('once closed, no chat reply can be charged for that key: the debit is undone whole', async () => {
        const u = await user(); const key = newKey(); const before = await balance(u);
        await close(u, key);
        await refusedClosed(() => debit(u, key));
        assert.equal(await jobsFor(u, key), 0);
        assert.equal(await count('public.ledger_entries WHERE user_id = $1 AND reason = $2', [u.id, 'debit:chat']), 0);
        assert.equal(await balance(u), before);
        await reconciles(u);
        // The person's next message has a key of its own and is charged as ever.
        const next = await debit(u, newKey());
        assert.deepEqual([next.ok, next.idempotent, next.balance_after], [true, false, before - 2]);
        await reconciles(u);
    });

    await check('the same on the free allowance path: no free job, and the allowance is not used up', async () => {
        const u = await user(); const key = newKey();
        await close(u, key);
        await refusedClosed(() => freeJob(u, key));
        assert.equal(await jobsFor(u, key), 0);
        assert.equal(await count('public.model_free_allowance_claims WHERE user_id = $1', [u.id]), 0, 'the claim was undone with the job');
        const next = await freeJob(u, newKey());
        assert.deepEqual([next.ok, next.taken], [true, true], JSON.stringify(next));
    });

    await check('a send that made a job is answered with that job, as it moves, and is never closed', async () => {
        const u = await user(); const key = newKey();
        const d = await debit(u, key);
        const seen = async () => { const r = await close(u, key); assert.deepEqual([r.ok, r.closed, r.job_id, r.credits, r.model_id], [true, false, d.job_id, 2, CHAT]); return [r.state, r.error_code]; };
        assert.deepEqual(await seen(), ['DEBITED', null]);
        await rpc(`public.job_submitted($1, 'openrouter-chat', $2)`, [d.job_id, d.job_id]);
        assert.deepEqual(await seen(), ['SUBMITTED', null]);
        await rpc(`public.job_failed($1, 'openrouter-chat', 'user_canceled')`, [d.job_id]);
        assert.deepEqual(await seen(), ['FAILED', 'user_canceled'], 'failed, the refund not yet in');
        await rpc(`public.ledger_refund($1, $2, 2, 'refund:provider_failed')`, [d.job_id, u.id]);
        assert.deepEqual(await seen(), ['REFUNDED', 'user_canceled']);
        assert.equal(await closedRows(u), 0, 'nothing is written for a send that has a job');
        // The same send again is a replay, as it always was: it is not refused, and charges nothing more.
        const replay = await debit(u, key);
        assert.deepEqual([replay.ok, replay.idempotent, replay.job_id], [true, true, d.job_id]);
        // A reply that was delivered and could not be stored reads as charged, with its code.
        const key2 = newKey(); const d2 = await debit(u, key2);
        await rpc(`public.job_submitted($1, 'openrouter-chat', $2)`, [d2.job_id, d2.job_id]);
        await rpc('public.chat_settle_unsaved_turn($1)', [d2.job_id]);
        const r2 = await close(u, key2);
        assert.deepEqual([r2.closed, r2.state, r2.error_code], [false, 'STORED', 'reply_not_saved']);
        // Nothing of the provider, the inputs or the dates is returned.
        assert.deepEqual(Object.keys(r2).sort(), ['closed', 'credits', 'error_code', 'job_id', 'model_id', 'ok', 'state']);
    });

    await check('a send is looked for among the caller\'s own, and closed for the caller alone', async () => {
        const a = await user(); const b = await user(); const key = newKey();
        const d = await debit(a, key);
        // B asks about A's key: the same answer as for a key nobody used. Nothing of A's job is shown.
        assert.deepEqual(await close(b, key), { ok: true, closed: true });
        assert.deepEqual(await close(b, newKey()), { ok: true, closed: true });
        // It closed nothing of A's: A's job is as it was, and A's replay still answers.
        assert.equal((await close(a, key)).job_id, d.job_id);
        assert.equal((await debit(a, key)).idempotent, true);
        // And a key B closed is not closed for A: A's send under the same words is charged.
        const shared = newKey();
        await close(b, shared);
        assert.equal((await debit(a, shared)).ok, true);
        await refusedClosed(() => debit(b, shared));
        // Someone who is not a user gets no row and no answer about anyone.
        assert.deepEqual(await close({ auth: randomUUID() }, key), { ok: false, code: 'USER_NOT_FOUND' });
        assert.deepEqual(await close({ auth: null }, key), { ok: false, code: 'USER_NOT_FOUND' });
    });

    await check('only a key the browser makes can be closed, and only a chat reply is ever refused', async () => {
        const u = await user(); const key = newKey();
        const bad = [null, '', 'key-0123456789', key.slice(3), key.toUpperCase(), `${key}0`, ` ${key}`, `${key}\n`, `vx-${'f'.repeat(36)}`, `${key}:step-1`, `autoshort:${key}`];
        for (const k of bad) assert.deepEqual(await close(u, k), { ok: false, code: 'INVALID_KEY' }, JSON.stringify(k));
        assert.equal(await closedRows(u), 0);
        await assert.rejects(pool.query('INSERT INTO public.chat_closed_sends (user_id, idempotency_key) VALUES ($1, $2)', [u.id, 'key-0123456789']), /violates check constraint/);
        // A closed key does nothing to a job that is not a chat reply: a generation with the same key is made and charged.
        await close(u, key);
        const gen = await debit(u, key, { inputs: { prompt: 'a lighthouse' } });
        assert.deepEqual([gen.ok, gen.idempotent], [true, false]);
        for (const inputs of [{ kind: 'video' }, { kind: 'Chat' }, { kind: null }, {}]) assert.equal((await debit(u, newKey(), { inputs, credits: 1 })).ok, true, JSON.stringify(inputs));
        // And then that key has a job: asking again answers with it.
        assert.equal((await close(u, key)).job_id, gen.job_id);
    });

    await check('it shares the job read quota, and a refused call closes nothing', async () => {
        const u = await user(); const key = newKey();
        await close(u, newKey());
        await pool.query('UPDATE public.job_read_rate_limits SET request_count = 600 WHERE user_id = $1', [u.id]);
        const r = await close(u, key);
        assert.deepEqual([r.ok, r.code, r.limit], [false, 'RATE_LIMITED', 600]);
        assert.ok(r.retry_after_seconds >= 1 && r.retry_after_seconds <= 60);
        assert.equal(await closedRows(u), 1);
        assert.equal((await debit(u, key)).ok, true, 'the key was not closed, so its send is still charged');
        // The job read counts against the same bucket.
        assert.equal((await rpc('public.get_user_job($1, $2)', [u.auth, randomUUID()])).code, 'RATE_LIMITED');
    });

    await check('at most 200 closed keys are kept for a person, and only one older than 30 days makes room', async () => {
        const u = await user(); const other = await user();
        const fill = (who, n) => pool.query(`INSERT INTO public.chat_closed_sends (user_id, idempotency_key)
            SELECT $1, 'vx-' || gen_random_uuid() FROM generate_series(1, $2::int)`, [who.id, n]);
        await fill(u, 200);
        const key = newKey();
        assert.deepEqual(await close(u, key), { ok: false, code: 'CLOSE_LIMIT' });
        assert.equal(await closedRows(u), 200);
        assert.equal((await debit(u, key)).ok, true, 'not closed: nothing final was said, so the send can still be charged');
        // The limit is each person's own: someone else closes a send as ever.
        assert.deepEqual(await close(other, newKey()), { ok: true, closed: true });
        // One already closed still says so at the limit.
        const old = (await one('SELECT idempotency_key AS k FROM public.chat_closed_sends WHERE user_id = $1 LIMIT 1', [u.id])).k;
        assert.deepEqual(await close(u, old), { ok: true, closed: true });
        // Twenty-nine days is not old enough: nothing is removed, the limit holds, and the key is still refused its job.
        await pool.query(`UPDATE public.chat_closed_sends SET closed_at = now() - interval '29 days' WHERE user_id = $1`, [u.id]);
        assert.deepEqual(await close(u, newKey()), { ok: false, code: 'CLOSE_LIMIT' });
        assert.equal(await closedRows(u), 200);
        await refusedClosed(() => debit(u, old));
        // Thirty-one days is. Only this person's old keys go: the other person's stay, however old.
        await pool.query(`UPDATE public.chat_closed_sends SET closed_at = now() - interval '31 days' WHERE user_id = ANY($1::uuid[]) AND idempotency_key <> $2`, [[u.id, other.id], old]);
        assert.deepEqual(await close(u, newKey()), { ok: true, closed: true });
        assert.equal(await closedRows(u), 2, 'the 199 old ones were removed');
        assert.equal(await closedRows(other), 1, 'another person\'s closed key is not this call\'s to remove');
    });

    await check('"closed" is said only under READ COMMITTED, and no function on this path sets another level', async () => {
        const u = await user(); const key = newKey();
        for (const level of ['REPEATABLE READ', 'SERIALIZABLE']) {
            const c = await pool.connect();
            try {
                await c.query(`BEGIN ISOLATION LEVEL ${level}`);
                assert.deepEqual((await c.query('SELECT public.chat_close_send($1, $2) AS r', [u.auth, key])).rows[0].r, { ok: false, code: 'ISOLATION_LEVEL' }, level);
                await c.query('COMMIT');
            } finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
        }
        assert.equal(await closedRows(u), 0);
        assert.equal((await one('SHOW default_transaction_isolation')).default_transaction_isolation, 'read committed');
        // The debit must see a close that committed while it waited, so it has to run at the default level too.
        const set = (await pool.query(`SELECT n.nspname || '.' || p.proname AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE p.proname IN ('chat_close_send', 'refuse_closed_chat_send', 'ledger_debit', 'ledger_debit_for_admission', 'submit_free_job', 'submit_free_job_for_admission')
              AND EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'default_transaction_isolation%' OR c LIKE 'transaction_isolation%')`)).rows;
        assert.deepEqual(set, []);
    });

    await check('a person\'s closed keys go with the person', async () => {
        const fk = await one(`SELECT confdeltype FROM pg_constraint WHERE conrelid = 'public.chat_closed_sends'::regclass AND contype = 'f'`);
        assert.equal(fk.confdeltype, 'c', 'ON DELETE CASCADE to users');
        // Someone with no jobs and no ledger rows can be deleted (other tests remove such fixtures): a closed key must not hold them.
        const auth = randomUUID();
        const { id } = await one('SELECT public.provision_user($1, $2) AS id', [auth, `${auth}@example.invalid`]);
        assert.deepEqual(await close({ auth }, newKey()), { ok: true, closed: true });
        assert.equal((await pool.query('DELETE FROM public.users WHERE id = $1', [id])).rowCount, 1);
        assert.equal(await count('public.chat_closed_sends WHERE user_id = $1', [id]), 0);
    });

    await check('a close and a debit racing for one key: never both "closed" and a job', async () => {
        const rounds = 40; let closedFirst = 0; let debitFirst = 0;
        for (let i = 0; i < rounds; i += 1) {
            // A person and a key of their own each round, the paid debit and the free job in turn, and either may start first.
            const u = await user(); const key = newKey();
            const job = () => (i % 4 < 2 ? debit(u, key) : freeJob(u, key)).then((r) => ['job', r], (err) => ['refused', err]);
            const results = await Promise.all(i % 2 ? [close(u, key), job()] : [job(), close(u, key)]);
            const answer = results.find((r) => !Array.isArray(r)); const [how, made] = results.find(Array.isArray);
            const jobs = await jobsFor(u, key);
            if (answer.closed) {
                closedFirst += 1;
                assert.equal(jobs, 0, `round ${i}: "closed" was said and a job exists`);
                assert.deepEqual([how, made.code, made.message], ['refused', 'PT409', 'CHAT_SEND_CLOSED'], `round ${i}`);
                assert.equal(await balance(u), 10, `round ${i}: nothing was debited`);
            } else {
                debitFirst += 1;
                assert.deepEqual([how, jobs, answer.job_id, made.ok], ['job', 1, made.job_id, true], `round ${i}`);
            }
            await reconciles(u);
        }
        console.log(`       ${rounds} rounds: the close came first in ${closedFirst}, the debit in ${debitFirst}`);
    });

    await check('a debit that has not ended makes the close wait for it, and a close that has not ended makes the debit wait', async () => {
        const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
        const inTransaction = async (fn) => { const c = await pool.connect(); try { await c.query('BEGIN'); return await fn(c); } finally { await c.query('ROLLBACK').catch(() => {}); c.release(); } };
        const u = await user();
        // The debit is first and still open: the close cannot say "closed" until it knows how the debit ended.
        const key = newKey();
        await inTransaction(async (c) => {
            const d = (await c.query(`SELECT public.ledger_debit($1, $2, 2, 'debit:chat', $3, '{"kind":"chat"}'::jsonb) AS r`, [u.id, key, CHAT])).rows[0].r;
            let answered = false;
            const closing = close(u, key).finally(() => { answered = true; });
            await sleep(300);
            assert.equal(answered, false, 'the close waits');
            await c.query('COMMIT');
            assert.deepEqual([(await closing).closed, (await closing).job_id], [false, d.job_id]);
        });
        // The same, and the debit is undone: the close then finds no job and closes the key.
        const undone = newKey();
        await inTransaction(async (c) => {
            await c.query(`SELECT public.ledger_debit($1, $2, 2, 'debit:chat', $3, '{"kind":"chat"}'::jsonb) AS r`, [u.id, undone, CHAT]);
            const closing = close(u, undone);
            await sleep(100);
            await c.query('ROLLBACK');
            assert.deepEqual(await closing, { ok: true, closed: true });
            assert.equal(await jobsFor(u, undone), 0);
        });
        // The close is first and still open: the debit cannot make its job until it knows whether the key was closed.
        const closing = newKey();
        await inTransaction(async (c) => {
            assert.deepEqual((await c.query('SELECT public.chat_close_send($1, $2) AS r', [u.auth, closing])).rows[0].r, { ok: true, closed: true });
            let ended = false;
            const debiting = debit(u, closing).then((r) => ['job', r], (err) => ['refused', err]).finally(() => { ended = true; });
            await sleep(300);
            assert.equal(ended, false, 'the debit waits');
            await c.query('COMMIT');
            const [how, err] = await debiting;
            assert.deepEqual([how, err.code, err.message], ['refused', 'PT409', 'CHAT_SEND_CLOSED']);
            assert.equal(await jobsFor(u, closing), 0);
        });
        // The same, and the close is undone: nothing was closed, so the send is charged as any other.
        const notClosed = newKey();
        await inTransaction(async (c) => {
            await c.query('SELECT public.chat_close_send($1, $2) AS r', [u.auth, notClosed]);
            const debiting = debit(u, notClosed);
            await sleep(100);
            await c.query('ROLLBACK');
            assert.equal((await debiting).ok, true);
            assert.equal(await jobsFor(u, notClosed), 1);
        });
        await reconciles(u);
    });

    await check('RLS is forced and no browser or Worker role can touch the table; only the Worker can call the function', async () => {
        const t = await one("SELECT relrowsecurity AS rls, relforcerowsecurity AS forced FROM pg_class WHERE oid = 'public.chat_closed_sends'::regclass");
        assert.deepEqual(t, { rls: true, forced: true });
        for (const role of ['anon', 'authenticated', 'service_role']) {
            for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
                assert.equal((await one("SELECT has_table_privilege($1, 'public.chat_closed_sends', $2) AS p", [role, p])).p, false, `${role} ${p}`);
            }
            assert.equal((await one("SELECT has_function_privilege($1, 'public.chat_close_send(text,text)', 'EXECUTE') AS p", [role])).p, role === 'service_role', role);
            assert.equal((await one("SELECT has_function_privilege($1, 'private.refuse_closed_chat_send()', 'EXECUTE') AS p", [role])).p, false, role);
        }
        const fns = (await pool.query(`SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname, p.proname) IN (('public', 'chat_close_send'), ('private', 'refuse_closed_chat_send')) ORDER BY 1`)).rows;
        assert.deepEqual(fns.map((f) => [f.proname, f.prosecdef, f.proconfig]), [['chat_close_send', true, ['search_path=""']], ['refuse_closed_chat_send', true, ['search_path=""']]]);
        assert.equal(await count("pg_trigger WHERE tgname = 'jobs_refuse_closed_chat_send' AND tgrelid = 'public.jobs'::regclass AND NOT tgisinternal", []), 1, 'one trigger, however often the migration is applied');
    });
} finally {
    // Leave no drift behind for the scripts that run after this one.
    await pool.query('UPDATE public.model_catalog SET active = false, free_allowance_per_day = 0, free_allowance_daily_budget = 0 WHERE id = ANY($1::text[])', [[CHAT, FREE]]).catch(() => {});
    await pool.query('DELETE FROM public.model_free_allowance_claims WHERE model_id = ANY($1::text[])', [[CHAT, FREE]]).catch(() => {});
    await pool.end();
}
if (failed > 0) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('chat close send: all passed');
