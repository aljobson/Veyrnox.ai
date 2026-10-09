import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    FAL_KEY: 'test-fal', PUBLIC_HOST: 'https://veyrnox.test',
});
const generations = await import('../app/api/v1/generations/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const model = { id: 'flux-2-pro', provider: 'fal', provider_endpoint: 'fal-ai/flux-2-pro', modality: 'text-to-image', credits_5s: 4, active: true, gated_flag: false };

function network(t, { answer, submitted = { ok: true }, annotation = { ok: true }, free = false, durable } = {}) {
    const calls = [];
    let exists = false;
    t.mock.method(console, 'error', () => {});
    t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
        const u = new URL(String(url));
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        calls.push({ url: u.href, body });
        if (u.pathname.includes('/rpc/')) {
            const name = u.pathname.split('/rpc/')[1];
            if (name === 'admit_fal_dispatch') {
                if (durable instanceof Error) throw durable;
                if (durable?.ok === false) return Response.json(durable);
                const idempotent = exists; exists = true;
                return Response.json({ ok: true, job_id: JOB, idempotent, state: 'DEBITED', balance_after: 100, free });
            }
            if (name === 'ledger_debit' || name === 'submit_free_job') {
                const idempotent = exists; exists = true;
                return Response.json({ ok: true, job_id: JOB, idempotent, balance_after: 100, ...(free ? { taken: true } : {}) });
            }
            if (name === 'job_submitted') {
                if (submitted instanceof Error) throw submitted;
                return Response.json(submitted);
            }
            if (name === 'job_submit_rejected') {
                if (annotation instanceof Error) throw annotation;
                return Response.json(annotation);
            }
            return Response.json({ ok: true });
        }
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([{ ...model, ...(free ? { free_allowance_per_day: 3 } : {}) }]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
        if (u.hostname === 'queue.fal.run') return answer();
        throw new Error(`Unexpected test request: ${u.hostname}${u.pathname}`);
    });
    return calls;
}
function post() {
    return generations.POST(new Request('https://veyrnox.test/api/v1/generations', {
        method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ model_id: model.id, idempotency_key: 'fal-outcome-test', inputs: { prompt: 'A teapot' } }),
    }));
}
const rpc = (calls, name) => calls.filter(c => c.url.includes(`/rpc/${name}`));
const submits = calls => calls.filter(c => c.url.startsWith('https://queue.fal.run/'));
function flag(t, value = 'true') {
    const previous = process.env.FAL_SUBMIT_OUTCOME_ENABLED;
    process.env.FAL_SUBMIT_OUTCOME_ENABLED = value;
    t.after(() => {
        if (previous === undefined) delete process.env.FAL_SUBMIT_OUTCOME_ENABLED;
        else process.env.FAL_SUBMIT_OUTCOME_ENABLED = previous;
    });
}

for (const [label, answer] of [
    ['lost connection', () => { throw new Error('reset'); }],
    ['HTTP timeout', () => new Response('', { status: 408 })],
    ['server error', () => new Response('', { status: 502 })],
    ['malformed acceptance', () => new Response('not json')],
    ['missing handle', () => Response.json({})],
]) {
    test(`${label}: pending response, no immediate refund, replay never resubmits`, async (t) => {
        flag(t);
        const calls = network(t, { answer });
        const response = await post();
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), { error: 'outcome_unknown', job_id: JOB });
        assert.equal(rpc(calls, 'ledger_refund').length, 0);
        assert.equal(rpc(calls, 'job_submitted').length, 0);
        assert.deepEqual(rpc(calls, 'job_submit_rejected')[0].body, { p_job_id: JOB, p_error_code: 'provider_outcome_unknown' });
        const replay = await post();
        assert.equal(replay.status, 200);
        assert.equal((await replay.json()).job_id, JOB);
        assert.equal(submits(calls).length, 1);
        assert.equal(rpc(calls, 'job_submit_rejected').length, 1, 'replay must not extend the timeout');
    });
}

for (const submitted of [{ ok: false, code: 'JOB_NOT_FOUND_OR_BAD_STATE' }, new Error('ack lost')]) {
    test(`accepted request with ${submitted instanceof Error ? 'lost' : 'refused'} handle persistence stays uncertain`, async (t) => {
        flag(t);
        const calls = network(t, { answer: () => Response.json({ request_id: 'provider-task-1' }), submitted });
        const response = await post();
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: 'outcome_unknown', job_id: JOB });
        assert.equal(rpc(calls, 'ledger_refund').length, 0);
        await post();
        assert.equal(submits(calls).length, 1);
    });
}

test('explicit refusal still records the error and refunds once', async (t) => {
    flag(t);
    const calls = network(t, { answer: () => new Response('invalid input', { status: 422 }) });
    assert.equal((await post()).status, 502);
    assert.equal(rpc(calls, 'ledger_refund').length, 1);
    assert.equal(rpc(calls, 'job_submit_rejected')[0].body.p_error_code, 'provider_submit_failed');
});

test('flag off retains the legacy transport failure and refund', async (t) => {
    flag(t, 'false');
    const calls = network(t, { answer: () => { throw new Error('reset'); } });
    const response = await post();
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'provider_submit_failed' });
    assert.equal(rpc(calls, 'ledger_refund').length, 1);
});

test('annotation outage still reports uncertainty without moving credits', async (t) => {
    flag(t);
    const calls = network(t, { answer: () => { throw new Error('reset'); }, annotation: new Error('db unavailable') });
    assert.equal((await post()).status, 503);
    assert.equal(rpc(calls, 'ledger_refund').length, 0);
});

test('successful acceptance persists the handle and returns normal progress', async (t) => {
    flag(t);
    const calls = network(t, { answer: () => Response.json({ request_id: 'provider-task-1' }) });
    const response = await post();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, 'SUBMITTED');
    assert.deepEqual(rpc(calls, 'job_submitted')[0].body, { p_job_id: JOB, p_provider: 'fal', p_provider_job_id: 'provider-task-1' });
    assert.equal(rpc(calls, 'job_submit_rejected').length, 0);
});

test('uncertain free allowance submission keeps its existing job without falling through to paid debit', async (t) => {
    flag(t);
    const previous = process.env.FREE_ALLOWANCE_ENABLED;
    process.env.FREE_ALLOWANCE_ENABLED = 'true';
    t.after(() => { if (previous === undefined) delete process.env.FREE_ALLOWANCE_ENABLED; else process.env.FREE_ALLOWANCE_ENABLED = previous; });
    const calls = network(t, { free: true, answer: () => { throw new Error('reset'); } });
    const response = await post();
    assert.equal(response.status, 503);
    assert.equal(rpc(calls, 'submit_free_job').length, 1);
    assert.equal(rpc(calls, 'ledger_debit').length, 0);
    assert.equal(rpc(calls, 'ledger_refund').length, 0);
    await post();
    assert.equal(submits(calls).length, 1);
});

function durableFlags(t) {
    for (const name of ['FAL_DISPATCH_SCHEMA_ENABLED','FAL_DURABLE_DISPATCH_ENABLED']) {
        const previous=process.env[name]; process.env[name]='true';
        t.after(()=>{ if(previous===undefined) delete process.env[name]; else process.env[name]=previous; });
    }
}
function queueContext(t, send) {
    const name = 'FAL_DISPATCH_QUEUE_ENABLED', previous = process.env[name];
    const symbol = Symbol.for('__cloudflare-context__'), oldContext = globalThis[symbol], pending = [];
    process.env[name] = 'true';
    globalThis[symbol] = { env: { FAL_DISPATCH_QUEUE: { send } }, ctx: { waitUntil: p => pending.push(p) } };
    t.after(() => {
        if (previous === undefined) delete process.env[name]; else process.env[name] = previous;
        if (oldContext === undefined) delete globalThis[symbol]; else globalThis[symbol] = oldContext;
    });
    return pending;
}
test('confirmed durable admission and replay publish references without changing their HTTP contract', async t => {
    durableFlags(t);
    const sent = [], pending = queueContext(t, async body => sent.push(body));
    const calls = network(t, { durable: { ok: true } });
    assert.equal((await post()).status, 202);
    assert.equal((await post()).status, 200);
    await Promise.all(pending);
    assert.deepEqual(sent, [{ version: 1, job_id: JOB }, { version: 1, job_id: JOB }]);
    assert.equal(submits(calls).length, 0);
    assert.equal(rpc(calls, 'ledger_debit').length, 0);
});
test('queue failure preserves committed admission; lost admission acknowledgement publishes nothing', async t => {
    durableFlags(t);
    let sends = 0;
    const pending = queueContext(t, async () => { sends++; throw new Error('queue unavailable'); });
    network(t, { durable: { ok: true } });
    const accepted = await post();
    assert.equal(accepted.status, 202);
    assert.equal((await accepted.json()).job_id, JOB);
    await Promise.all(pending);
    assert.equal(sends, 1);
    const calls = network(t, { durable: new Error('admission acknowledgement lost') });
    assert.equal((await post()).status, 503);
    assert.equal(sends, 1);
    assert.equal(pending.length, 1);
    assert.equal(rpc(calls, 'ledger_debit').length, 0);
    assert.equal(submits(calls).length, 0);
});
test('durable fal admission queues atomically and replay never submits from the route', async (t) => {
    durableFlags(t);
    const calls=network(t,{durable:{ok:true}});
    const response=await post(); assert.equal(response.status,202);
    assert.equal((await response.json()).state,'DEBITED');
    assert.equal((await post()).status,200);
    assert.equal(submits(calls).length,0);
    assert.equal(rpc(calls,'ledger_debit').length,0);
    const admission=rpc(calls,'admit_fal_dispatch')[0].body;
    assert.equal(admission.p_payload.prompt,'A teapot');
    assert.equal(admission.p_endpoint,'fal-ai/flux-2-pro');
});
test('lost durable admission acknowledgement never falls back to another charge or submit', async (t) => {
    durableFlags(t);
    const calls=network(t,{durable:new Error('ack lost')});
    const response=await post(); assert.equal(response.status,503);
    assert.equal((await response.json()).error,'dispatch_acceptance_unknown');
    assert.equal(rpc(calls,'ledger_debit').length,0); assert.equal(submits(calls).length,0);
});
test('durable payload conflict returns 409 without provider or refund calls', async (t) => {
    durableFlags(t);
    const calls=network(t,{durable:{ok:false,code:'IDEMPOTENCY_CONFLICT'}});
    assert.equal((await post()).status,409);
    assert.equal(submits(calls).length,0); assert.equal(rpc(calls,'ledger_refund').length,0);
});
