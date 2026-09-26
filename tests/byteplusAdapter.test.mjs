import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, submitTask, fetchTask, interpretTask, isEndpoint, BYTEPLUS_API_BASE } from '../packages/adapters/byteplus.js';
import { capabilityFor, declaredInputs } from '../lib/modelCapabilities.js';

const cfg = { apiKey: 'test-key' };
const EP = 'byteplus:seedance-2.0-fast';
const job = { provider_endpoint: EP, inputs: { prompt: 'A paper boat on a rain gutter', aspect_ratio: '16:9', duration_seconds: 5 } };
async function fakeFetch(fn, run) {
    const real = globalThis.fetch;
    globalThis.fetch = fn;
    try { await run(); } finally { globalThis.fetch = real; }
}

test('every BytePlus record pins the 5s 720p unit and names its ModelArk model', () => {
    const models = {
        'byteplus:seedance-2.0-fast': 'dreamina-seedance-2-0-fast-260128',
        'byteplus:seedance-2.0-mini': 'dreamina-seedance-2-0-mini-260615',
        'byteplus:seedance-2.0': 'dreamina-seedance-2-0-260128',
        'byteplus:seedance-2.5': 'dreamina-seedance-2-5-260628',
        'byteplus:seedance-1.0-pro-fast': 'seedance-1-0-pro-fast-251015',
    };
    for (const [ep, model] of Object.entries(models)) {
        assert.ok(isEndpoint(ep), ep);
        const built = buildRequest(ep, job.inputs);
        assert.deepEqual(built, { ok: true, body: {
            model, resolution: '720p', watermark: false, ratio: '16:9', duration: 5,
            content: [{ type: 'text', text: 'A paper boat on a rain gutter' }],
        } }, ep);
        assert.equal(capabilityFor(ep).provider, 'byteplus');
    }
});

test('a first frame becomes an https image_url content item and nothing else reaches the body', () => {
    const inputs = { ...job.inputs, image_url: 'https://r2.example/signed/a.png' };
    const built = buildRequest(EP, inputs);
    assert.equal(built.ok, true);
    assert.deepEqual(built.body.content, [
        { type: 'text', text: 'A paper boat on a rain gutter' },
        { type: 'image_url', image_url: { url: 'https://r2.example/signed/a.png' }, role: 'first_frame' },
    ]);
    assert.equal(buildRequest(EP, { ...job.inputs, image_url: 'http://r2.example/a.png' }).ok, false);
    assert.equal(buildRequest(EP, { ...job.inputs, image_url: 'not a url' }).ok, false);
    const record = capabilityFor(EP);
    // The gateway drops undeclared keys; a resolution, service tier, audio
    // flag or callback from the client can never change what we pay.
    assert.deepEqual(
        declaredInputs(record, { ...job.inputs, resolution: '4k', service_tier: 'flex', generate_audio: false, callback_url: 'https://evil.test', seed: 3 }),
        job.inputs,
    );
    for (const bad of [{ prompt: '' }, { prompt: 'x'.repeat(2001) }, { prompt: 'p', duration_seconds: 10 },
        { prompt: 'p', aspect_ratio: '21:9' }, { prompt: 'p', resolution: '1080p' }]) {
        assert.equal(buildRequest(EP, bad).ok, false, JSON.stringify(bad));
    }
    assert.equal(buildRequest('byteplus:not-a-row', job.inputs).error, 'provider_unsupported');
    assert.equal(buildRequest('fal-ai/veo3.1', job.inputs).error, 'provider_unsupported');
    assert.equal(buildRequest('byteplus:../x', job.inputs).error, 'provider_unsupported');
});

test('submit posts to the fixed Singapore host with the key and never follows redirects', async () => {
    await fakeFetch(async (url, init) => {
        assert.equal(url, `${BYTEPLUS_API_BASE}/api/v3/contents/generations/tasks`);
        assert.equal(init.method, 'POST');
        assert.equal(init.redirect, 'manual');
        assert.equal(init.headers.Authorization, 'Bearer test-key');
        const body = JSON.parse(init.body);
        assert.equal(body.model, 'dreamina-seedance-2-0-fast-260128');
        assert.equal(body.resolution, '720p');
        assert.equal(body.callback_url, undefined);
        return Response.json({ id: 'cgt-20260926-abc123' });
    }, async () => assert.deepEqual(await submitTask(job, cfg), { ok: true, providerJobId: 'cgt-20260926-abc123' }));
});

test('task reads verify identity and return only typed outcomes, with billed tokens on success', () => {
    const url = 'https://ark-content.example/video.mp4';
    for (const [data, expected] of [
        [{ id: 't1', status: 'queued' }, { ok: true, state: 'pending' }],
        [{ id: 't1', status: 'running' }, { ok: true, state: 'pending' }],
        [{ id: 't1', status: 'succeeded', content: { video_url: url }, usage: { completion_tokens: 108000 } },
            { ok: true, state: 'success', outputUrl: url, completionTokens: 108000 }],
        [{ id: 't1', status: 'succeeded', content: { video_url: url } },
            { ok: true, state: 'success', outputUrl: url, completionTokens: null }],
        [{ id: 't1', status: 'succeeded', content: {} }, { ok: true, state: 'fail', errorCode: 'provider_output_missing' }],
        [{ id: 't1', status: 'failed', error: { code: 'OutputVideoSensitiveContentDetected', message: 'vendor detail' } },
            { ok: true, state: 'fail', errorCode: 'provider_moderation' }],
        [{ id: 't1', status: 'failed', error: { code: 'InternalServiceError', message: 'vendor detail' } },
            { ok: true, state: 'fail', errorCode: 'provider_error' }],
        [{ id: 't1', status: 'cancelled' }, { ok: true, state: 'fail', errorCode: 'provider_cancelled' }],
        [{ id: 'other', status: 'succeeded', content: { video_url: url } }, { ok: false, error: 'provider_response_invalid' }],
        [{ id: 't1', status: 'mystery' }, { ok: false, error: 'provider_response_invalid' }],
    ]) assert.deepEqual(interpretTask('t1', data), expected, JSON.stringify(data));
});

test('fetchTask reads the task by id with the key and rejects bad ids before any network', async () => {
    await fakeFetch(async (url, init) => {
        assert.equal(url, `${BYTEPLUS_API_BASE}/api/v3/contents/generations/tasks/cgt-1`);
        assert.equal(init.method, 'GET');
        assert.equal(init.headers.Authorization, 'Bearer test-key');
        return Response.json({ id: 'cgt-1', status: 'running' });
    }, async () => assert.deepEqual(await fetchTask('cgt-1', cfg), { ok: true, state: 'pending' }));
    await fakeFetch(async () => { throw new Error('must not fetch'); }, async () => {
        assert.equal((await fetchTask('../etc', cfg)).error, 'task_id_invalid');
        assert.equal((await fetchTask('cgt-1', {})).error, 'provider_not_configured');
    });
});

test('failed or ambiguous submits are never retried and never expose vendor payloads', async () => {
    for (const [make, code] of [
        [() => Response.json({ error: { message: 'secret payload' } }, { status: 401 }), 'provider_auth_failed'],
        [() => Response.json({ error: { message: 'secret payload' } }, { status: 429 }), 'provider_rate_limited'],
        [() => Response.json({ error: { message: 'secret payload' } }, { status: 400 }), 'provider_request_rejected'],
        [() => Response.json({ error: { message: 'secret payload' } }, { status: 503 }), 'provider_unavailable'],
        [() => new Response(null, { status: 302, headers: { location: 'https://evil.test' } }), 'provider_unavailable'],
        [() => new Response('x'.repeat(65537)), 'provider_response_invalid'],
        [() => Response.json({ id: '../bad' }), 'provider_response_invalid'],
        [() => Response.json([1, 2]), 'provider_response_invalid'],
        [() => { throw new Error('secret payload'); }, 'provider_response_invalid'],
    ]) {
        let calls = 0;
        await fakeFetch(async () => { calls += 1; return make(); }, async () => {
            const r = await submitTask(job, cfg);
            assert.equal(r.ok, false);
            assert.equal(r.errorCode, code);
            assert.doesNotMatch(JSON.stringify(r), /secret payload/);
            assert.equal(calls, 1);
        });
    }
});

test('timeout and missing key fail safely without a request', async () => {
    await fakeFetch(async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    }), async () => assert.equal((await submitTask(job, { ...cfg, timeoutMs: 5 })).errorCode, 'provider_timeout'));
    await fakeFetch(async () => { throw new Error('must not fetch'); }, async () => {
        assert.equal((await submitTask(job, {})).errorCode, 'provider_not_configured');
        assert.equal((await submitTask({ ...job, inputs: { prompt: '' } }, cfg)).errorCode, 'inputs_invalid:prompt');
    });
});
