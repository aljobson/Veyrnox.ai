import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEndpoint, endpointKind, buildRequest, submitTask, interpretTask, fetchTask } from '../packages/adapters/higgsfield.js';
import { classifySubmitFailure } from '../lib/supplierRoutesFailover.js';

const image = 'higgsfield:kling-video/v3.0/pro/image-to-video';
const text = 'higgsfield:kling-video/v2.6/pro/text-to-video';
const inputs = { prompt: ' a boat ', image_url: 'https://images.test/start.png' };
const job = { job_id: 'our-job-1', provider_endpoint: image, inputs };
const cfg = { apiKey: 'fixture-key' };
const realFetch = globalThis.fetch;
test.beforeEach(() => { globalThis.fetch = async () => assert.fail('unexpected network call'); });
test.afterEach(() => { globalThis.fetch = realFetch; });

test('only the two exact endpoints parse as video, including no path or host tricks', () => {
    for (const endpoint of [image, text]) {
        assert.equal(parseEndpoint(endpoint).model, endpoint.slice(11));
        assert.equal(endpointKind(endpoint), 'video');
    }
    for (const endpoint of [null, {}, '', `${image}/`, `${image}?key=x`, image.toUpperCase(), image.replace('v3.0', 'v3.1'),
        image.replace('/pro/', '/std/'), 'higgsfield:../kling-video/v3.0/pro/image-to-video', `https://api.higgsfield.ai/${image}`, 'higgsfield:https://evil.test']) {
        assert.equal(parseEndpoint(endpoint), null);
        assert.equal(endpointKind(endpoint), null);
    }
});

test('3.0 pins silent single shot and rewrites only versioned passport handles exactly like kie', () => {
    const r = buildRequest(parseEndpoint(image), { ...inputs, prompt: '@hero:v1 meets @Hero_2:v9999 and @element and @bad:v0', duration_seconds: 10 });
    assert.deepEqual(r, { ok: true, body: { sound: 'off', prompt: 'hero:v1 meets Hero_2:v9999 and @element and @bad:v0', duration: 10, image_url: inputs.image_url, multi_shots: false } });
    assert.equal(buildRequest(parseEndpoint(image), inputs).body.duration, 5);
});

test('2.6 is silent text-to-video at 5 or 10 seconds with the three allowed aspects', () => {
    assert.deepEqual(buildRequest(parseEndpoint(text), { prompt: ' boat ' }), { ok: true, body: { sound: 'off', prompt: 'boat', duration: 5, aspect_ratio: '16:9' } });
    for (const aspect_ratio of ['16:9', '9:16', '1:1']) for (const duration_seconds of [5, 10]) {
        assert.deepEqual(buildRequest(parseEndpoint(text), { prompt: 'boat', aspect_ratio, duration_seconds }).body,
            { sound: 'off', prompt: 'boat', duration: duration_seconds, aspect_ratio });
    }
});

test('typed refusals enforce exact inputs, prompt cap, image, duration and aspect', () => {
    const build = (ep, extra) => buildRequest(parseEndpoint(ep), { prompt: 'boat', ...(ep === image ? { image_url: inputs.image_url } : {}), ...extra });
    for (const ep of [image, text]) {
        for (const prompt of ['', ' ', 42, null]) assert.equal(build(ep, { prompt }).error, 'prompt_required');
        assert.equal(build(ep, { prompt: 'x'.repeat(2500) }).ok, true);
        assert.equal(build(ep, { prompt: 'x'.repeat(2501) }).error, 'inputs_invalid:prompt');
        for (const duration_seconds of [3, 15, '5', 0, null]) assert.equal(build(ep, { duration_seconds }).error, 'duration_not_supported');
        for (const key of ['sound', 'multi_shots', 'cfg_scale', 'last_image_url', 'elements', 'multi_prompt', 'reference_urls']) {
            assert.equal(build(ep, { [key]: false }).error, `inputs_key_not_allowed:${key}`);
        }
    }
    for (const image_url of [undefined, null, ['https://a.test/x'], 'http://a.test/x', 'https://', 'https://u:p@a.test/x', 'https://a.test/ x']) {
        assert.equal(build(image, { image_url }).error, 'inputs_invalid:image_url');
    }
    assert.equal(build(image, { aspect_ratio: '16:9' }).error, 'inputs_key_not_allowed:aspect_ratio');
    assert.equal(build(text, { image_url: undefined }).error, 'inputs_key_not_allowed:image_url');
    assert.equal(build(text, { aspect_ratio: '4:3' }).error, 'inputs_invalid:aspect_ratio');
    assert.equal(buildRequest({ model: 'other' }, {}).error, 'provider_unsupported');
});

test('submit pins sound off for both models, auth, idempotency, manual redirects and only returns the validated id', async () => {
    for (const ep of [image, text]) {
        globalThis.fetch = async (url, init) => {
            assert.equal(url, `https://api.higgsfield.ai/${parseEndpoint(ep).model}`);
            assert.equal(init.method, 'POST');
            assert.equal(init.redirect, 'manual');
            assert.equal(init.headers.Authorization, 'Key fixture-key');
            assert.equal(init.headers['Idempotency-Key'], job.job_id);
            assert.equal(JSON.parse(init.body).sound, 'off');
            return Response.json({ status: 'queued', request_id: 'request.1-a_b', status_url: 'https://evil.test/status', cancel_url: 'https://evil.test/cancel' });
        };
        assert.deepEqual(await submitTask({ ...job, provider_endpoint: ep, inputs: ep === image ? inputs : { prompt: 'boat' } }, cfg), { ok: true, providerJobId: 'request.1-a_b' });
    }
});

test('invalid local jobs never fetch', async () => {
    for (const over of [{ job_id: '../bad' }, { provider_endpoint: 'unknown' }, { inputs: { prompt: 'x' } }, { inputs: { ...inputs, sound: 'on' } }]) {
        assert.equal((await submitTask({ ...job, ...over }, cfg)).outcome, 'rejected');
    }
    assert.equal((await submitTask(job, {})).error, 'provider_not_configured');
});

test('4xx refuses except 408; 5xx is ambiguous; 429 queue full is rejected and eligible to hop', async () => {
    for (const status of [400, 401, 403, 408, 422, 429, 500, 503]) {
        globalThis.fetch = async () => Response.json({ error: 'account_queue_full', message: 'private vendor payload' }, { status, headers: { 'Retry-After': '60' } });
        const r = await submitTask(job, cfg);
        const outcome = status === 408 || status >= 500 ? 'unknown' : 'rejected';
        assert.deepEqual(r, { ok: false, outcome, error: `higgsfield ${status}/${outcome}` });
        assert.equal(classifySubmitFailure(r), [401, 403, 429].includes(status) ? 'failover' : 'stop');
    }
});

test('redirect is refused without following it, even with a plausible response id', async () => {
    let calls = 0;
    globalThis.fetch = async (_url, init) => { calls++; assert.equal(init.redirect, 'manual'); return Response.json({ request_id: 'id' }, { status: 307, headers: { Location: 'https://evil.test' } }); };
    assert.equal((await submitTask(job, cfg)).ok, false);
    assert.equal((await fetchTask('id', cfg)).ok, false);
    assert.equal(calls, 2);
});

test('unparseable, oversized and missing or malformed ids on 2xx are ambiguous', async () => {
    for (const request_id of [undefined, null, 1, {}, '', 'x'.repeat(129), 'x/y', 'x?y', 'x%2fy', '.', '..', 'id\n']) {
        globalThis.fetch = async () => Response.json({ request_id });
        assert.equal((await submitTask(job, cfg)).outcome, 'unknown');
    }
    for (const body of ['not JSON', 'x'.repeat(128 * 1024 + 1)]) {
        globalThis.fetch = async () => new Response(body);
        assert.equal((await submitTask(job, cfg)).outcome, 'unknown');
        assert.equal((await fetchTask('id', cfg)).ok, false);
    }
    globalThis.fetch = async () => { throw new Error('sensitive transport details'); };
    assert.deepEqual(await submitTask(job, cfg), { ok: false, outcome: 'unknown', error: 'higgsfield response unavailable' });
});

test('both bounded body reads time out even when a stream never finishes', async () => {
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } }));
    assert.equal((await submitTask(job, { ...cfg, timeoutMs: 5 })).outcome, 'unknown');
    assert.equal((await fetchTask('id', { ...cfg, timeoutMs: 5 })).ok, false);
});

test('status mapping never treats an unknown status as completion and sanitizes failure codes', () => {
    assert.deepEqual(interpretTask({ status: 'completed', video: { url: 'https://unknown.test/video.mp4' } }), { ok: true, state: 'success', outputUrl: 'https://unknown.test/video.mp4' });
    for (const url of [undefined, 'http://a.test/v', 'https://', ['https://a.test/v']]) assert.equal(interpretTask({ status: 'completed', video: { url } }).ok, false);
    for (const [status, errorCode] of [['failed', 'provider_failed'], ['nsfw', 'provider_moderated'], ['canceled', 'provider_canceled']]) {
        assert.deepEqual(interpretTask({ status, error: 'private payload' }), { ok: true, state: 'fail', errorCode });
    }
    for (const status of ['queued', 'in_progress', 'success', 'cancelled', 'mystery', undefined]) assert.deepEqual(interpretTask({ status }), { ok: true, state: 'pending' });
    assert.deepEqual(interpretTask(null), { ok: true, state: 'pending' });
});

test('poll uses only the constant canonical host and ignores returned status_url/cancel_url', async () => {
    const urls = [];
    globalThis.fetch = async (url, init) => {
        urls.push(url);
        assert.equal(init.redirect, 'manual');
        assert.equal(init.headers.Authorization, 'Key fixture-key');
        return Response.json(init.method === 'POST' ? { request_id: 'id_1', status_url: 'https://evil.test', cancel_url: 'https://evil.test' } : { status: 'in_progress' });
    };
    const sub = await submitTask(job, cfg);
    assert.deepEqual(await fetchTask(sub.providerJobId, cfg), { ok: true, state: 'pending' });
    assert.equal(urls[1], 'https://api.higgsfield.ai/requests/id_1/status');
    for (const id of ['../evil', '.', '..', 'x%2fy', 'id\n', 'https://evil.test', 'x'.repeat(129), null, 12]) assert.equal((await fetchTask(id, cfg)).ok, false);
    assert.equal(urls.length, 2);
});
