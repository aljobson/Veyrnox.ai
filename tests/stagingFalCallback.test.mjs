import test from 'node:test';
import assert from 'node:assert/strict';
import { callbackPlan, callbackQueue } from '../workers/staging-fal-callback-worker.js';
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const user = '33333333-3333-4333-8333-333333333333';
function env() { return {
    SUPABASE_URL: 'https://yrqzwqywxfesmbvhzjgj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture',
    PUBLIC_HOST: 'https://veyrnox-ai-staging.al-jobson.workers.dev', FAL_DISPATCH_QUEUE_NAME: 'veyrnox-fal-dispatch-staging',
    FAL_CALLBACK_EXERCISE_ENABLED: 'true', FAL_CALLBACK_FIXTURE_USER: user, FAL_CALLBACK_FIXTURE_MODEL: 'deployed-fault-fixture',
    FAL_CALLBACK_EXPIRES_AT: new Date(Date.now() + 600_000).toISOString(),
    FAL_CALLBACK_SCENARIOS: JSON.stringify({ [a]: 'copy_failure', [b]: 'lost_stored_ack' }),
}; }
test('production, expired, incomplete and malformed plans fail closed', () => {
    const e = env(); assert.ok(callbackPlan(e));
    for (const patch of [{ SUPABASE_URL: 'https://production.invalid' }, { FAL_CALLBACK_EXERCISE_ENABLED: 'false' },
        { FAL_CALLBACK_EXPIRES_AT: new Date(0).toISOString() }, { FAL_CALLBACK_SCENARIOS: '{}' }]) {
        assert.equal(callbackPlan({ ...e, ...patch }), null);
    }
});
for (const id of [a, b]) {
    test(`controlled callback recovery completes once for ${id}`, async t => {
        t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
        const e = env(); let state = 'SUBMITTED', event = false, processed = false, stored = 0, puts = 0;
        e.FAL_CALLBACK_BUCKET = { put: async () => { puts++; } };
        let ack = 0, retry = 0;
        const message = { body: { version: 1, job_id: id }, ack() { ack++; }, retry() { retry++; } };
        const http = async (url, init = {}) => {
            if (url.pathname === '/rest/v1/jobs') {
                const allowed = !url.searchParams.has('state') || url.searchParams.get('state').includes(state);
                return Response.json(allowed ? [{ id, user_id: user, model_id: e.FAL_CALLBACK_FIXTURE_MODEL,
                    provider: 'fal', provider_job_id: `staging-callback-${id}`, state }] : []);
            }
            if (url.pathname === '/rest/v1/webhook_events') {
                if (init.method === 'POST') { const exists = event; event = true; return Response.json(exists ? [] : [{ id: 'event' }], { status: 201 }); }
                if (init.method === 'PATCH') { processed = true; return new Response(null, { status: 204 }); }
                return Response.json([{ processed_at: processed ? 'done' : null }]);
            }
            throw new Error('unexpected HTTP');
        };
        const rpc = async name => {
            if (name === 'job_succeeded') { if (state !== 'SUBMITTED') return { ok: false }; state = 'SUCCEEDED'; return { ok: true }; }
            if (name === 'job_stored') { stored++; state = 'STORED'; return { ok: true }; }
            throw new Error('unexpected RPC');
        };
        await callbackQueue({ messages: [message] }, e, { http, rpc });
        assert.equal(ack, 1); assert.equal(retry, 0); assert.equal(stored, 1); assert.equal(puts, 1); assert.equal(processed, true);
        await callbackQueue({ messages: [message] }, e, { http, rpc });
        assert.equal(ack, 2); assert.equal(stored, 1); assert.equal(puts, 1);
    });
}
test('unlisted references do no I/O', async () => {
    let retries = 0;
    await callbackQueue({ messages: [{ body: { version: 1, job_id: user }, retry() { retries++; } }] }, env(), {
        http: async () => { throw new Error('must not run'); }, rpc: async () => { throw new Error('must not run'); },
    });
    assert.equal(retries, 1);
});

test('a fixture ownership mismatch retries before any handler mutation', async t => {
    t.mock.method(console, 'log', () => {});
    let retries = 0, mutations = 0;
    const e = { ...env(), FAL_CALLBACK_BUCKET: { put: async () => { mutations++; } } };
    await callbackQueue({ messages: [{ body: { version: 1, job_id: a }, retry() { retries++; } }] }, e, {
        http: async () => Response.json([{ id: a, user_id: b, model_id: e.FAL_CALLBACK_FIXTURE_MODEL,
            provider: 'fal', provider_job_id: `staging-callback-${a}`, state: 'SUBMITTED' }]),
        rpc: async () => { mutations++; },
    });
    assert.equal(retries, 1); assert.equal(mutations, 0);
});
