#!/usr/bin/env node
// Full replay, disposable local Postgres only. Real RPCs, including two
// concurrent video-agent debits for one account.
//
// F-04 (ADR-0307): the "one video-agent run in the making per account" rule is
// now enforced atomically inside public.ledger_debit_video_agent (an advisory
// lock around the in-flight check and the debit), not by the Worker's unlocked
// pre-debit read. Two concurrent Approve requests with distinct plan tickets
// can no longer both debit.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL || 'http://invalid');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/rebuild_check') {
    throw new Error('a disposable local rebuild_check DATABASE_URL is required');
}
const pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
const q = async (sql, args = []) => (await pool.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const AGENT = 'video-agent';

async function user(credits) {
    const auth = randomUUID();
    await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, `${auth}@example.invalid`]);
    const id = (await one('SELECT id FROM public.users WHERE auth_id=$1', [auth])).id;
    await one(`SELECT public.ledger_grant($1,$2,'grant:test') AS r`, [id, credits]);
    return { auth, id };
}
const balance = async (id) => Number((await one('SELECT balance FROM public.credit_balances WHERE user_id=$1', [id])).balance);
const agentJobs = async (id) => Number((await one(
    `SELECT count(*)::int n FROM public.jobs WHERE user_id=$1 AND model_id=$2`, [id, AGENT])).n);
const debitAgent = (client, id, key) => client.query(
    `SELECT public.ledger_debit_video_agent($1,$2,165,'debit:generation',$3,'{}'::jsonb) AS r`,
    [id, key, AGENT]).then((r) => r.rows[0].r);

try {
    // ── Sequential: the rule binds, a replay is not a conflict ───────────────
    const u1 = await user(400);
    const start1 = await balance(u1.id);
    let r = await debitAgent(pool, u1.id, 'k1');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.idempotent, false);
    assert.equal(await agentJobs(u1.id), 1, 'first run created one job');
    assert.equal(await balance(u1.id), start1 - 165, 'first run debited 165');

    r = await debitAgent(pool, u1.id, 'k2');
    assert.equal(r.ok, false, 'a second distinct-ticket run while one is in flight is refused');
    assert.equal(r.code, 'VIDEO_AGENT_IN_PROGRESS');
    assert.equal(await agentJobs(u1.id), 1, 'no second job');
    assert.equal(await balance(u1.id), start1 - 165, 'no second debit');

    r = await debitAgent(pool, u1.id, 'k1');
    assert.equal(r.ok, true, 'a replay of the same key is allowed');
    assert.equal(r.idempotent, true, 'and reports the original job, not a new debit');
    assert.equal(await agentJobs(u1.id), 1);
    assert.equal(await balance(u1.id), start1 - 165);

    // Once the in-flight run leaves DEBITED/SUBMITTED, the next run is allowed.
    await q(`UPDATE public.jobs SET state='STORED' WHERE user_id=$1 AND idempotency_key='k1'`, [u1.id]);
    r = await debitAgent(pool, u1.id, 'k3');
    assert.equal(r.ok, true, 'a run after the previous settled is allowed');
    assert.equal(await agentJobs(u1.id), 2);

    // ── Concurrent: two distinct tickets at once -> exactly one debits ───────
    const u2 = await user(400);
    const start2 = await balance(u2.id);
    const a = new pg.Client({ connectionString: url.toString() });
    const b = new pg.Client({ connectionString: url.toString() });
    await a.connect();
    await b.connect();
    const [ra, rb] = await Promise.all([debitAgent(a, u2.id, 'cA'), debitAgent(b, u2.id, 'cB')]);
    await a.end();
    await b.end();
    const oks = [ra, rb].filter((x) => x.ok && x.idempotent === false).length;
    const refused = [ra, rb].filter((x) => x.ok === false && x.code === 'VIDEO_AGENT_IN_PROGRESS').length;
    assert.equal(oks, 1, `exactly one concurrent debit, got ${JSON.stringify([ra, rb])}`);
    assert.equal(refused, 1, 'the other concurrent request was refused, not debited');
    assert.equal(await agentJobs(u2.id), 1, 'only one job for the concurrent account');
    assert.equal(await balance(u2.id), start2 - 165, 'only one debit for the concurrent account');

    console.log('video agent in-flight guard: ok');
} finally {
    await pool.end();
}
