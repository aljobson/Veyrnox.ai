import test from 'node:test';
import assert from 'node:assert/strict';
import { runFalDispatchQueue } from '../lib/falDispatchConsumer.js';
import { publishFalDispatchWakeup } from '../lib/falDispatchWakeup.js';
import worker from '../workers/fal-dispatch-worker.js';

const ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = '22222222-2222-4222-8222-222222222222';
const env = { FAL_DISPATCH_SCHEMA_ENABLED: 'true', FAL_DISPATCH_QUEUE_CONSUMER_ENABLED: 'true',
    FAL_DISPATCH_QUEUE_NAME: 'test-queue', FAL_DISPATCH_QUEUE_ENABLED: 'false',
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    FAL_KEY: 'test-fal', PUBLIC_HOST: 'https://veyrnox.test' };
function message(body = { version: 1, job_id: ID }) {
    return { body, actions: [], ack() { this.actions.push('ack'); },
        retry(options) { assert.deepEqual(options, { delaySeconds: 30 }); this.actions.push('retry'); } };
}
const batch = (...messages) => ({ queue: 'test-queue', messages });
function controlled(t, { disposition, lostClaim = false, evidenceFailures = 0, persist = true,
    unknown = false, recoveryFailure = false } = {}) {
    let started = false, writes = 0, recovery = 0;
    const state = { calls: [], submits: 0, logs: [] };
    t.mock.method(console, 'error', value => state.logs.push(value));
    t.mock.method(console, 'log', () => {});
    state.rpc = async (name, args) => {
        state.calls.push({ name, args });
        if (name === 'recover_fal_dispatch') {
            if (recoveryFailure && recovery++ > 0) throw new Error('projection acknowledgement lost');
            return { ok: true };
        }
        if (name === 'claim_fal_dispatch') {
            if (disposition) return { disposition };
            if (started) return { disposition: 'INELIGIBLE' };
            started = true;
            if (lostClaim) throw new Error('claim acknowledgement lost');
            return { disposition: 'CLAIMED', job_id: ID, attempt_token: TOKEN,
                endpoint: 'fal-ai/flux-2-pro', payload: { prompt: 'private fixture prompt' } };
        }
        if (name === 'record_fal_dispatch') {
            if (writes++ < evidenceFailures) throw new Error('evidence acknowledgement lost');
            return { ok: persist };
        }
        throw new Error(name);
    };
    state.submit = async (job, cfg) => {
        state.submits++;
        assert.equal(cfg.timeoutMs, 15000);
        assert.equal(cfg.webhookBaseUrl, 'https://veyrnox.test/api/webhook/fal');
        assert.deepEqual(job.inputs, { prompt: 'private fixture prompt' });
        if (unknown) throw new Error('transport lost');
        return { outcome: 'accepted', providerJobId: 'accepted-handle' };
    };
    return state;
}

test('consumer drains with producer off and duplicate delivery makes one provider attempt', async t => {
    const d = controlled(t), first = message(), duplicate = message();
    assert.equal((await runFalDispatchQueue(batch(first, duplicate), env, d)).submitted, 1);
    assert.equal(d.submits, 1);
    assert.deepEqual(first.actions, ['ack']);
    assert.deepEqual(duplicate.actions, ['ack']);
});
test('lost claim acknowledgement retries only the reference; STARTED redelivery never submits', async t => {
    const d = controlled(t, { lostClaim: true }), first = message(), redelivery = message();
    await runFalDispatchQueue(batch(first), env, d);
    await runFalDispatchQueue(batch(redelivery), env, d);
    assert.deepEqual(first.actions, ['retry']);
    assert.deepEqual(redelivery.actions, ['ack']);
    assert.equal(d.submits, 0);
});
test('lost evidence acknowledgement repeats identical evidence rather than provider submission', async t => {
    const d = controlled(t, { evidenceFailures: 1 }), m = message();
    assert.equal((await runFalDispatchQueue(batch(m), env, d)).ok, true);
    const writes = d.calls.filter(c => c.name === 'record_fal_dispatch');
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0].args, writes[1].args);
    assert.equal(d.submits, 1);
    assert.deepEqual(m.actions, ['ack']);
});
for (const failure of [{ persist: false }, { unknown: true }, { recoveryFailure: true }]) {
    test(`post-claim failure ${JSON.stringify(failure)} acknowledges attempted work and stops new spend`, async t => {
        const d = controlled(t, failure), first = message(), next = message();
        assert.equal((await runFalDispatchQueue(batch(first, next), env, d)).ok, false);
        assert.deepEqual(first.actions, ['ack']);
        assert.deepEqual(next.actions, ['retry']);
        assert.equal(d.submits, 1);
        assert.ok(d.logs.length > 0);
        assert.equal(d.logs.some(v => /private fixture prompt|test-service|test-fal/.test(v)), false);
    });
}
test('BUSY retries, while missing, expired or ineligible references acknowledge without submission', async t => {
    for (const disposition of ['BUSY', 'MISSING', 'EXPIRED', 'INELIGIBLE']) {
        const d = controlled(t, { disposition }), m = message();
        await runFalDispatchQueue(batch(m), env, d);
        assert.deepEqual(m.actions, [disposition === 'BUSY' ? 'retry' : 'ack']);
        assert.equal(d.submits, 0);
    }
});
test('malformed references never reach the database or provider', async t => {
    const d = controlled(t);
    const messages = [null, [], { version: 2, job_id: ID }, { version: 1, job_id: 'bad' },
        { version: 1, job_id: ID, prompt: 'untrusted' }].map(message);
    await runFalDispatchQueue(batch(...messages), env, d);
    assert.equal(d.calls.length, 0);
    assert.equal(d.submits, 0);
    assert.ok(messages.every(m => m.actions.join() === 'ack'));
});
test('wrong queue, disabled consumer, and missing configuration retry without database calls', async t => {
    const d = controlled(t);
    for (const changed of [{ FAL_DISPATCH_QUEUE_NAME: 'different' },
        { FAL_DISPATCH_QUEUE_CONSUMER_ENABLED: 'false' }, { FAL_KEY: '' }]) {
        const m = message();
        await runFalDispatchQueue(batch(m), { ...env, ...changed }, d);
        assert.deepEqual(m.actions, ['retry']);
    }
    assert.equal(d.calls.length, 0);
});
test('consumer reserves the full claim, submit, evidence and recovery budget before claiming', async t => {
    const d = controlled(t), m = message(); let reads = 0;
    await runFalDispatchQueue(batch(m), env, { ...d, now: () => reads++ === 0 ? 0 : 135000 });
    assert.deepEqual(m.actions, ['retry']);
    assert.equal(d.submits, 0);
    assert.equal(d.calls.length, 0);
});
test('oversized batches cannot claim more than ten new provider attempts', async t => {
    const d = controlled(t), messages = Array.from({ length: 12 }, (_, i) => message({ version: 1,
        job_id: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111` }));
    const rpc = async (name, args) => name === 'claim_fal_dispatch'
        ? { disposition: 'CLAIMED', job_id: args.p_job_id, attempt_token: TOKEN,
            endpoint: 'fal-ai/flux-2-pro', payload: { prompt: 'private fixture prompt' } }
        : { ok: true };
    const result = await runFalDispatchQueue(batch(...messages), env, { ...d, rpc });
    assert.equal(result.submitted, 10);
    assert.equal(d.submits, 10);
    assert.ok(messages.slice(0, 10).every(m => m.actions.join() === 'ack'));
    assert.ok(messages.slice(10).every(m => m.actions.join() === 'retry'));
});
test('a malformed claimed response cannot submit an unverified identity or payload', async t => {
    const d = controlled(t), m = message();
    const rpc = async name => name === 'claim_fal_dispatch'
        ? { disposition: 'CLAIMED', job_id: TOKEN, attempt_token: TOKEN, endpoint: 'fal-ai/flux-2-pro', payload: {} }
        : { ok: true };
    await runFalDispatchQueue(batch(m), env, { ...d, rpc });
    assert.equal(d.submits, 0);
    assert.deepEqual(m.actions, ['retry']);
});
test('initial recovery cannot consume the time reserved for a new claim', async t => {
    const d = controlled(t), m = message(); let clock = 0;
    const rpc = async (name, args) => {
        const result = await d.rpc(name, args);
        if (name === 'recover_fal_dispatch') clock = 135000;
        return result;
    };
    await runFalDispatchQueue(batch(m), env, { ...d, rpc, now: () => clock });
    assert.deepEqual(m.actions, ['retry']);
    assert.equal(d.calls.some(c => c.name === 'claim_fal_dispatch'), false);
    assert.equal(d.submits, 0);
});
test('producer sends only the reference using the actual OpenNext request context and waitUntil receiver', async t => {
    const contextSymbol = Symbol.for('__cloudflare-context__'), previous = globalThis[contextSymbol];
    const promises = [], sent = [], ctx = { waitUntil(p) { assert.equal(this, ctx); promises.push(p); } };
    globalThis[contextSymbol] = { ctx, env: { FAL_DISPATCH_QUEUE: { send: async body => sent.push(body) } } };
    t.after(() => { if (previous === undefined) delete globalThis[contextSymbol]; else globalThis[contextSymbol] = previous; });
    publishFalDispatchWakeup(ID, { env: { FAL_DISPATCH_QUEUE_ENABLED: 'true' } });
    assert.equal(promises.length, 1);
    await promises[0];
    assert.deepEqual(sent, [{ version: 1, job_id: ID }]);
});
test('producer off avoids context access, and failed or timed-out sends resolve for cron recovery', async t => {
    publishFalDispatchWakeup(ID, { env, context: () => { throw new Error('must not read context'); } });
    t.mock.method(console, 'error', () => {});
    for (const send of [async () => { throw new Error('unavailable'); }, () => new Promise(() => {})]) {
        const promises = [];
        publishFalDispatchWakeup(ID, { env: { FAL_DISPATCH_QUEUE_ENABLED: 'true' }, timeoutMs: 5,
            context: () => ({ env: { FAL_DISPATCH_QUEUE: { send } }, ctx: { waitUntil: p => promises.push(p) } }) });
        await promises[0];
    }
});
test('dedicated consumer has no HTTP dispatch surface', async () => {
    assert.equal((await worker.fetch(new Request('https://consumer.test/'))).status, 404);
});
