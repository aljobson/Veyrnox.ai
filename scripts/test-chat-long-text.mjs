#!/usr/bin/env node
// 0517 (ADR-0067 amendment 17): long chat messages. Runs against the full migration replay (ledger-tests.yml).
// Every fixture is rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
if (/supabase\.(co|com)/.test(url)) throw new Error('use an isolated test database');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const rpc = async (sql, args = []) => (await one(`SELECT ${sql} AS r`, args)).r;
const FLOOR = 0.01796;
// Input $/M the migration prices on: the higher of the recorded and the live OpenRouter rate (2026-11-14).
const RATE = {
    'chat-claude-opus-5.5': 4, 'chat-claude-sonnet-5.5': 2, 'chat-gpt-6.1-sol': 2, 'chat-grok-4.7': 2, 'chat-gemini-3.8-flash': 0.825,
    'chat-gpt-6-luna': 0.1, 'chat-deepseek-v4.1-flash': 0.3, 'chat-llama-4-maverick': 0.35, 'chat-ministral-14b': 0.2, 'chat-mistral-small': 0.15,
};
const EXTRA_TOKENS = 5500; // 7,500 tokens at most against 2,000 before

async function user() {
    const auth = randomUUID();
    await q('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [auth, `${auth}@example.invalid`]);
    return { auth, id: (await one('SELECT id FROM public.users WHERE auth_id = $1', [auth])).id };
}
const model = async (id) => {
    await q(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, active)
             VALUES ($1, $1, 'openrouter-chat', 'test/model', 'text', 2, 0.0004, true)`, [id]);
    return id;
};
async function startTurn(u, t, m, credits, extraInputs = {}) {
    const d = await rpc(`public.ledger_debit($1, $2, $3, 'debit:chat', $4, $5::jsonb)`,
        [u.id, randomUUID(), credits, m, JSON.stringify({ kind: 'chat', thread_id: t, ...extraInputs })]);
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal((await rpc(`public.job_submitted($1, 'openrouter-chat', $2)`, [d.job_id, d.job_id])).ok, true);
    return d.job_id;
}
const complete = (job, t, text) => rpc('public.chat_complete_turn($1, $2, $3, $4, $5)', [job, t, text, 'ok', 'complete']);
const balance = async (u) => Number((await one('SELECT balance FROM public.credit_balances WHERE user_id = $1', [u.id])).balance);
const refusedUpdate = async (set, re) => {
    await c.query('SAVEPOINT r');
    try { await c.query(`UPDATE public.model_catalog SET ${set} WHERE id = 'chat-claude-opus-5.5'`); assert.fail(`expected ${re}`); }
    catch (err) { assert.match(err.message, re); }
    finally { await c.query('ROLLBACK TO SAVEPOINT r'); }
};

try {
    await c.query('BEGIN');
    const sql = await readFile(new URL('../packages/db/schema/supabase/0517_chat_long_message_extra.sql', import.meta.url), 'utf8');
    await c.query(sql); await c.query(sql); // safe to apply twice

    // Every live chat row prices long messages, the recorded cost covers 5,500 tokens at its rate, and the Credits clear the floor.
    const rows = await q('SELECT id, chat_long_text_extra_credits AS credits, chat_long_text_extra_cost AS cost FROM public.model_catalog WHERE id = ANY($1)', [Object.keys(RATE)]);
    assert.equal(rows.length, 10);
    for (const r of rows) {
        const worst = (EXTRA_TOKENS * RATE[r.id]) / 1e6;
        assert.ok(Number(r.cost) >= worst, `${r.id}: ${r.cost} under ${worst}`);
        assert.ok(r.credits >= Math.ceil(Number(r.cost) / FLOOR), `${r.id} below the floor`);
    }
    assert.equal((await one("SELECT count(*)::int AS n FROM public.model_catalog WHERE id LIKE 'editor-%' AND chat_long_text_extra_credits IS NOT NULL")).n, 0);
    await refusedUpdate('chat_long_text_extra_credits = 1', /chat_long_text_check/); // 0.0264 needs 2
    await refusedUpdate('chat_long_text_extra_cost = NULL', /chat_long_text_check/);
    await refusedUpdate("modality = 'image'", /text_only_check/);

    // The stored text: 30,000 accepted, 30,001 refused; over 8,000 only for a job marked long_text.
    const u = await user();
    const m = await model(`chat-long-${randomUUID().slice(0, 8)}`);
    const t = (await rpc('public.chat_create_thread($1, $2)', [u.auth, m])).thread.id;
    const start = await balance(u);
    assert.ok(start >= 5, `the signup grant (${start}) covers the 5 Credits these turns spend`);
    let job = await startTurn(u, t, m, 3, { long_text: true });
    assert.equal((await complete(job, t, 'x'.repeat(30001))).code, 'INVALID_TEXT');
    assert.equal((await complete(job, t, 'x'.repeat(30000))).ok, true);
    assert.equal((await one("SELECT length(content) AS n FROM public.chat_messages WHERE job_id = $1 AND role = 'user'", [job])).n, 30000);
    assert.equal((await complete(job, t, 'x'.repeat(30000))).idempotent, true, 'a replay writes nothing');
    assert.equal((await one('SELECT count(*)::int AS n FROM public.chat_messages WHERE job_id = $1', [job])).n, 2);

    job = await startTurn(u, t, m, 2);
    assert.equal((await complete(job, t, 'x'.repeat(8001))).code, 'INVALID_TEXT', 'a long message on a job priced without the extra');
    assert.equal((await complete(job, t, 'x'.repeat(8000))).ok, true, '8,000 needs no mark');
    assert.equal(await balance(u), start - 5);
    for (const fn of ['reconcile_balances', 'reconcile_free_credits']) assert.deepEqual(await q(`SELECT * FROM public.${fn}() WHERE user_id = $1`, [u.id]), [], fn);

    // Browser roles cannot call the redefined function.
    for (const role of ['anon', 'authenticated']) {
        assert.equal((await one(`SELECT has_function_privilege($1, 'public.chat_complete_turn(uuid,uuid,text,text,text)', 'execute') AS ok`, [role])).ok, false, role);
    }
    console.log('chat long text: catalog, CHECKs, stored-text limit, long_text guard, replay and grants OK');
} finally {
    await c.query('ROLLBACK');
    await c.end();
}
