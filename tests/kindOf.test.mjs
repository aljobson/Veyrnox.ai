import test from 'node:test';
import assert from 'node:assert/strict';

const { kindOf, MODELS } = await import('../app/veyrnox/_lib/tokens.js');

test('every modality the catalog actually ships maps to a coarse bucket', () => {
    // Live values in model_catalog.modality as of 2026-09-12.
    assert.equal(kindOf('text-to-video'), 'video');
    assert.equal(kindOf('image-to-video'), 'video');
    assert.equal(kindOf('text-to-image'), 'image');
    assert.equal(kindOf('text-to-audio'), 'audio');
});

test('image-to-video is video, not image — word order must not decide it', () => {
    assert.equal(kindOf('image-to-video'), 'video');
    assert.equal(kindOf('video-to-image'), 'video', 'video wins wherever it appears');
});

test('audio synonyms', () => {
    for (const m of ['tts', 'text-to-speech', 'music-generation', 'audio']) {
        assert.equal(kindOf(m), 'audio', m);
    }
});

test('an unknown modality never becomes video', () => {
    // The 10s multiplier keys on kind === 'video'. A modality nobody has
    // seen must not earn it by accident.
    for (const m of ['text-to-3d', 'weird', '', null, undefined, 42]) {
        assert.notEqual(kindOf(m), 'video', String(m));
    }
    assert.equal(kindOf('text-to-3d'), 'image');
});

test('case is not significant', () => {
    assert.equal(kindOf('TEXT-TO-VIDEO'), 'video');
    assert.equal(kindOf('Text-To-Audio'), 'audio');
});

test('the tokens.js fallback kinds are exactly what kindOf can return', () => {
    // The fallback path assigns m.kind directly and the live path assigns
    // kindOf(...). If these vocabularies drift, the two paths disagree again.
    const produced = new Set(['video', 'image', 'audio']);
    for (const m of MODELS) {
        assert.ok(produced.has(m.kind), `${m.id} has kind "${m.kind}", outside the kindOf vocabulary`);
    }
});
