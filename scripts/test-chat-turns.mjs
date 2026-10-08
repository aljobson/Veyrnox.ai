#!/usr/bin/env node
// 0193 (ADR-0067): a chat reply is a job. Runs against the full migration replay (ledger-tests.yml).
// Every fixture is rolled back.
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
const rpc = async (sql, args = []) => (await one(`SELECT ${sql} AS r`, args)).r;

async function user() {
    const auth = randomUUID();
    await q('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [auth, `${auth}@example.invalid`]);
    return { auth, id: (await one('SELECT id FROM public.users WHERE auth_id = $1', [auth])).id };
}
const balance = async (u) => Number((await one('SELECT balance FROM public.credit_balances WHERE user_id = $1', [u.id])).balance);
const jobState = async (id) => (await one('SELECT state::text AS s, error_code FROM public.jobs WHERE id = $1', [id]));
const reconciles = async (u) => {
    for (const fn of ['reconcile_subscription_credits', 'reconcile_free_credits', 'reconcile_balances']) {
        assert.deepEqual(await q(`SELECT * FROM public.${fn}() WHERE user_id = $1`, [u.id]), [], fn);
    }
};
const refused = async (sql, args, code) => {
    await c.query('SAVEPOINT r');
    try { await c.query(sql, args); assert.fail(`expected ${code}`); }
    catch (err) { assert.equal(err.code, code, err.message); }
    finally { await c.query('ROLLBACK TO SAVEPOINT r'); }
};
// As a browser role, the statement must be refused with insufficient_privilege. The role is set apart from the
// statement (a parameterised query cannot hold two commands) and undone by the savepoint.
const refusedAs = async (role, sql, args) => {
    await c.query('SAVEPOINT r');
    try { await c.query(`SET LOCAL ROLE ${role}`); await c.query(sql, args); assert.fail(`${role} was allowed: ${sql}`); }
    catch (err) { assert.equal(err.code, '42501', err.message); }
    finally { await c.query('ROLLBACK TO SAVEPOINT r'); }
};
const model = async (id, { modality = 'text', active = true, credits = 2 } = {}) => {
    await q(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, active)
             VALUES ($1, $1, 'openrouter-chat', 'test/model', $2, $3, 0.0004, $4)`, [id, modality, credits, active]);
    return id;
};

const thread = (u, m) => rpc('public.chat_create_thread($1, $2)', [u.auth, m]);
const getThread = (u, id) => rpc('public.chat_get_thread($1, $2)', [u.auth, id]);
// The same sequence the route runs: debit, then mark submitted. Returns the job.
async function startTurn(u, t, m, credits = 2, extraInputs = {}) {
    const d = await rpc(`public.ledger_debit($1, $2, $3, 'debit:chat', $4, $5::jsonb)`,
        [u.id, randomUUID(), credits, m, JSON.stringify({ kind: 'chat', thread_id: t, ...extraInputs })]);
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal((await rpc(`public.job_submitted($1, 'openrouter-chat', $2)`, [d.job_id, d.job_id])).ok, true);
    return d.job_id;
}
const complete = (job, t, text, reply, status = 'complete') => rpc('public.chat_complete_turn($1, $2, $3, $4, $5)', [job, t, text, reply, status]);
const refund = (u, job, credits) => rpc(`public.ledger_refund($1, $2, $3, 'refund:provider_failed')`, [job, u.id, credits]);

try {
    // The migration is safe to apply twice.
    const sql = await readFile(new URL('../packages/db/schema/supabase/0193_chat.sql', import.meta.url), 'utf8');
    await c.query('BEGIN'); await c.query(sql); await c.query(sql); await c.query('ROLLBACK');
    // 0226 keeps the newest message in the history budget; it replays too (inside a rollback, so the body under test stays 0226's).
    const keepNewest = await readFile(new URL('../packages/db/schema/supabase/0226_chat_context_keeps_newest.sql', import.meta.url), 'utf8');
    await c.query('BEGIN'); await c.query(keepNewest); await c.query(keepNewest); await c.query('ROLLBACK');
    // 0198 reads thread messages joined to their jobs and prices Images on the catalog rows; it replays too.
    const images = await readFile(new URL('../packages/db/schema/supabase/0198_chat_models_images.sql', import.meta.url), 'utf8');
    await c.query('BEGIN'); await c.query(images); await c.query(images); await c.query('ROLLBACK');
    // 0203 makes delete a real delete and clears chats that were only hidden before it; it replays too.
    const hardDelete = await readFile(new URL('../packages/db/schema/supabase/0203_chat_delete_is_delete.sql', import.meta.url), 'utf8');
    await c.query('BEGIN');
    {
        const u = await user(); const m = await model(`chat-purge-${randomUUID().slice(0, 8)}`);
        const t = (await thread(u, m)).thread.id;
        await q('UPDATE public.chat_threads SET deleted_at = now() WHERE id = $1', [t]);
        await q("INSERT INTO public.chat_messages (thread_id, role, content, status) VALUES ($1, 'user', 'hidden but still stored', 'complete')", [t]);
        await c.query(hardDelete); await c.query(hardDelete);
        assert.equal((await q('SELECT count(*)::int AS n FROM public.chat_threads WHERE id = $1', [t]))[0].n, 0, 'a chat hidden before 0203 is removed by it');
        assert.equal((await q('SELECT count(*)::int AS n FROM public.chat_messages WHERE thread_id = $1', [t]))[0].n, 0);
    }
    await c.query('ROLLBACK');

    await c.query('BEGIN');
    const suffix = randomUUID().slice(0, 8);
    const fast = await model(`chat-fast-${suffix}`);
    const other = await model(`chat-other-${suffix}`, { credits: 3 });
    const off = await model(`chat-off-${suffix}`, { active: false });
    const vid = await model(`vid-${suffix}`, { modality: 'video' });

    // ── Threads: only active text models; only real users. ──
    const a = await user(); const b = await user();
    assert.equal((await thread({ auth: randomUUID() }, fast)).code, 'USER_NOT_FOUND');
    for (const m of [off, vid, 'no-such-model']) assert.equal((await thread(a, m)).code, 'MODEL_NOT_FOUND', m);
    const ta = (await thread(a, fast)).thread;
    assert.equal(ta.title, 'New chat'); assert.equal(ta.model_id, fast);

    // ── The happy turn: debit, submit, complete. ──
    const before = await balance(a); // 10 Free Credits
    const j1 = await startTurn(a, ta.id, fast, 2);
    assert.equal(await balance(a), before - 2);
    const done = await complete(j1, ta.id, '  Explain\n  Credits   please  ', 'Here is the answer.');
    assert.equal(done.ok, true); assert.equal(done.refund, false);
    assert.deepEqual(await jobState(j1), { s: 'STORED', error_code: null });
    const got = await getThread(a, ta.id);
    assert.deepEqual(got.messages.map((m) => [m.role, m.status, m.credits]), [['user', 'complete', 0], ['assistant', 'complete', 2]]);
    assert.equal(got.thread.title, 'Explain Credits please', 'title comes from the first message, whitespace collapsed');
    assert.equal(await balance(a), before - 2);
    // Replay writes nothing and says the same thing.
    const again = await complete(j1, ta.id, 'Explain', 'Here is the answer.');
    assert.equal(again.idempotent, true); assert.equal(again.message_id, done.message_id);
    assert.equal((await getThread(a, ta.id)).messages.length, 2);
    await reconciles(a);

    // ── A STORED chat job is left alone by the sweeper even when old (it has no asset by design). ──
    await q(`UPDATE public.jobs SET updated_at = now() - interval '5 hours' WHERE id = $1`, [j1]);
    await rpc('public.sweep_stuck_jobs(15, 120, 200, 60)');
    assert.equal((await jobState(j1)).s, 'STORED'); assert.equal(await balance(a), before - 2);

    // ── Stopped by the user after text appeared: kept and charged. ──
    const j2 = await startTurn(a, ta.id, fast, 2);
    const stopped = await complete(j2, ta.id, 'Second question', 'Partial text so far', 'canceled');
    assert.equal(stopped.refund, false); assert.equal((await jobState(j2)).s, 'STORED');
    assert.equal(await balance(a), before - 4);

    // ── Provider cut off after partial text: text kept, job FAILED, caller refunds. ──
    const j3 = await startTurn(a, ta.id, fast, 2);
    const cut = await complete(j3, ta.id, 'Third question', 'It started but', 'error');
    assert.equal(cut.refund, true); assert.equal(cut.credits, 2); assert.equal(cut.user_id, a.id);
    assert.deepEqual(await jobState(j3), { s: 'FAILED', error_code: 'provider_cut_off' });
    assert.equal((await refund(a, j3, 2)).ok, true);
    assert.equal(await balance(a), before - 4, 'the refund returns the two Credits');
    assert.equal((await refund(a, j3, 2)).idempotent, true);
    assert.equal((await complete(j3, ta.id, 'Third question', 'It started but', 'error')).refund, true, 'replay still reports the refund');
    const msgs = (await getThread(a, ta.id)).messages;
    assert.deepEqual(msgs.slice(-1).map((m) => [m.role, m.status, m.credits]), [['assistant', 'error', 0]]);
    await reconciles(a);

    // ── Nothing produced: no messages, job failed, refunded (the route uses job_failed). ──
    const j4 = await startTurn(a, ta.id, fast, 2);
    assert.equal((await rpc(`public.job_failed($1, 'openrouter-chat', 'provider_failed')`, [j4])).ok, true);
    assert.equal((await refund(a, j4, 2)).ok, true);
    assert.equal((await one('SELECT count(*)::int AS n FROM public.chat_messages WHERE job_id = $1', [j4])).n, 0);
    assert.equal(await balance(a), before - 4);

    // ── A turn that dies mid-way is caught by the existing sweeps. ──
    const stuckDebited = (await rpc(`public.ledger_debit($1, $2, 2, 'debit:chat', $3, $4::jsonb)`,
        [a.id, randomUUID(), fast, JSON.stringify({ kind: 'chat', thread_id: ta.id })])).job_id;
    const stuckSubmitted = await startTurn(a, ta.id, fast, 2);
    await q(`UPDATE public.jobs SET updated_at = now() - interval '20 minutes' WHERE id = $1`, [stuckDebited]);
    await q(`UPDATE public.jobs SET updated_at = now() - interval '3 hours' WHERE id = $1`, [stuckSubmitted]);
    const mid = await balance(a);
    await rpc('public.sweep_stuck_jobs(15, 120, 200, 60)');
    assert.equal((await jobState(stuckDebited)).s, 'REFUNDED'); assert.equal((await jobState(stuckSubmitted)).s, 'REFUNDED');
    assert.equal(await balance(a), mid + 4, 'both stuck turns refunded');
    await reconciles(a);

    // ── complete_turn refuses what it should. ──
    const j5 = await startTurn(a, ta.id, fast, 2);
    for (const [args, code] of [
        [[j5, ta.id, 'hi', 'ok', 'weird'], 'INVALID_STATUS'],
        [[j5, ta.id, '   ', 'ok', 'complete'], 'INVALID_TEXT'],
        [[j5, ta.id, 'x'.repeat(8001), 'ok', 'complete'], 'INVALID_TEXT'],
        [[j5, ta.id, 'hi', '', 'complete'], 'INVALID_REPLY'],
        [[j5, ta.id, 'hi', 'y'.repeat(32001), 'complete'], 'INVALID_REPLY'],
        [[randomUUID(), ta.id, 'hi', 'ok', 'complete'], 'JOB_NOT_FOUND'],
        [[j5, randomUUID(), 'hi', 'ok', 'complete'], 'THREAD_NOT_FOUND'],
    ]) assert.equal((await complete(...args)).code, code, code);
    // A media job is not a chat job, even for the same user.
    const media = (await rpc(`public.ledger_debit($1, $2, 2, 'debit:generation', $3, '{"prompt":"a cat"}'::jsonb)`, [a.id, randomUUID(), vid])).job_id;
    assert.equal((await complete(media, ta.id, 'hi', 'ok', 'complete')).code, 'JOB_NOT_FOUND');
    // Someone else's thread cannot receive my job's reply.
    const tb = (await thread(b, fast)).thread;
    assert.equal((await complete(j5, tb.id, 'hi', 'ok', 'complete')).code, 'THREAD_NOT_FOUND');
    // A job that is not SUBMITTED cannot be completed.
    assert.equal((await complete(stuckDebited, ta.id, 'hi', 'ok', 'complete')).code, 'BAD_STATE');

    // ── The Library lists media only. ──
    const lib = (await rpc('public.list_user_jobs($1, 50)', [a.auth])).jobs.map((j) => j.job_id);
    assert.ok(lib.includes(media), 'media job is listed');
    for (const id of [j1, j2, j3, j4, j5, stuckDebited, stuckSubmitted]) assert.ok(!lib.includes(id), 'chat job is not listed');

    // ── Ownership: user B reaches none of A's chat data. ──
    assert.equal((await getThread(b, ta.id)).code, 'THREAD_NOT_FOUND');
    assert.equal((await rpc('public.chat_turn_context($1, $2, 1000)', [b.auth, ta.id])).code, 'THREAD_NOT_FOUND');
    assert.equal((await rpc('public.chat_update_thread($1, $2, $3)', [b.auth, ta.id, 'hijacked'])).code, 'THREAD_NOT_FOUND');
    assert.equal((await rpc('public.chat_delete_thread($1, $2)', [b.auth, ta.id])).code, 'THREAD_NOT_FOUND');
    assert.deepEqual((await rpc('public.chat_list_threads($1)', [b.auth])).threads.map((t) => t.id), [tb.id]);
    assert.equal((await getThread(a, ta.id)).thread.title, 'Explain Credits please', 'A is untouched');

    // ── Turn context: oldest first, within the budget, refunded replies left out. ──
    const ctx = await rpc('public.chat_turn_context($1, $2, 100000)', [a.auth, ta.id]);
    assert.equal(ctx.ok, true); assert.equal(ctx.user_id, a.id); assert.equal(ctx.model_id, fast);
    assert.deepEqual(ctx.history.map((h) => h.content),
        ['Explain\n  Credits   please', 'Here is the answer.', 'Second question', 'Partial text so far', 'Third question']);
    assert.deepEqual(ctx.history.map((h) => h.role), ['user', 'assistant', 'user', 'assistant', 'user'],
        'a turn\'s two messages stay in order even though they share a transaction timestamp');
    assert.ok(!ctx.history.some((h) => h.content === 'It started but'), 'a refunded reply is not sent back to the model');
    const tight = await rpc('public.chat_turn_context($1, $2, 40)', [a.auth, ta.id]);
    assert.deepEqual(tight.history.map((h) => h.content), ['Partial text so far', 'Third question'],
        'the newest messages that fit the budget, oldest first');
    assert.deepEqual((await rpc('public.chat_turn_context($1, $2, 0)', [a.auth, ta.id])).history, []);
    // 0226: a newest message longer than the whole budget still reaches the model, cut to its last <budget> characters, and older ones stay out.
    const clipped = await rpc('public.chat_turn_context($1, $2, 10)', [a.auth, ta.id]);
    assert.deepEqual(clipped.history.map((h) => h.content), ['d question'], 'the newest message is never dropped for being long');

    // ── Updating and deleting a thread. ──
    for (const args of [[a.auth, ta.id, '   '], [a.auth, ta.id, 'x'.repeat(121)], [a.auth, ta.id, null, null, 'p'.repeat(4001)]]) {
        assert.equal((await rpc('public.chat_update_thread($1, $2, $3, $4, $5)', [...args, null, null, null].slice(0, 5))).code, 'INVALID_INPUT');
    }
    assert.equal((await rpc('public.chat_update_thread($1, $2, null, null, null, $3)', [a.auth, ta.id, off])).code, 'MODEL_NOT_FOUND');
    const upd = await rpc('public.chat_update_thread($1, $2, $3, true, $4, $5)', [a.auth, ta.id, '  Renamed  ', 'Be brief.', other]);
    assert.deepEqual([upd.thread.title, upd.thread.pinned, upd.thread.system_prompt, upd.thread.model_id], ['Renamed', true, 'Be brief.', other]);
    const t2 = (await thread(a, fast)).thread;
    assert.equal((await rpc('public.chat_list_threads($1)', [a.auth])).threads[0].id, ta.id, 'pinned threads sort first');
    assert.equal((await rpc('public.chat_delete_thread($1, $2)', [a.auth, t2.id])).ok, true);
    assert.equal((await getThread(a, t2.id)).code, 'THREAD_NOT_FOUND');
    assert.equal((await rpc('public.chat_delete_thread($1, $2)', [a.auth, t2.id])).code, 'THREAD_NOT_FOUND', 'deleting twice');
    assert.ok(!(await rpc('public.chat_list_threads($1)', [a.auth])).threads.some((t) => t.id === t2.id));

    // ── Deleting a chat deletes it: the thread and its messages are gone, the money record stays (0203). ──
    {
        const u = await user(); const t = (await thread(u, fast)).thread.id;
        const job = await startTurn(u, t, fast);
        assert.equal((await complete(job, t, 'a private question', 'a private answer')).ok, true);
        assert.equal((await rpc('public.chat_delete_thread($1, $2)', [u.auth, t])).ok, true);
        assert.equal((await q('SELECT count(*)::int AS n FROM public.chat_threads WHERE id = $1', [t]))[0].n, 0, 'the thread row is gone, not hidden');
        assert.equal((await q('SELECT count(*)::int AS n FROM public.chat_messages WHERE thread_id = $1', [t]))[0].n, 0, 'its messages went with it');
        const [j] = await q('SELECT state, credits FROM public.jobs WHERE id = $1', [job]);
        assert.deepEqual([j.state, j.credits], ['STORED', 2], 'the job and its charge stay: that is the ledger, and it never held the text');
        assert.ok(!JSON.stringify(await q('SELECT inputs FROM public.jobs WHERE id = $1', [job])).includes('private'));
    }

    // ── The data export (docs/product/chat-data-export.sql): one person's chats, in order, nobody else's. ──
    {
        const u = await user(); const v = await user();
        const tu = (await thread(u, fast)).thread.id; const tv = (await thread(v, fast)).thread.id;
        await rpc('public.chat_update_thread($1, $2, null, true, $3)', [u.auth, tu, 'Be brief.']);
        const ju = await startTurn(u, tu, fast); assert.equal((await complete(ju, tu, 'mine first', 'reply one')).ok, true);
        const ju2 = await startTurn(u, tu, fast); assert.equal((await complete(ju2, tu, 'mine second', 'reply two')).ok, true);
        const jv = await startTurn(v, tv, fast); assert.equal((await complete(jv, tv, 'someone elses secret', 'their reply')).ok, true);
        const sqlText = await readFile(new URL('../docs/product/chat-data-export.sql', import.meta.url), 'utf8');
        const run = async (email) => (await c.query(sqlText.replace("lower('user@example.com')", `lower('${email}')`))).rows;
        const [row] = await run(`${u.auth.toUpperCase()}@Example.invalid`); // case does not matter
        const doc = JSON.parse(row.chat_export);
        assert.equal(doc.account_email, `${u.auth}@example.invalid`);
        assert.equal(doc.chats.length, 1);
        assert.deepEqual([doc.chats[0].instructions, doc.chats[0].pinned], ['Be brief.', true]);
        assert.deepEqual(doc.chats[0].messages.map((m) => [m.role, m.text]),
            [['user', 'mine first'], ['assistant', 'reply one'], ['user', 'mine second'], ['assistant', 'reply two']], 'in order');
        assert.ok(!row.chat_export.includes('someone elses secret') && !row.chat_export.includes('their reply'), "never another person's chat");
        assert.equal((await run('nobody-at-all@example.invalid')).length, 0, 'no account, no row');
    }

    // ── The per-user thread cap. ──
    const c3 = await user();
    await q(`INSERT INTO public.chat_threads (user_id, model_id) SELECT $1, $2 FROM generate_series(1, 500)`, [c3.id, fast]);
    assert.equal((await thread(c3, fast)).code, 'THREAD_LIMIT');

    // ── Attachments: the thread read returns type and pixel size on the user message only, never a key or name. ──
    {
        const u = await user(); const t = (await thread(u, fast)).thread.id;
        await q('INSERT INTO public.credit_balances (user_id, balance) VALUES ($1, 10) ON CONFLICT (user_id) DO UPDATE SET balance = 10', [u.id]).catch(() => {});
        const job = await startTurn(u, t, fast, 2, {
            attachments: [{ type: 'image/png', width: 1600, height: 900 }],
            source_keys: { image_1: `uploads/${u.auth}/${randomUUID()}.png` },
        });
        assert.equal((await complete(job, t, 'What is this?', 'A chart.')).ok, true);
        const got = await getThread(u, t);
        const [mine, theirs] = got.messages;
        assert.equal(mine.role, 'user'); assert.equal(theirs.role, 'assistant');
        assert.deepEqual(mine.attachments, [{ type: 'image/png', width: 1600, height: 900 }]);
        assert.deepEqual(theirs.attachments, []);
        assert.ok(!JSON.stringify(got).includes('uploads/') && !JSON.stringify(got).includes('source_keys'), 'no key reaches the browser');
        // A turn with no attachments reads as an empty list on both messages.
        const job2 = await startTurn(u, t, fast);
        assert.equal((await complete(job2, t, 'And now?', 'Fine.')).ok, true);
        const again = (await getThread(u, t)).messages;
        assert.deepEqual(again.map((m) => m.attachments), [[{ type: 'image/png', width: 1600, height: 900 }], [], [], []]);
    }

    // ── Browser roles reach nothing: no table, no function. ──
    for (const role of ['anon', 'authenticated']) {
        await refusedAs(role, 'SELECT * FROM public.chat_threads', []);
        await refusedAs(role, 'SELECT * FROM public.chat_messages', []);
        await refusedAs(role, 'SELECT public.chat_list_threads($1)', [a.auth]);
        await refusedAs(role, "SELECT public.chat_complete_turn($1, $2, 'x', 'y', 'complete')", [j5, ta.id]);
    }
    const flags = await one(`SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced FROM pg_class c
                             WHERE c.oid = 'public.chat_threads'::regclass`);
    assert.deepEqual([flags.rls, flags.forced], [true, true]);

    console.log('chat turns: ok');
} finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
}
