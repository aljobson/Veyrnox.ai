import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { REGISTRY, capabilityFor, lengthsFor, declaredInputs, checkInputs, checkSource, expandCanvas, shapePayload, publicCapabilities } from '../lib/modelCapabilities.js';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';

// Payloads the pre-registry builder (lib/providerDuration.js, removed in
// step 2) produced for every fal row, captured just before it was deleted.
const SNAPSHOT = JSON.parse(readFileSync(new URL('./fixtures/capability-payloads.json', import.meta.url), 'utf8'));
import * as kie from '../packages/adapters/kie.js';
import * as openrouter from '../packages/adapters/openrouter.js';

// Every provider_endpoint in production's model_catalog on 2026-09-22, plus the
// kie twins staged inactive by migration 0105 (a row with no record can never
// be listed or bought, so the record ships before the row is switched on).
const CATALOG = [
    'fal-ai/ace-step', 'fal-ai/ace-step-1.5', 'fal-ai/elevenlabs/sound-effects/v2', 'fal-ai/inworld-tts',
    'fal-ai/flux-2-pro', 'fal-ai/bytedance/seedream/v4/text-to-image', 'fal-ai/nano-banana',
    'fal-ai/kling-video/v2.6/pro/text-to-video', 'fal-ai/minimax/hailuo-02/standard/text-to-video',
    'fal-ai/wan-25-preview/text-to-video', 'fal-ai/veo3.1/fast', 'fal-ai/veo3.1',
    'fal-ai/kling-video/v3/pro/image-to-video', 'fal-ai/nano-banana-pro', 'fal-ai/nano-banana-pro/edit',
    'fal-ai/elevenlabs/tts/turbo-v2.5', 'fal-ai/minimax/speech-2.6-hd', 'fal-ai/mmaudio-v2/text-to-audio', 'fal-ai/bria/background/remove',
    'fal-ai/topaz/upscale/image', 'fal-ai/bria/expand', 'fal-ai/latentsync', 'fal-ai/kling-video/ai-avatar/v2/standard',
    'fal-ai/elevenlabs/text-to-dialogue/eleven-v3',
    'veo:veo3_lite', 'veo:veo3_fast', 'veo:veo3', 'market:google/nano-banana',
    'market:wan/2-5-text-to-video', 'market:kling-2.6/text-to-video', 'market:nano-banana-pro',
    'market:hailuo/02-text-to-video-standard', 'market:seedream/4.5-text-to-image', 'market:elevenlabs/text-to-speech-turbo-2-5',
    'bytedance/seedance-2.0-fast', 'auto-short:v1', 'clip-edit:v1',
];

// Endpoints the pre-registry snapshot does not cover: corrected on purpose
// (Kling 3.0), or added after the old builder was deleted.
const CORRECTED = new Set(['fal-ai/kling-video/v3/pro/image-to-video', 'fal-ai/nano-banana-pro', 'fal-ai/nano-banana-pro/edit',
    'fal-ai/elevenlabs/tts/turbo-v2.5', 'fal-ai/minimax/speech-2.6-hd', 'fal-ai/mmaudio-v2/text-to-audio', 'fal-ai/bria/background/remove',
    'fal-ai/topaz/upscale/image', 'fal-ai/bria/expand', 'fal-ai/latentsync', 'fal-ai/kling-video/ai-avatar/v2/standard',
    'fal-ai/elevenlabs/text-to-dialogue/eleven-v3']);

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
        'wan-2.5-kie': 'market:wan/2-5-text-to-video',
        'kling-2.6-pro-kie': 'market:kling-2.6/text-to-video',
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

test('Nano Banana Pro pins every billed parameter, and Edit sends its source as a list', () => {
    const pins = { resolution: '2K', num_images: 1, enable_web_search: false, sync_mode: false };
    const pro = capabilityFor('fal-ai/nano-banana-pro');
    assert.deepEqual(shapePayload(pro, { prompt: 'p', aspect_ratio: '16:9' }), { prompt: 'p', aspect_ratio: '16:9', ...pins });
    // A client cannot lift the resolution to the 4K rate: the key is dropped.
    assert.deepEqual(declaredInputs(pro, { prompt: 'p', resolution: '4K', enable_web_search: true }), { prompt: 'p' });

    const edit = capabilityFor('fal-ai/nano-banana-pro/edit');
    assert.equal(checkInputs(edit, { prompt: 'p' }).ok, false, 'a source image is required');
    assert.deepEqual(shapePayload(edit, { prompt: 'p', image_url: 'https://r2/a.png' }),
        { prompt: 'p', image_urls: ['https://r2/a.png'], ...pins });
});

test('speech text is capped at the 1000 characters its price covers', () => {
    for (const ep of ['fal-ai/elevenlabs/tts/turbo-v2.5', 'fal-ai/minimax/speech-2.6-hd']) {
        const r = capabilityFor(ep);
        assert.deepEqual(checkInputs(r, { prompt: 'x'.repeat(1000) }), { ok: true }, ep);
        assert.equal(checkInputs(r, { prompt: 'x'.repeat(1001) }).ok, false, ep);
    }
    assert.deepEqual(shapePayload(capabilityFor('fal-ai/elevenlabs/tts/turbo-v2.5'), { prompt: 'hi' }), { text: 'hi', timestamps: false });
    assert.deepEqual(shapePayload(capabilityFor('fal-ai/minimax/speech-2.6-hd'), { prompt: 'hi' }), { prompt: 'hi', output_format: 'url' });
});

test('MMAudio buys one 8s clip, and background removal sends only the image', () => {
    assert.deepEqual(shapePayload(capabilityFor('fal-ai/mmaudio-v2/text-to-audio'), { prompt: 'rain' }), { prompt: 'rain', duration: 8, num_steps: 25 });
    const bria = capabilityFor('fal-ai/bria/background/remove');
    // The create page always sends a prompt; this model takes none.
    const inputs = declaredInputs(bria, { prompt: 'ignored', aspect_ratio: '16:9', image_url: 'https://r2/a.png' });
    assert.deepEqual(shapePayload(bria, inputs), { image_url: 'https://r2/a.png', sync_mode: false });
    assert.equal(checkInputs(bria, {}).ok, false, 'an image is required');
});

test('Topaz refuses a source over 6 MP, or one whose size is unreadable, before the debit', () => {
    const topaz = capabilityFor('fal-ai/topaz/upscale/image');
    const img = (dimensions) => ({ image_url: { dimensions, seconds: null } });
    assert.deepEqual(checkSource(topaz, img({ width: 3000, height: 2000 })), { ok: true });
    assert.deepEqual(checkSource(topaz, img({ width: 3001, height: 2000 })), { ok: false, error: 'source_too_large' });
    assert.deepEqual(checkSource(topaz, img(null)), { ok: false, error: 'source_size_unknown' });
    assert.deepEqual(checkSource(capabilityFor('fal-ai/nano-banana-pro/edit'), img(null)), { ok: true }, 'no cap, no check');
    assert.deepEqual(shapePayload(topaz, { image_url: 'https://r2/a.png' }, img({ width: 10, height: 10 })),
        { image_url: 'https://r2/a.png', upscale_factor: 2, model: 'Standard V2', output_format: 'jpeg', crop_to_fill: false });
});

test('Bria expand gets a canvas of the chosen ratio that holds the source, under its area limit', () => {
    assert.deepEqual(expandCanvas({ width: 1000, height: 1000 }, '16:9'), [2222, 1250]);
    assert.deepEqual(expandCanvas({ width: 1600, height: 900 }, '9:16'), [2000, 3555]);
    const [w, h] = expandCanvas({ width: 8000, height: 3000 }, '1:1');
    assert.ok(w * h < 5000 * 5000 && Math.abs(w - h) <= 1, `${w}x${h}`);
    const bria = capabilityFor('fal-ai/bria/expand');
    const payload = shapePayload(bria, { prompt: 'beach', aspect_ratio: '1:1', image_url: 'https://r2/a.png' }, { image_url: { dimensions: { width: 800, height: 600 } } });
    assert.deepEqual(payload, { prompt: 'beach', aspect_ratio: '1:1', image_url: 'https://r2/a.png', canvas_size: [1000, 1000], sync_mode: false });
});

test('lip sync caps each source at the length its price covers, before the debit', () => {
    const latent = capabilityFor('fal-ai/latentsync');
    const avatar = capabilityFor('fal-ai/kling-video/ai-avatar/v2/standard');
    const src = (seconds) => ({ dimensions: null, seconds });
    assert.deepEqual(checkSource(latent, { video_url: src(40), audio_url: src(39.5) }), { ok: true });
    assert.deepEqual(checkSource(latent, { video_url: src(40.1), audio_url: src(5) }), { ok: false, error: 'source_too_long' });
    assert.deepEqual(checkSource(avatar, { image_url: src(null), audio_url: src(10) }), { ok: true }, 'an image has no length cap');
    assert.deepEqual(checkSource(avatar, { image_url: src(null), audio_url: src(10.2) }), { ok: false, error: 'source_too_long' });
    assert.deepEqual(checkSource(avatar, { image_url: src(null), audio_url: src(null) }), { ok: false, error: 'source_length_unknown' });
    // Both uploads are required, and both reach fal under their own fields.
    assert.equal(checkInputs(avatar, { prompt: 'p', image_url: 'https://r2/f.png' }).ok, false);
    const inputs = declaredInputs(avatar, { prompt: 'talks', aspect_ratio: '16:9', image_url: 'https://r2/f.png', audio_url: 'https://r2/s.mp3' });
    assert.deepEqual(shapePayload(avatar, inputs), { prompt: 'talks', image_url: 'https://r2/f.png', audio_url: 'https://r2/s.mp3' });
    assert.deepEqual(publicCapabilities(latent).media, { video: { required: true, maxSeconds: 40 }, audio: { required: true, maxSeconds: 40 } });
});

test('a dialogue script becomes speaker blocks, and the prompt itself is never sent', () => {
    const d = capabilityFor('fal-ai/elevenlabs/text-to-dialogue/eleven-v3');
    const script = 'Ana: Did you hear that?\nBen: [whispers] Stay quiet.\nstill whispering\nana: Too late.';
    assert.deepEqual(checkInputs(d, { prompt: script }), { ok: true });
    assert.deepEqual(shapePayload(d, { prompt: script }), { inputs: [
        { voice: 'Aria', text: 'Did you hear that?' },
        { voice: 'Roger', text: '[whispers] Stay quiet. still whispering' },
        { voice: 'Aria', text: 'Too late.' },
    ] });
    assert.deepEqual(checkInputs(d, { prompt: 'A: 1\nB: 2\nC: 3\nD: 4\nE: 5' }), { ok: false, error: 'dialogue_invalid' }, 'five speakers');
    assert.equal(checkInputs(d, { prompt: '   ' }).ok, false);
    assert.equal(checkInputs(d, { prompt: 'x'.repeat(1001) }).ok, false, 'the 1000-character cap the price covers');
});
