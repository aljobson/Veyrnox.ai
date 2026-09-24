import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEndpoint, buildRequest, interpretRecord, verifyCallback, callbackTaskId } from '../packages/adapters/kie.js';

async function sign(taskId, ts, key) {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${taskId}.${ts}`));
    return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

test('parses only known endpoint shapes', () => {
    assert.deepEqual(parseEndpoint('market:google/nano-banana'), { kind: 'market', model: 'google/nano-banana' });
    assert.deepEqual(parseEndpoint('veo:veo3_fast'), { kind: 'veo', model: 'veo3_fast' });
    assert.deepEqual(parseEndpoint('veo:veo3_lite'), { kind: 'veo', model: 'veo3_lite' });
    // An unlisted tier is still refused: the allowlist, not kie, decides what we sell.
    assert.equal(parseEndpoint('veo:veo3_ultra'), null);
    assert.equal(parseEndpoint('fal-ai/veo3.1'), null);
    assert.equal(parseEndpoint('market:../x'), null);
});

test('veo requests are pinned to the priced 8s 720p unit and refuse unsupported inputs', () => {
    const t = parseEndpoint('veo:veo3_fast');
    const ok = buildRequest(t, { prompt: 'a cat' });
    assert.equal(ok.ok, true);
    assert.equal(ok.body.duration, 8);
    assert.equal(ok.body.resolution, '720p');
    assert.equal(ok.body.model, 'veo3_fast');
    assert.equal(buildRequest(t, { prompt: 'a cat', aspect_ratio: '1:1' }).error, 'inputs_invalid:aspect_ratio');
    assert.equal(buildRequest(t, { prompt: 'a cat', duration_seconds: 10 }).error, 'duration_not_supported');
    assert.equal(buildRequest(t, { prompt: '  ' }).error, 'inputs_invalid:prompt');
});

test('unmapped market models fail closed', () => {
    assert.equal(buildRequest(parseEndpoint('market:kling-3.0/video'), { prompt: 'x' }).error, 'provider_model_unmapped');
});

test('Wan 2.5 and Kling 2.6 are pinned to the tier they are costed at, and a 10s clip is refused unless asked for', () => {
    const wan = buildRequest(parseEndpoint('market:wan/2-5-text-to-video'), { prompt: 'a cat' });
    assert.deepEqual(wan.body, { model: 'wan/2-5-text-to-video', input: { prompt: 'a cat', duration: '5', aspect_ratio: '16:9', resolution: '720p', nsfw_checker: true } });
    const kling = buildRequest(parseEndpoint('market:kling-2.6/text-to-video'), { prompt: 'a cat', duration_seconds: 10, aspect_ratio: '9:16' });
    assert.deepEqual(kling.body, { model: 'kling-2.6/text-to-video', input: { prompt: 'a cat', duration: '10', aspect_ratio: '9:16', sound: false } });
    for (const ep of ['market:wan/2-5-text-to-video', 'market:kling-2.6/text-to-video']) {
        const t = parseEndpoint(ep);
        assert.equal(buildRequest(t, { prompt: 'x', duration_seconds: 7 }).error, 'duration_not_supported', ep);
        assert.equal(buildRequest(t, { prompt: 'x', aspect_ratio: '4:3' }).error, 'inputs_invalid:aspect_ratio', ep);
        assert.equal(buildRequest(t, { prompt: 'x', image_url: 'https://r2.example/a.png' }).error, 'inputs_key_not_allowed:image_url', ep);
        assert.equal(buildRequest(t, { prompt: ' ' }).error, 'inputs_invalid:prompt', ep);
    }
});

test('Nano Banana Pro pins 2K so a request cannot reach the 4K rate', () => {
    const t = parseEndpoint('market:nano-banana-pro');
    assert.deepEqual(buildRequest(t, { prompt: 'p', aspect_ratio: 'auto' }).body,
        { model: 'nano-banana-pro', input: { prompt: 'p', aspect_ratio: 'auto', resolution: '2K', output_format: 'png' } });
    assert.equal(buildRequest(t, { prompt: 'p', resolution: '4K' }).body.input.resolution, '2K');
    assert.equal(buildRequest(t, { prompt: 'p', image_url: 'https://r2.example/a.png' }).error, 'inputs_key_not_allowed:image_url');
});

test('record interpretation', () => {
    assert.deepEqual(interpretRecord('market', { state: 'success', resultJson: '{"resultUrls":["https://tempfile.aiquickdraw.com/a.png"]}' }),
        { ok: true, state: 'success', outputUrl: 'https://tempfile.aiquickdraw.com/a.png' });
    assert.equal(interpretRecord('market', { state: 'success', resultJson: '{}' }).state, 'fail');
    assert.equal(interpretRecord('market', { state: 'generating' }).state, 'pending');
    assert.equal(interpretRecord('market', { state: 'fail', failCode: 'GENERATION_FAILED' }).errorCode, 'GENERATION_FAILED');
    assert.equal(interpretRecord('veo', { successFlag: 1, response: { resultUrls: ['https://x.aiquickdraw.com/v.mp4'] } }).outputUrl, 'https://x.aiquickdraw.com/v.mp4');
    assert.equal(interpretRecord('veo', { successFlag: 0 }).state, 'pending');
    assert.equal(interpretRecord('veo', { successFlag: 3 }).state, 'fail');
});

test('callback HMAC: valid, wrong key, stale, unsigned, no key configured', async () => {
    const now = 1789250000;
    const sig = await sign('task_1', String(now), 'secret');
    assert.equal(await verifyCallback('task_1', { signature: sig, timestamp: String(now) }, { hmacKey: 'secret', nowSeconds: now }), true);
    assert.equal(await verifyCallback('task_2', { signature: sig, timestamp: String(now) }, { hmacKey: 'secret', nowSeconds: now }), false);
    assert.equal(await verifyCallback('task_1', { signature: sig, timestamp: String(now) }, { hmacKey: 'other', nowSeconds: now }), false);
    assert.equal(await verifyCallback('task_1', { signature: sig, timestamp: String(now) }, { hmacKey: 'secret', nowSeconds: now + 3600 }), false);
    assert.equal(await verifyCallback('task_1', { signature: null, timestamp: null }, { hmacKey: 'secret', nowSeconds: now }), false);
    assert.equal(await verifyCallback('task_1', { signature: sig, timestamp: String(now) }, {}), false);
});

test('finds the task id wherever kie puts it', () => {
    assert.equal(callbackTaskId({ data: { taskId: 'a' } }), 'a');
    assert.equal(callbackTaskId({ data: { task_id: 'b' } }), 'b');
    assert.equal(callbackTaskId({ taskId: 'c' }), 'c');
    assert.equal(callbackTaskId({}), null);
});
