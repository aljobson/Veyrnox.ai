import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, interpretJob, verifyWebhook, contentUrl } from '../packages/adapters/openrouter.js';

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

test('job interpretation covers every terminal state', () => {
    assert.equal(interpretJob({ status: 'completed' }).state, 'success');
    for (const s of ['failed', 'cancelled', 'expired']) assert.equal(interpretJob({ status: s }).state, 'fail');
    assert.equal(interpretJob({ status: 'in_progress' }).state, 'pending');
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
