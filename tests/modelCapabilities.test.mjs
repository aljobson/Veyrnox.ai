import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { REGISTRY, capabilityFor, lengthsFor, declaredInputs, checkInputs, shapePayload, publicCapabilities } from '../lib/modelCapabilities.js';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';

// Payloads the pre-registry builder (lib/providerDuration.js, removed in
// step 2) produced for every fal row, captured just before it was deleted.
const SNAPSHOT = JSON.parse(readFileSync(new URL('./fixtures/capability-payloads.json', import.meta.url), 'utf8'));
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

test('fal payloads are identical to the pre-registry builder for every captured case', () => {
    const falEndpoints = Object.entries(REGISTRY).filter(([ep, r]) => r.provider === 'fal' && !CORRECTED.has(ep)).map(([ep]) => ep);
    assert.deepEqual(Object.keys(SNAPSHOT).sort(), falEndpoints.sort(), 'snapshot covers every fal row');
    for (const [ep, cases] of Object.entries(SNAPSHOT)) {
        const record = capabilityFor(ep);
        for (const { inputs, payload } of cases) {
            assert.deepEqual(checkInputs(record, inputs), { ok: true }, `${ep} ${JSON.stringify(inputs)}`);
            assert.deepEqual(shapePayload(record, inputs), payload, `${ep} ${JSON.stringify(inputs)}`);
        }
    }
});

test('each fal video row buys the lengths it sold before the registry', () => {
    const expected = {
        'fal-ai/kling-video/v2.6/pro/text-to-video': [5, 10],
        'fal-ai/wan-25-preview/text-to-video': [5, 10],
        'fal-ai/kling-video/v3/pro/image-to-video': [5, 10],
        'fal-ai/minimax/hailuo-02/standard/text-to-video': [5],
        'fal-ai/veo3.1/fast': [5],
        'fal-ai/veo3.1': [5],
    };
    for (const [ep, lengths] of Object.entries(expected)) assert.deepEqual(lengthsFor(capabilityFor(ep)), lengths, ep);
    for (const [ep, record] of Object.entries(REGISTRY)) if (record.kind !== 'video') assert.deepEqual(lengthsFor(record), [5], ep);
    // Refusals the old builder made before the debit, still made.
    assert.equal(checkInputs(capabilityFor('fal-ai/minimax/hailuo-02/standard/text-to-video'), { prompt: 'p', duration_seconds: 10 }).ok, false);
    assert.equal(checkInputs(capabilityFor('fal-ai/wan-25-preview/text-to-video'), { prompt: 'p', aspect_ratio: '4:3' }).ok, false);
    assert.equal(checkInputs(capabilityFor('fal-ai/veo3.1/fast'), { prompt: 'p', aspect_ratio: '1:1' }).ok, false);
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

test('undeclared keys are dropped by the gateway, and refused if they reach the check', () => {
    // The create page sends aspect_ratio to every model; audio takes none.
    const sfx = capabilityFor('fal-ai/elevenlabs/sound-effects/v2');
    assert.deepEqual(declaredInputs(sfx, { prompt: 'rain', aspect_ratio: '16:9', seed: 3 }), { prompt: 'rain' });
    const hailuoInputs = declaredInputs(capabilityFor('fal-ai/minimax/hailuo-02/standard/text-to-video'),
        { prompt: 'p', aspect_ratio: '16:9', duration_seconds: 5, image_url: 'https://x/y.png' });
    assert.deepEqual(hailuoInputs, { prompt: 'p', duration_seconds: 5 });
    // Media keys survive only where the model has that slot.
    assert.deepEqual(declaredInputs(capabilityFor('fal-ai/kling-video/v3/pro/image-to-video'), { prompt: 'p', image_url: 'https://r2/a.png' }),
        { prompt: 'p', image_url: 'https://r2/a.png' });
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

test('the tokens.js fallback offers the lengths the live catalog does', () => {
    // /api/catalog publishes lengthsFor(record); if the fallback drifts, the
    // create page offers a length the gateway refuses.
    const endpointById = {
        'wan-2.5': 'fal-ai/wan-25-preview/text-to-video',
        'kling-2.6-pro': 'fal-ai/kling-video/v2.6/pro/text-to-video',
        'kling-3.0-i2v': 'fal-ai/kling-video/v3/pro/image-to-video',
        'minimax-hailuo-02': 'fal-ai/minimax/hailuo-02/standard/text-to-video',
        'veo-3.1-kie': 'veo:veo3', 'veo-3.1-fast-kie': 'veo:veo3_fast',
        'nano-banana-kie': 'market:google/nano-banana', 'flux-2-pro': 'fal-ai/flux-2-pro',
        'seedream-4': 'fal-ai/bytedance/seedream/v4/text-to-image', 'ace-step': 'fal-ai/ace-step',
    };
    for (const m of MODELS) {
        assert.ok(Array.isArray(m.durations) && m.durations.includes(5), `${m.id} must offer the 5s unit`);
        const ep = endpointById[m.id];
        if (ep) assert.deepEqual(m.durations, lengthsFor(capabilityFor(ep)), `${m.id} fallback durations`);
    }
});
