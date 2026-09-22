import test from 'node:test';
import assert from 'node:assert/strict';

import { REGISTRY, capabilityFor, lengthsFor, checkInputs, shapePayload, publicCapabilities } from '../lib/modelCapabilities.js';
import { shapeForProvider, payloadCheck, durationsFor } from '../lib/providerDuration.js';
import * as kie from '../packages/adapters/kie.js';
import * as openrouter from '../packages/adapters/openrouter.js';

// Every provider_endpoint in production's model_catalog on 2026-09-22.
const CATALOG = [
    'fal-ai/ace-step', 'fal-ai/ace-step-1.5', 'fal-ai/elevenlabs/sound-effects/v2', 'fal-ai/inworld-tts',
    'fal-ai/flux-2-pro', 'fal-ai/bytedance/seedream/v4/text-to-image', 'fal-ai/nano-banana',
    'fal-ai/kling-video/v2.6/pro/text-to-video', 'fal-ai/minimax/hailuo-02/standard/text-to-video',
    'fal-ai/wan-25-preview/text-to-video', 'fal-ai/veo3.1/fast', 'fal-ai/veo3.1',
    'fal-ai/kling-video/v3/pro/image-to-video',
    'veo:veo3_lite', 'veo:veo3_fast', 'veo:veo3', 'market:google/nano-banana',
    'bytedance/seedance-2.0-fast',
];

// Endpoints whose record deliberately differs from today's payload builder.
const CORRECTED = new Set(['fal-ai/kling-video/v3/pro/image-to-video']);

/** Every valid combination of a record's inputs: all declared keys, each enum value, each length. */
function fixtures(record) {
    const base = {};
    for (const [key, rule] of Object.entries(record.inputs)) {
        if (rule.type === 'string') base[key] = `${key} text`;
        if (rule.type === 'int') base[key] = 42;
        if (rule.type === 'enum') base[key] = rule.values[0];
    }
    const out = [];
    const enums = Object.entries(record.inputs).filter(([, r]) => r.type === 'enum');
    const variants = enums.length ? enums[0][1].values.map((v) => ({ ...base, [enums[0][0]]: v })) : [base];
    for (const v of variants) {
        for (const seconds of lengthsFor(record)) out.push(record.kind === 'video' ? { ...v, duration_seconds: seconds } : v);
    }
    out.push({ prompt: 'prompt only' });
    return out;
}

test('every catalog endpoint has a record, and unknown endpoints have none', () => {
    for (const ep of CATALOG) assert.ok(capabilityFor(ep), ep);
    assert.equal(capabilityFor('fal-ai/something-new'), null);
    assert.equal(capabilityFor(''), null);
    assert.equal(capabilityFor('toString'), null, 'prototype keys are not records');
    assert.deepEqual(Object.keys(REGISTRY).sort(), [...CATALOG].sort(), 'no stray records');
});

test('fal payloads are identical to today\'s providerDuration.js for every valid input', () => {
    for (const [ep, record] of Object.entries(REGISTRY)) {
        if (record.provider !== 'fal' || CORRECTED.has(ep)) continue;
        for (const inputs of fixtures(record)) {
            assert.deepEqual(checkInputs(record, inputs), { ok: true }, `${ep} ${JSON.stringify(inputs)}`);
            assert.deepEqual(payloadCheck({ provider_endpoint: ep }, inputs), { ok: true }, `${ep} legacy check`);
            assert.deepEqual(shapePayload(record, inputs), shapeForProvider({ provider_endpoint: ep }, inputs),
                `${ep} ${JSON.stringify(inputs)}`);
        }
    }
});

test('sellable lengths match what /api/catalog publishes today', () => {
    const modality = { image: 'text-to-image', audio: 'text-to-audio', speech: 'text-to-speech', video: 'text-to-video' };
    for (const [ep, record] of Object.entries(REGISTRY)) {
        if (record.provider !== 'fal') continue;
        assert.deepEqual(lengthsFor(record), durationsFor({ provider_endpoint: ep, modality: modality[record.kind] }), ep);
    }
});

test('where today\'s check refuses an aspect ratio or length, so does the record', () => {
    for (const [ep, record] of Object.entries(REGISTRY)) {
        if (record.provider !== 'fal') continue;
        for (const aspect of ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '21:9']) {
            const legacy = payloadCheck({ provider_endpoint: ep }, { prompt: 'p', aspect_ratio: aspect });
            if (!legacy.ok) assert.equal(checkInputs(record, { prompt: 'p', aspect_ratio: aspect }).ok, false, `${ep} ${aspect}`);
        }
        const legacy10 = payloadCheck({ provider_endpoint: ep }, { prompt: 'p', duration_seconds: 10 });
        if (!legacy10.ok) assert.equal(checkInputs(record, { prompt: 'p', duration_seconds: 10 }).ok, false, `${ep} 10s`);
    }
});

test('kie and OpenRouter records accept exactly what their adapters build', () => {
    for (const [ep, record] of Object.entries(REGISTRY)) {
        if (record.provider === 'fal') continue;
        const build = (inputs) => (record.provider === 'kie'
            ? kie.buildRequest(kie.parseEndpoint(ep), inputs)
            : openrouter.buildRequest(ep, inputs));
        for (const aspect of ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']) {
            const inputs = { prompt: 'p', aspect_ratio: aspect };
            assert.equal(checkInputs(record, inputs).ok, build(inputs).ok, `${ep} ${aspect}`);
        }
        // Image adapters ignore a length; the record refuses one (see below).
        for (const seconds of record.kind === 'video' ? [5, 10] : [5]) {
            const inputs = { prompt: 'p', duration_seconds: seconds };
            assert.equal(checkInputs(record, inputs).ok, build(inputs).ok, `${ep} ${seconds}s`);
        }
    }
});

test('Kling 3.0 i2v record carries the corrected fal contract', () => {
    const record = capabilityFor('fal-ai/kling-video/v3/pro/image-to-video');
    assert.deepEqual(checkInputs(record, { prompt: 'p' }), { ok: false, error: 'inputs_invalid:image_url' });
    assert.deepEqual(
        shapePayload(record, { prompt: 'p', image_url: 'https://r2.example/a.png', duration_seconds: 10 }),
        { prompt: 'p', start_image_url: 'https://r2.example/a.png', duration: '10', generate_audio: false },
    );
});

test('undeclared keys are refused, where today they pass through to the provider', () => {
    const wan = capabilityFor('fal-ai/wan-25-preview/text-to-video');
    assert.deepEqual(checkInputs(wan, { prompt: 'p', image_url: 'https://x/y.png' }), { ok: false, error: 'inputs_key_not_allowed:image_url' });
    const hailuo = capabilityFor('fal-ai/minimax/hailuo-02/standard/text-to-video');
    assert.deepEqual(checkInputs(hailuo, { prompt: 'p', aspect_ratio: '16:9' }), { ok: false, error: 'inputs_key_not_allowed:aspect_ratio' });
    assert.deepEqual(checkInputs(hailuo, { prompt: '  ' }), { ok: false, error: 'inputs_invalid:prompt' });
    // An image priced per output cannot be sold a 10s length, even where the
    // adapter would ignore it.
    const nanoKie = capabilityFor('market:google/nano-banana');
    assert.deepEqual(checkInputs(nanoKie, { prompt: 'p', duration_seconds: 10 }), { ok: false, error: 'duration_not_supported' });
});

test('the public view carries no provider field names, pins or assumptions', () => {
    for (const [ep, record] of Object.entries(REGISTRY)) {
        const view = JSON.stringify(publicCapabilities(record));
        for (const secret of [ep, ...Object.keys(record.fixed), ...Object.keys(record.assumes),
            ...Object.values(record.rename), ...Object.values(record.media).map((m) => m.field)]) {
            if (secret === 'prompt' || secret === 'aspect_ratio' || secret === 'seed' || secret === 'negative_prompt') continue;
            assert.ok(!view.includes(`"${secret}"`), `${ep} leaks ${secret}`);
        }
    }
    assert.deepEqual(publicCapabilities(capabilityFor('fal-ai/veo3.1/fast')), {
        kind: 'video', lengths: [5],
        inputs: { prompt: { type: 'string' }, negative_prompt: { type: 'string' }, seed: { type: 'int' },
            aspect_ratio: { type: 'enum', values: ['16:9', '9:16'] } },
        media: {},
    });
});
