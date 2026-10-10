import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { transportPlan, exerciseTransport } from '../workers/staging-fal-transport-worker.js';
import { fixtureFetch } from '../workers/staging-fal-transport-fixture.js';

const reply = '11111111-1111-4111-8111-111111111111', body = '22222222-2222-4222-8222-222222222222';
const token = '33333333-3333-4333-8333-333333333333';
const environment = () => ({ SUPABASE_URL: 'https://yrqzwqywxfesmbvhzjgj.supabase.co',
    PUBLIC_HOST: 'https://veyrnox-ai-staging.al-jobson.workers.dev', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
    FAL_DISPATCH_QUEUE_NAME: 'veyrnox-fal-dispatch-staging', FAL_DISPATCH_SCHEMA_ENABLED: 'true', FAL_DISPATCH_QUEUE_CONSUMER_ENABLED: 'true',
    FAL_TRANSPORT_EXERCISE_ENABLED: 'true', FAL_TRANSPORT_EXPIRES_AT: new Date(Date.now() + 600_000).toISOString(),
    FAL_TRANSPORT_JOB_SCENARIOS: JSON.stringify({ [reply]: 'lost_reply', [body]: 'lost_body' }) });
const message = jobId => ({ body: { version: 1, job_id: jobId }, actions: [],
    ack() { this.actions.push('ack'); }, retry() { this.actions.push('retry'); } });

test('transport exercise rejects production, expired, unbounded and incomplete plans', () => {
    const env = environment(); assert.ok(transportPlan(env));
    for (const patch of [{ SUPABASE_URL: 'https://xdxdzmsztyzbnzeforxx.supabase.co' }, { PUBLIC_HOST: 'https://veyrnox.ai' },
        { FAL_TRANSPORT_EXERCISE_ENABLED: 'false' }, { FAL_TRANSPORT_EXPIRES_AT: new Date(0).toISOString() },
        { FAL_TRANSPORT_EXPIRES_AT: new Date(Date.now() + 1_000_000).toISOString() }, { FAL_TRANSPORT_JOB_SCENARIOS: '{}' },
        { FAL_TRANSPORT_JOB_SCENARIOS: JSON.stringify({ [reply]: 'lost_reply', [body]: 'lost_reply' }) }]) {
        assert.equal(transportPlan({ ...env, ...patch }), null);
    }
});
test('unlisted references and missing service binding do no I/O; public dispatch is absent', async () => {
    const env = environment();
    for (const id of [reply, token]) {
        const m = message(id);
        await exerciseTransport({ queue: env.FAL_DISPATCH_QUEUE_NAME, messages: [m] }, env,
            { rpc: () => { throw Error('unexpected RPC'); } });
        assert.deepEqual(m.actions, ['retry']);
    }
    assert.equal((await worker.fetch()).status, 404);
    assert.equal((await fixtureFetch(new Request('https://queue.fal.run/staging-transport/controlled'), env)).status, 404);
});
for (const id of [reply, body]) {
    test(`real adapter classifies controlled transport loss for ${id}; duplicate never posts`, async t => {
        const env = environment(), logs = [], writes = []; let started = false, received = 0;
        t.mock.method(console, 'log', value => logs.push(value)); t.mock.method(console, 'error', () => {});
        t.mock.method(globalThis, 'fetch', () => { throw Error('external network forbidden'); });
        env.FAL_TRANSPORT_FIXTURE = { fetch: async (url, init) => {
            received++; return fixtureFetch(new Request(url, init), env);
        } };
        const rpc = async (name, args) => {
            if (name === 'recover_fal_dispatch') return { ok: true };
            if (name === 'record_fal_dispatch') { writes.push(args); return { ok: true }; }
            assert.equal(name, 'claim_fal_dispatch');
            if (started) return { disposition: 'INELIGIBLE' };
            started = true;
            return { disposition: 'CLAIMED', job_id: id, attempt_token: token,
                endpoint: 'staging-transport/controlled', payload: { prompt: 'controlled staging transport fixture' } };
        };
        for (const m of [message(id), message(id)]) {
            await exerciseTransport({ queue: env.FAL_DISPATCH_QUEUE_NAME, messages: [m] }, env, { rpc });
            assert.deepEqual(m.actions, ['ack']);
        }
        assert.equal(received, 1); assert.equal(writes.length, id === reply ? 2 : 1);
        assert.ok(writes.every(write => write.p_outcome === 'UNKNOWN' && write.p_provider_job_id === null));
        if (id === reply) assert.deepEqual(writes[0], writes[1]);
        assert.equal(logs.filter(log => JSON.parse(log).event === 'staging.fal_transport_received').length, 1);
        assert.equal(logs.some(log => /fixture-service|controlled-no-provider-key|controlled staging transport fixture/.test(log)), false);
    });
}
