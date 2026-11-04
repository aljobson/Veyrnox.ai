import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityFor, checkInputs, shapePayload, publicCapabilities } from '../lib/modelCapabilities.js';
import { submitJob } from '../packages/adapters/fal.js';
import { evaluateMatch } from '../scripts/audit-pricing-parity.mjs';

const endpoint = 'fal-ai/sana/v1.5/4.8b';
const record = capabilityFor(endpoint);

test('Sana sends one sub-1MP image at the chosen shape instead of the provider 4K default', () => {
    const inputs = {prompt: 'A ceramic mug on a wooden table', negative_prompt: 'blur', seed: 42};
    assert.deepEqual(checkInputs(record, inputs), {ok: true});
    const body = shapePayload(record, inputs);
    assert.deepEqual(body, {...inputs, image_size: {width: 1024, height: 768}, num_images: 1,
        num_inference_steps: 18, guidance_scale: 5, enable_safety_checker: true,
        sync_mode: false, output_format: 'png', style_name: '(No style)'});
    assert.ok(body.image_size.width * body.image_size.height <= 1_000_000);
});

test('Sana offers 1:1, 4:3, 3:4, 16:9 and 9:16, each at most 1024x768 pixels and a multiple of 32', () => {
    assert.deepEqual(record.inputs.aspect_ratio.values, ['1:1', '4:3', '3:4', '16:9', '9:16']);
    assert.deepEqual(publicCapabilities(record).inputs.aspect_ratio.values, ['1:1', '4:3', '3:4', '16:9', '9:16']);
    for (const ratio of record.inputs.aspect_ratio.values) {
        const inputs = {prompt: 'mug', aspect_ratio: ratio};
        assert.deepEqual(checkInputs(record, inputs), {ok: true}, ratio);
        const body = shapePayload(record, inputs);
        const {width, height} = body.image_size;
        assert.ok(width * height <= 1024 * 768, ratio);
        assert.equal(width % 32, 0, ratio); assert.equal(height % 32, 0, ratio);
        assert.equal(Object.hasOwn(body, 'aspect_ratio'), false, 'the ratio is consumed, not sent to fal');
    }
    const [w, h] = ['9:16'].map((r) => shapePayload(record, {prompt: 'mug', aspect_ratio: r}).image_size).flatMap((s) => [s.width, s.height]);
    assert.ok(h > w, '9:16 is portrait');
    assert.equal(checkInputs(record, {prompt: 'mug', aspect_ratio: '21:9'}).ok, false);
});

test('Sana refuses client price overrides and reference images before debit', () => {
    for (const [key, value] of Object.entries({image_size: {width: 3840, height: 2160},
        num_images: 4, num_inference_steps: 50, sync_mode: true,
        enable_safety_checker: false, image_url: 'https://example.com/image.png'})) {
        assert.equal(checkInputs(record, {prompt: 'mug', [key]: value}).ok, false, key);
    }
    assert.equal(checkInputs(record, {prompt: ''}).ok, false);
    assert.deepEqual(publicCapabilities(record).media, {});
    assert.deepEqual(capabilityFor('fal-ai/flux-2-pro').assumes, {image_size: 'landscape_4_3'});
});

test('Sana uses the existing fal queue and webhook path', async (t) => {
    let called = false;
    t.mock.method(globalThis, 'fetch', async (url, opts) => {
        called = true;
        const parsed = new URL(url);
        assert.equal(parsed.origin + parsed.pathname, `https://queue.fal.run/${endpoint}`);
        assert.match(parsed.searchParams.get('fal_webhook'), /job_id=sana-test-job/);
        assert.equal(JSON.parse(opts.body).num_images, 1);
        return new Response(JSON.stringify({request_id: 'sana-provider-job'}), {status: 200});
    });
    const result = await submitJob({job_id: 'sana-test-job', provider_endpoint: endpoint,
        inputs: shapePayload(record, {prompt: 'mug'})}, {
        falKey: 'test-only', webhookBaseUrl: 'https://veyrnox.ai/api/webhook/fal',
    });
    assert.equal(called, true);
    assert.equal(result.ok, true);
});

test('Sana 1 credit retains at least 50% at every proposed pack under fee assumptions', () => {
    for (const [price_usd, credits] of [[19, 270], [59, 1200], [129, 3000]]) {
        const r = evaluateMatch({provider_cost_per_unit: 0.01}, {credits: 1},
            {price_usd, credits}, {percent: 8, fixedUsd: 0.30});
        assert.ok(r.margin >= 0.5);
    }
});
