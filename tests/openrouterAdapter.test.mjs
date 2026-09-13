import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, interpretJob, verifyWebhook, contentUrl, submitVideo } from '../packages/adapters/openrouter.js';

async function sign(t, body, secret) {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${t},${body}`));
    return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
}

test('seedance request is pinned to the priced spec and refuses others', () => {
    const r = buildRequest('bytedance/seedance-2.0-fast', { prompt: 'waves' });
    assert.equal(r.ok, true);
    assert.equal(r.body.duration, 5);
    assert.equal(r.body.resolution, '720p');
    assert.equal(r.body.aspect_ratio, '16:9');
    assert.equal(r.body.generate_audio, true);
    assert.equal(buildRequest('bytedance/seedance-2.0-fast', { prompt: 'x', duration_seconds: 10 }).body.duration, 10);
    assert.equal(buildRequest('bytedance/seedance-2.0-fast', { prompt: 'x', aspect_ratio: '1:1' }).error, 'inputs_invalid:aspect_ratio');
    assert.equal(buildRequest('bytedance/seedance-2.0-fast', { prompt: 'x', duration_seconds: 7 }).error, 'duration_not_supported');
    assert.equal(buildRequest('google/veo-3.1-fast', { prompt: 'x' }).error, 'provider_model_unmapped');
});

test('job interpretation covers every terminal state with a typed code, never vendor text', () => {
    assert.equal(interpretJob({ status: 'completed' }).state, 'success');
    const vendor = { message: 'Upstream said: <secret detail>', code: 'Some Vendor Code' };
    assert.deepEqual(interpretJob({ status: 'failed', error: vendor }), { ok: true, state: 'fail', errorCode: 'provider_error' });
    assert.deepEqual(interpretJob({ status: 'cancelled', error: vendor }), { ok: true, state: 'fail', errorCode: 'provider_cancelled' });
    assert.deepEqual(interpretJob({ status: 'expired' }), { ok: true, state: 'fail', errorCode: 'provider_timeout' });
    assert.equal(interpretJob({ status: 'in_progress' }).state, 'pending');
});

// Fake fetch that records the one outbound request and answers with `reply`.
function fakeFetch(reply) {
    const seen = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        seen.push({ url: String(url), init });
        return typeof reply === 'function' ? reply() : reply;
    };
    return { seen, restore: () => { globalThis.fetch = real; } };
}

const JOB = { job_id: 'bc4fda06-6d8f-4075-b742-d86b933278ea', provider_endpoint: 'bytedance/seedance-2.0-fast', inputs: { prompt: 'waves' } };
const CFG = { apiKey: 'sk-or-test', callbackUrl: 'https://veyrnox.ai/api/webhook/openrouter' };

test('submit sends the documented POST /api/v1/videos request for seedance-2.0-fast', async () => {
    const net = fakeFetch(Response.json({ id: 'job-abc123', polling_url: '/api/v1/videos/job-abc123', status: 'pending' }, { status: 202 }));
    try {
        const r = await submitVideo(JOB, CFG);
        assert.deepEqual(r, { ok: true, providerJobId: 'job-abc123' });
        assert.equal(net.seen.length, 1);
        const { url, init } = net.seen[0];
        assert.equal(url, 'https://openrouter.ai/api/v1/videos');
        assert.equal(init.method, 'POST');
        assert.deepEqual(init.headers, { Authorization: 'Bearer sk-or-test', 'Content-Type': 'application/json' });
        // Every field is in the createVideos schema; values are in the model's
        // supported_durations / supported_resolutions / supported_aspect_ratios.
        assert.deepEqual(JSON.parse(init.body), {
            model: 'bytedance/seedance-2.0-fast',
            prompt: 'waves',
            duration: 5,
            resolution: '720p',
            aspect_ratio: '16:9',
            generate_audio: true,
            callback_url: 'https://veyrnox.ai/api/webhook/openrouter',
        });
    } finally { net.restore(); }
});

test('submit image-to-video uses the frame_images shape from the schema', async () => {
    const net = fakeFetch(Response.json({ id: 'job-1' }, { status: 202 }));
    try {
        await submitVideo({ ...JOB, inputs: { prompt: 'x', image_url: 'https://img.test/a.png', seed: 7, duration_seconds: 10, aspect_ratio: '9:16' } }, CFG);
        const body = JSON.parse(net.seen[0].init.body);
        assert.deepEqual(body.frame_images, [{ type: 'image_url', image_url: { url: 'https://img.test/a.png' }, frame_type: 'first_frame' }]);
        assert.equal(body.seed, 7);
        assert.equal(body.duration, 10);
        assert.equal(body.aspect_ratio, '9:16');
    } finally { net.restore(); }
});

test('submit rejections carry a typed errorCode and no vendor payload', async () => {
    const vendor = { error: { code: 402, message: 'Insufficient credits. Add more using https://openrouter.ai/credits' } };
    const cases = [
        [400, 'provider_request_rejected'],
        [401, 'provider_auth_failed'],
        [402, 'provider_payment_required'],
        [403, 'provider_auth_failed'],
        [404, 'provider_model_unavailable'],
        [413, 'provider_request_rejected'],
        [429, 'provider_rate_limited'],
        [500, 'provider_unavailable'],
        [503, 'provider_unavailable'],
    ];
    for (const [status, code] of cases) {
        const net = fakeFetch(Response.json(vendor, { status }));
        try {
            const r = await submitVideo(JOB, CFG);
            assert.equal(r.ok, false);
            assert.equal(r.errorCode, code, `status ${status}`);
            assert.match(r.errorCode, /^[a-z0-9_]{1,64}$/);
        } finally { net.restore(); }
    }
});

test('submit transport, timeout and malformed replies map to typed codes', async () => {
    let net = fakeFetch(() => { throw new TypeError('network down'); });
    try { assert.equal((await submitVideo(JOB, CFG)).errorCode, 'provider_unreachable'); } finally { net.restore(); }

    net = fakeFetch(() => { throw new DOMException('aborted', 'AbortError'); });
    try { assert.equal((await submitVideo(JOB, CFG)).errorCode, 'provider_timeout'); } finally { net.restore(); }

    net = fakeFetch(Response.json({ status: 'pending' }, { status: 202 }));
    try { assert.equal((await submitVideo(JOB, CFG)).errorCode, 'provider_bad_response'); } finally { net.restore(); }

    net = fakeFetch(new Response('<html>', { status: 202 }));
    try { assert.equal((await submitVideo(JOB, CFG)).errorCode, 'provider_bad_response'); } finally { net.restore(); }

    net = fakeFetch(Response.json({ id: 'job-1' }, { status: 202 }));
    try {
        assert.equal((await submitVideo(JOB, { ...CFG, callbackUrl: 'http://veyrnox.ai/cb' })).errorCode, 'submit_config_invalid');
        assert.equal((await submitVideo({ ...JOB, job_id: '../x' }, CFG)).errorCode, 'submit_config_invalid');
        assert.equal((await submitVideo({ ...JOB, inputs: { prompt: '' } }, CFG)).errorCode, 'provider_request_invalid');
        assert.equal(net.seen.length, 0, 'nothing is sent for a request we refuse locally');
    } finally { net.restore(); }
});

test('webhook signature: valid, tampered body, stale, unsigned, no secret', async () => {
    const now = 1789250000;
    const body = '{"type":"video.generation.completed","data":{"id":"abc"}}';
    const raw = new TextEncoder().encode(body);
    const header = `t=${now},v1=${await sign(now, body, 'whsec')}`;
    assert.equal(await verifyWebhook(raw, header, { secret: 'whsec', nowSeconds: now }), true);
    assert.equal(await verifyWebhook(new TextEncoder().encode(body.replace('abc', 'xyz')), header, { secret: 'whsec', nowSeconds: now }), false);
    assert.equal(await verifyWebhook(raw, header, { secret: 'whsec', nowSeconds: now + 3600 }), false);
    assert.equal(await verifyWebhook(raw, null, { secret: 'whsec', nowSeconds: now }), false);
    assert.equal(await verifyWebhook(raw, header, {}), false);
});

test('content is only ever fetched from openrouter.ai for our own id', () => {
    assert.equal(contentUrl('abc'), 'https://openrouter.ai/api/v1/videos/abc/content?index=0');
    assert.equal(new URL(contentUrl('../../evil')).host, 'openrouter.ai');
});
