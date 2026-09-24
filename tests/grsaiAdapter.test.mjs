import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, submitTask, fetchTask, ENDPOINT } from '../packages/adapters/grsai.js';
import { capabilityFor, declaredInputs } from '../lib/modelCapabilities.js';

const cfg = { apiKey: 'test-key' };
const job = { provider_endpoint: ENDPOINT, inputs: { prompt: 'A blue teapot' } };
async function fakeFetch(fn, run) {
    const real = globalThis.fetch;
    globalThis.fetch = fn;
    try { await run(); } finally { globalThis.fetch = real; }
}
const response = (data) => Response.json({ code: 0, data });

test('GrsAI pins the verified 2K, single image polling request', () => {
    assert.deepEqual(buildRequest(ENDPOINT, job.inputs), { ok: true, body: {
        prompt: 'A blue teapot', aspectRatio: '1:1', model: 'nano-banana-pro',
        imageSize: '2K', webHook: '-1', shutProgress: true,
    } });
    const record = capabilityFor(ENDPOINT);
    assert.equal(record.provider, 'grsai');
    assert.deepEqual(declaredInputs(record, { ...job.inputs, imageSize: '4K', num_images: 10, image_url: 'https://evil.test/a' }), job.inputs);
    for (const inputs of [{ prompt: '' }, { prompt: 'x'.repeat(2001) }, { prompt: 'p', imageSize: '4K' },
        { prompt: 'p', duration_seconds: 10 }, { prompt: 'p', aspect_ratio: '2:1' }]) {
        assert.equal(buildRequest(ENDPOINT, inputs).ok, false);
    }
    assert.equal(buildRequest('https://evil.test', job.inputs).ok, false);
});

test('submit uses only the fixed host and never follows redirects', async () => {
    await fakeFetch(async (url, init) => {
        assert.equal(url, 'https://grsaiapi.com/v1/draw/nano-banana');
        assert.equal(init.method, 'POST');
        assert.equal(init.redirect, 'manual');
        assert.equal(init.headers.Authorization, 'Bearer test-key');
        assert.equal(JSON.parse(init.body).imageSize, '2K');
        return response({ id: '15-test-task' });
    }, async () => assert.deepEqual(await submitTask(job, cfg), { ok: true, providerJobId: '15-test-task' }));
});

test('read verifies task identity and returns only authoritative, typed outcomes', async () => {
    for (const [data, expected] of [
        [{ id: 't1', status: 'running' }, { ok: true, state: 'pending' }],
        [{ id: 't1', status: 'succeeded', results: [{ url: 'https://file6.aitohumanize.com/a.png' }] },
            { ok: true, state: 'success', outputUrl: 'https://file6.aitohumanize.com/a.png' }],
        [{ id: 't1', status: 'failed', failure_reason: 'input_moderation', error: 'sensitive vendor detail' },
            { ok: true, state: 'fail', errorCode: 'provider_moderation' }],
        [{ id: 't1', status: 'failed', error: 'sensitive vendor detail' }, { ok: true, state: 'fail', errorCode: 'provider_error' }],
        [{ id: 't1', status: 'succeeded', results: [] }, { ok: true, state: 'fail', errorCode: 'provider_output_missing' }],
        [{ id: 'other-task', status: 'succeeded' }, { ok: false, error: 'provider_response_invalid' }],
        [{ id: 't1', status: 'mystery' }, { ok: false, error: 'provider_response_invalid' }],
    ]) await fakeFetch(async (url, init) => {
        assert.equal(url, 'https://grsaiapi.com/v1/draw/result');
        assert.deepEqual(JSON.parse(init.body), { id: 't1' });
        return response(data);
    }, async () => assert.deepEqual(await fetchTask('t1', cfg), expected));
});

test('failed/ambiguous submits are not retried and never expose vendor payloads', async () => {
    for (const make of [() => Response.json({ msg: 'secret payload' }, { status: 401 }),
        () => new Response(null, { status: 302, headers: { location: 'https://evil.test' } }),
        () => Response.json({ code: -1, msg: 'secret payload' }),
        () => new Response('x'.repeat(65537)), () => response({ id: '../bad' }),
        () => { throw new Error('secret payload'); }]) {
        let calls = 0;
        await fakeFetch(async () => { calls += 1; return make(); }, async () => {
            const r = await submitTask(job, cfg);
            assert.equal(r.ok, false);
            assert.doesNotMatch(JSON.stringify(r), /secret payload/);
            assert.equal(calls, 1);
        });
    }
});

test('timeout, missing key and invalid task IDs fail safely', async () => {
    await fakeFetch(async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    }), async () => assert.equal((await submitTask(job, { ...cfg, timeoutMs: 5 })).errorCode, 'provider_timeout'));
    await fakeFetch(async () => { throw new Error('must not fetch'); }, async () => {
        assert.equal((await submitTask(job, {})).error, 'provider_not_configured');
        assert.equal((await fetchTask('id&evil', cfg)).error, 'task_id_invalid');
    });
});
