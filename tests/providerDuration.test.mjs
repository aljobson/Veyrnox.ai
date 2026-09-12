import test from 'node:test';
import assert from 'node:assert/strict';

const { durationsFor, durationSpec, shapeForProvider } = await import('../lib/providerDuration.js');
const { MODELS } = await import('../app/veyrnox/_lib/tokens.js');

// provider_endpoint values live in model_catalog as of 2026-09-12.
const LIVE = [
    { id: 'wan-2.5', provider_endpoint: 'fal-ai/wan-25-preview/text-to-video', modality: 'text-to-video', expect: [5, 10] },
    { id: 'kling-2.6-pro', provider_endpoint: 'fal-ai/kling-video/v2.6/pro/text-to-video', modality: 'text-to-video', expect: [5, 10] },
    { id: 'kling-3.0-i2v', provider_endpoint: 'fal-ai/kling-video/v3/pro/image-to-video', modality: 'image-to-video', expect: [5, 10] },
    { id: 'minimax-hailuo-02', provider_endpoint: 'fal-ai/minimax/hailuo-02/standard/text-to-video', modality: 'text-to-video', expect: [5] },
    { id: 'veo-3.1', provider_endpoint: 'fal-ai/veo3.1', modality: 'text-to-video', expect: [5] },
    { id: 'veo-3.1-fast', provider_endpoint: 'fal-ai/veo3.1/fast', modality: 'text-to-video', expect: [5] },
    { id: 'nano-banana', provider_endpoint: 'fal-ai/nano-banana', modality: 'text-to-image', expect: [5] },
    { id: 'ace-step', provider_endpoint: 'fal-ai/ace-step', modality: 'text-to-audio', expect: [5] },
];

test('every live model offers exactly the lengths fal can be asked for', () => {
    for (const m of LIVE) {
        assert.deepEqual(durationsFor(m), m.expect, m.id);
    }
});

test('an unmapped endpoint sells 5s only — never 10s by default', () => {
    for (const ep of ['bytedance/seedance-2.0/fast/text-to-video', 'fal-ai/something-new', '']) {
        assert.deepEqual(durationsFor({ provider_endpoint: ep, modality: 'text-to-video' }), [5], ep);
    }
    assert.deepEqual(durationsFor(null), [5]);
});

test('prefix matching does not catch a lookalike endpoint', () => {
    // 'fal-ai/wandering' must not inherit wan's duration support.
    assert.equal(durationSpec({ provider_endpoint: 'fal-ai/wandering-model' }), null);
    assert.deepEqual(durationsFor({ provider_endpoint: 'fal-ai/wandering-model', modality: 'text-to-video' }), [5]);
    assert.notEqual(durationSpec({ provider_endpoint: 'fal-ai/wan-25-preview/text-to-video' }), null);
});

test('shapeForProvider renames our field and drops it when unsupported', () => {
    const wan = { provider_endpoint: 'fal-ai/wan-25-preview/text-to-video' };
    assert.deepEqual(
        shapeForProvider(wan, { prompt: 'x', duration_seconds: 10 }),
        { prompt: 'x', duration: '10' },
    );
    const veo = { provider_endpoint: 'fal-ai/veo3.1' };
    assert.deepEqual(
        shapeForProvider(veo, { prompt: 'x', duration_seconds: 5 }),
        { prompt: 'x' },
        'no length field for a family that cannot honour one',
    );
});

test('the tokens.js fallback agrees with what the server would derive', () => {
    // The create page reads `durations` from whichever path won. If these
    // drift, the fallback offers a length the gateway rejects.
    const byId = new Map(LIVE.map((m) => [m.id, m.expect]));
    for (const m of MODELS) {
        const expected = byId.get(m.id);
        if (!expected) continue; // model not in the live sample above
        assert.deepEqual(m.durations, expected, `${m.id} fallback durations`);
    }
});

test('every fallback model declares durations', () => {
    for (const m of MODELS) {
        assert.ok(Array.isArray(m.durations) && m.durations.length, `${m.id} has no durations`);
        assert.ok(m.durations.includes(5), `${m.id} must offer the 5s unit`);
    }
});
