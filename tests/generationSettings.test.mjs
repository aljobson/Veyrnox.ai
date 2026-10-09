import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsInputs, seedIsInvalid, voiceIsMissing, SEED_MAX, VOICE_MAX } from '../app/veyrnox/_lib/generationSettings.js';

const both = { takesSeed: true, takesNegative: true };

test('sends seed and negative prompt only to a model that takes them', () => {
    assert.deepEqual(settingsInputs(both, { seed: '42', negative: '  blur ' }), { seed: 42, negative_prompt: 'blur' });
    assert.deepEqual(settingsInputs({ takesSeed: true }, { seed: '42', negative: 'blur' }), { seed: 42 });
    assert.deepEqual(settingsInputs({}, { seed: '42', negative: 'blur' }), {});
    assert.deepEqual(settingsInputs(null, { seed: '42', negative: 'blur' }), {});
});

test('a blank or invalid seed is left out, never sent', () => {
    for (const seed of ['', '-1', '1.5', 'abc', String(SEED_MAX + 1)]) {
        assert.deepEqual(settingsInputs(both, { seed, negative: '' }), {}, seed);
    }
    assert.deepEqual(settingsInputs(both, { seed: String(SEED_MAX), negative: '' }), { seed: SEED_MAX });
    assert.deepEqual(settingsInputs(both, { seed: '0', negative: '   ' }), { seed: 0 });
});

test('the form flags a seed it would drop, but not a blank one', () => {
    assert.equal(seedIsInvalid(''), false);
    assert.equal(seedIsInvalid('7'), false);
    assert.equal(seedIsInvalid('x'), true);
    assert.equal(seedIsInvalid(String(SEED_MAX + 1)), true);
});

test('a described voice is sent only to a model that takes one, and is required there', () => {
    const qwen = { takesVoice: true };
    assert.deepEqual(settingsInputs(qwen, { seed: '', negative: '', voice: '  A calm older man  ' }), { voice_description: 'A calm older man' });
    assert.deepEqual(settingsInputs({}, { seed: '', negative: '', voice: 'A calm older man' }), {});
    assert.deepEqual(settingsInputs(qwen, { seed: '', negative: '', voice: '   ' }), {});
    assert.equal(voiceIsMissing(qwen, '   '), true);
    assert.equal(voiceIsMissing(qwen, 'A calm older man'), false);
    assert.equal(voiceIsMissing({}, ''), false, 'other models never ask for one');
    assert.equal(voiceIsMissing(null, ''), false);
    assert.equal(VOICE_MAX, 500, 'the cap the capability record and the gateway enforce');
});
