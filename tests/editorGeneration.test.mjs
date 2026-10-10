import test from 'node:test';
import assert from 'node:assert/strict';
import { generationQuote, generationInputs } from '../app/veyrnox/_lib/editorGeneration.mjs';
const model = { id: 'existing-model', kind: 'video', credits: 12, takesPrompt: true, promptMax: 2000, durations: [5, 10], aspects: ['16:9', '9:16'] };
test('editor quotes only live catalog credit units and supported generation inputs', () => {
    assert.equal(generationQuote(model, 10), 24); assert.equal(generationQuote({ ...model, kind: 'image' }, 10), 12);
    assert.deepEqual(generationInputs(model, { prompt: ' A shot ', duration: 10, aspect: '9:16', voice: '' }), { inputs: { prompt: 'A shot', duration_seconds: 10, aspect_ratio: '9:16' } });
    assert.equal(generationQuote({ ...model, credits: undefined }, 5), null);
});
test('unsupported durations, shapes, voice descriptions and non-generation models fail before submission', () => {
    const values = { prompt: 'A shot', duration: 5, aspect: '16:9', voice: '' };
    for (const result of [generationInputs(model, { ...values, duration: 60 }), generationInputs(model, { ...values, aspect: '4:3' }), generationInputs({ ...model, takesVoice: true }, values), generationInputs({ ...model, isEdit: true }, values), generationInputs(model, { ...values, prompt: 'x'.repeat(2001) })]) assert.ok(result.error);
});
