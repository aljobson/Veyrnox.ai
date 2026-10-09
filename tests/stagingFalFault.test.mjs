import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { exerciseQueue, faultPlan } from '../workers/staging-fal-fault-worker.js';

const lost = '11111111-1111-4111-8111-111111111111';
const accepted = '22222222-2222-4222-8222-222222222222';
const token = '33333333-3333-4333-8333-333333333333';
const clock = 1791579000000;
const env = { SUPABASE_URL: 'https://yrqzwqywxfesmbvhzjgj.supabase.co',
    PUBLIC_HOST: 'https://veyrnox-ai-staging.al-jobson.workers.dev',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', FAL_DISPATCH_SCHEMA_ENABLED: 'true',
    FAL_DISPATCH_QUEUE_CONSUMER_ENABLED: 'true', FAL_DISPATCH_QUEUE_NAME: 'veyrnox-fal-dispatch-staging',
    FAL_FAULT_EXERCISE_ENABLED: 'true', FAL_FAULT_EXPIRES_AT: new Date(clock + 600000).toISOString(),
    FAL_FAULT_JOB_SCENARIOS: JSON.stringify({ [lost]: 'lost_claim_ack', [accepted]: 'lost_evidence_ack' }) };
function message(id) {
    return { body: { version: 1, job_id: id }, actions: [], ack() { this.actions.push('ack'); },
        retry() { this.actions.push('retry'); } };
}
test('production, expired, oversized and incomplete plans fail closed', () => {
    assert.ok(faultPlan(env, clock));
    for (const patch of [{ SUPABASE_URL: 'https://xdxdzmsztyzbnzeforxx.supabase.co' },
        { PUBLIC_HOST: 'https://veyrnox.ai' }, { FAL_FAULT_EXERCISE_ENABLED: 'false' },
        { FAL_FAULT_EXPIRES_AT: new Date(clock).toISOString() },
        { FAL_FAULT_EXPIRES_AT: new Date(clock + 900001).toISOString() },
        { FAL_FAULT_JOB_SCENARIOS: '{}' }, { FAL_FAULT_JOB_SCENARIOS: JSON.stringify({ [lost]: 'lost_claim_ack', [accepted]: 'lost_claim_ack' }) }]) {
        assert.equal(faultPlan({ ...env, ...patch }, clock), null);
    }
});
test('unlisted messages never reach database or adapter; there is no HTTP dispatch', async () => {
    const m = message(token);
    await exerciseQueue({ queue: env.FAL_DISPATCH_QUEUE_NAME, messages: [m] }, env,
        { now: () => clock, rpc: () => { throw Error('must not call'); } });
    assert.deepEqual(m.actions, ['retry']);
    assert.equal((await worker.fetch()).status, 404);
});
test('deployed injection commits claim before losing acknowledgement; redelivery cannot submit', async t => {
    t.mock.method(console, 'log', () => {});
    let started = false;
    const rpc = async name => {
        if (name === 'recover_fal_dispatch') return { ok: true };
        assert.equal(name, 'claim_fal_dispatch');
        if (started) return { disposition: 'INELIGIBLE' };
        started = true;
        return { disposition: 'CLAIMED', job_id: lost, attempt_token: token,
            endpoint: 'staging-fault/controlled', payload: { prompt: 'fixture' } };
    };
    const first = message(lost), second = message(lost);
    for (const m of [first, second]) await exerciseQueue({ queue: env.FAL_DISPATCH_QUEUE_NAME, messages: [m] }, env, { rpc, now: () => clock });
    assert.deepEqual(first.actions, ['retry']);
    assert.deepEqual(second.actions, ['ack']);
});
test('evidence acknowledgement loss repeats identical writes; duplicate makes no adapter call', async t => {
    const logs = [];
    t.mock.method(console, 'log', x => logs.push(JSON.parse(x)));
    let started = false;
    const writes = [];
    const rpc = async (name, args) => {
        if (name === 'recover_fal_dispatch') return { ok: true };
        if (name === 'record_fal_dispatch') { writes.push(args); return { ok: true, idempotent: writes.length > 1 }; }
        if (started) return { disposition: 'INELIGIBLE' };
        started = true;
        return { disposition: 'CLAIMED', job_id: accepted, attempt_token: token,
            endpoint: 'staging-fault/controlled', payload: { prompt: 'fixture' } };
    };
    for (const m of [message(accepted), message(accepted)]) {
        await exerciseQueue({ queue: env.FAL_DISPATCH_QUEUE_NAME, messages: [m] }, env, { rpc, now: () => clock });
        assert.deepEqual(m.actions, ['ack']);
    }
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0], writes[1]);
    assert.equal(logs.filter(x => x.event === 'staging.fal_fault_result').reduce((n, x) => n + x.adapter_calls, 0), 1);
});
