#!/usr/bin/env node
// Real consumer/adapter/Postgres with a loopback fault server. No fal traffic.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import pg from 'pg';
import { submitJob } from '../packages/adapters/fal.js';
import { runFalDispatchQueue } from '../lib/falDispatchConsumer.js';

const database = new URL(process.env.DATABASE_URL || 'http://invalid');
if (!['localhost', '127.0.0.1'].includes(database.hostname) || database.pathname !== '/rebuild_check') {
    throw Error('disposable localhost rebuild_check required');
}
const client = new pg.Client({ connectionString: database.toString() });
const q = (sql, args = []) => client.query(sql, args);
const one = async (sql, args = []) => (await q(sql, args)).rows[0];
const model = `transport-${randomUUID().slice(0, 8)}`;
const logs = [], failures = [];
let mode, posts = 0, user, checks = 0;
const server = createServer(async (req, res) => {
    try {
        assert.equal(req.method, 'POST');
        assert.equal(req.headers.authorization, 'Key local-transport-placeholder');
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        assert.equal(JSON.parse(Buffer.concat(chunks)).prompt, 'private transport fixture');
        const url = new URL(req.url, 'http://localhost');
        assert.equal(url.pathname, '/fal-ai/flux-2-pro');
        assert.equal(new URL(url.searchParams.get('fal_webhook')).origin, 'https://veyrnox.test');
        posts++;
        // The server has read the POST. Discard its acknowledgement/body.
        if (mode === 'lost_reply' || mode === 'lost_reply_and_evidence_ack') req.socket.destroy();
        else if (mode === 'lost_body') {
            res.writeHead(200, { 'content-type': 'application/json', 'content-length': '1000' });
            res.write('{"request_id":"fixture');
            setImmediate(() => res.destroy());
        } else if (mode === 'stalled_reply') {
            // Client AbortController must end the request; no response is sent.
        } else throw Error('unknown fault mode');
    } catch (error) { failures.push(error); res.destroy(); }
});
const originalFetch = globalThis.fetch;
const originalLog = console.log, originalError = console.error;
const tally = () => one(`SELECT balance,free_balance,subscription_balance,
    (SELECT count(*)::int FROM public.jobs WHERE user_id=$1) jobs,
    (SELECT count(*)::int FROM public.ledger_entries WHERE user_id=$1) ledger,
    (SELECT count(*)::int FROM public.model_free_allowance_claims WHERE user_id=$1) claims
    FROM public.credit_balances WHERE user_id=$1`, [user]);
const env = { FAL_DISPATCH_SCHEMA_ENABLED: 'true', FAL_DISPATCH_QUEUE_CONSUMER_ENABLED: 'true',
    FAL_DISPATCH_QUEUE_NAME: 'local-transport', SUPABASE_URL: 'https://db.test',
    SUPABASE_SERVICE_ROLE_KEY: 'local-service-placeholder', FAL_KEY: 'local-transport-placeholder', PUBLIC_HOST: 'https://veyrnox.test' };
const message = id => ({ body: { version: 1, job_id: id }, actions: [],
    ack() { this.actions.push('ack'); }, retry() { this.actions.push('retry'); } });

try {
    await client.connect();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    globalThis.fetch = (input, options) => {
        const url = new URL(input);
        assert.equal(url.origin, 'https://queue.fal.run', 'unexpected outbound request blocked');
        return originalFetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, options);
    };
    console.log = (...values) => logs.push(values.join(' '));
    console.error = (...values) => logs.push(values.join(' '));
    await q('BEGIN');
    const auth = randomUUID();
    await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, `${auth}@example.invalid`]);
    user = (await one('SELECT id FROM public.users WHERE auth_id=$1', [auth])).id;
    await q(`INSERT INTO public.model_catalog(id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,active,free_allowance_per_day,free_allowance_daily_budget)
        VALUES($1,'Transport fixture','fal','fal-ai/flux-2-pro','text-to-image',2,0.03,'per_generation',true,2,2)`, [model]);
    await q('UPDATE public.fal_capacity_policy SET enabled=true,provider_account=$1,model_id=$2', ['local-transport-fixture', model]);
    await q('UPDATE public.fal_admission_control SET paused=false');
    for (const fault of ['lost_reply', 'lost_body', 'stalled_reply', 'lost_reply_and_evidence_ack']) {
        for (const free of [false, true]) {
            await q('SAVEPOINT scenario');
            try {
                mode = fault; posts = 0; logs.length = 0; let evidenceWrites = 0;
                const before = await tally();
                const admission = (await one('SELECT public.admit_fal_dispatch($1,$2,$3,$4,$4,$5,$6) r',
                    [user, randomUUID(), model, { prompt: 'private transport fixture' }, 'fal-ai/flux-2-pro', free])).r;
                assert.equal(admission.ok, true); assert.equal(admission.free, free);
                const admitted = await tally();
                assert.equal(admitted.balance, before.balance - (free ? 0 : 2));
                assert.equal(admitted.ledger, before.ledger + (free ? 0 : 1));
                assert.equal(admitted.claims, before.claims + (free ? 1 : 0));
                const rpc = async (name, args) => {
                    if (name === 'claim_fal_dispatch') return (await one('SELECT public.claim_fal_dispatch($1) r', [args.p_job_id])).r;
                    if (name === 'recover_fal_dispatch') return (await one('SELECT public.recover_fal_dispatch($1) r', [args.p_limit])).r;
                    if (name === 'record_fal_dispatch') {
                        const result = (await one('SELECT public.record_fal_dispatch($1,$2,$3,$4) r',
                            [args.p_job_id, args.p_attempt_token, args.p_outcome, args.p_provider_job_id])).r;
                        assert.equal(args.p_outcome, 'UNKNOWN'); assert.equal(args.p_provider_job_id, null);
                        if (evidenceWrites++ === 0 && fault === 'lost_reply_and_evidence_ack') throw Error('controlled evidence acknowledgement loss');
                        return result;
                    }
                    throw Error('unexpected RPC');
                };
                const deps = { rpc, submit: (job, cfg) => submitJob(job, { ...cfg, timeoutMs: 1000 }) };
                const first = message(admission.job_id), deferred = message(admission.job_id);
                const result = await runFalDispatchQueue({ queue: 'local-transport', messages: [first, deferred] }, env, deps);
                assert.equal(result.ok, false); assert.equal(result.submitted, 1);
                assert.deepEqual(first.actions, ['ack']); assert.deepEqual(deferred.actions, ['retry']);
                assert.equal(posts, 1); assert.equal(evidenceWrites, fault === 'lost_reply_and_evidence_ack' ? 2 : 1);
                assert.deepEqual(await tally(), admitted, 'no immediate refund or allowance return');
                const state = await one(`SELECT d.state,d.provider_job_id,j.state job_state,j.error_code,r.released_at
                    FROM public.fal_dispatch d JOIN public.jobs j ON j.id=d.job_id
                    JOIN public.fal_capacity_reservations r ON r.job_id=d.job_id WHERE d.job_id=$1`, [admission.job_id]);
                assert.deepEqual(state, { state: 'UNKNOWN', provider_job_id: null, job_state: 'DEBITED', error_code: 'provider_outcome_unknown', released_at: null });
                const duplicate = message(admission.job_id);
                assert.equal((await runFalDispatchQueue({ queue: 'local-transport', messages: [duplicate] }, env, deps)).submitted, 0);
                assert.deepEqual(duplicate.actions, ['ack']); assert.equal(posts, 1);
                assert.deepEqual(await tally(), admitted);
                assert.equal(logs.some(log => /private transport fixture|local-service-placeholder|local-transport-placeholder/.test(log)), false);
                assert.equal(failures.length, 0);
                checks++; originalLog(`ok ${fault}: ${free ? 'free' : 'paid'} retains effects/capacity and never resubmits`);
            } finally { await q('ROLLBACK TO SAVEPOINT scenario'); await q('RELEASE SAVEPOINT scenario'); }
        }
    }
    originalLog(`${checks} real HTTP transport/consumer/Postgres cases passed`);
} finally {
    globalThis.fetch = originalFetch; console.log = originalLog; console.error = originalError;
    await q('ROLLBACK').catch(() => {}); await client.end();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
}
