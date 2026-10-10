import test from 'node:test';
import assert from 'node:assert/strict';
import { draftForTemplate, resolveTemplateDraft } from '../app/veyrnox/_lib/templateDraft.js';
import { takeStudioDraft } from '../app/veyrnox/_lib/landingDraft.js';

const MODEL = 'kling-2.6-pro-kie';
const preset = {
    id: 'frozen-motion', model: 'Kling 2.6 Pro',
    prompt: 'Freeze the moving crowd while the subject walks naturally toward the camera.',
    aspect: '9:16', durationSeconds: 10, negativePrompt: 'warped anatomy',
};
const expected = {
    prompt: preset.prompt, aspect: '9:16', durationSeconds: 10,
    negativePrompt: 'warped anatomy', templateId: preset.id,
};

test('opening a template directly restores its recipe without a stored draft', () => {
    assert.deepEqual(resolveTemplateDraft(preset, MODEL, null), expected);
    assert.deepEqual(resolveTemplateDraft(preset, MODEL, undefined), expected);
});

test('blocked session storage still leaves the URL template usable', () => {
    const blocked = { getItem() { throw new Error('storage denied'); } };
    const stored = takeStudioDraft(blocked, MODEL);
    assert.equal(stored, null);
    assert.deepEqual(resolveTemplateDraft(preset, MODEL, stored), expected);
});

test('older templates receive safe defaults for omitted recipe settings', () => {
    const legacy = { id: 'legacy-look', model: preset.model, prompt: preset.prompt };
    assert.deepEqual(draftForTemplate(legacy, MODEL), {
        prompt: preset.prompt, aspect: null, durationSeconds: 5,
        negativePrompt: '', templateId: legacy.id,
    });
});

test('a recipe never restores on another or unresolved model', () => {
    assert.equal(draftForTemplate(preset, 'wan-2.5-kie'), null);
    assert.equal(draftForTemplate({ ...preset, model: 'Unavailable model' }, MODEL), null);
    assert.equal(draftForTemplate(preset, null), null);
    assert.equal(resolveTemplateDraft(preset, 'wan-2.5-kie', { ...expected, prompt: 'stored edit' }), null);
});

test('saved edits for the selected template overlay all supported settings', () => {
    const saved = {
        templateId: preset.id, prompt: '  An edited scene with a new subject.  ',
        aspect: '16:9', durationSeconds: 5, negativePrompt: 'camera shake',
    };
    assert.deepEqual(resolveTemplateDraft(preset, MODEL, saved), {
        ...saved,
    });
    assert.equal(preset.prompt, expected.prompt, 'restoration must not mutate the shared recipe');
});

test('a draft from another template cannot overwrite a recipe on the same model', () => {
    const unrelated = {
        templateId: 'other-look', prompt: 'An unrelated stored scene',
        aspect: '1:1', durationSeconds: 5, negativePrompt: 'different exclusions',
    };
    assert.deepEqual(resolveTemplateDraft(preset, MODEL, unrelated), expected);
});

test('legacy saved drafts without a template id remain usable', () => {
    assert.deepEqual(resolveTemplateDraft(preset, MODEL, { prompt: 'A legacy edited scene', aspect: '16:9' }), {
        ...expected, prompt: 'A legacy edited scene', aspect: '16:9',
    });
});

test('malformed or empty saved settings cannot erase the recipe', () => {
    for (const durationSeconds of [0, 8, '10', NaN, null]) {
        assert.deepEqual(resolveTemplateDraft(preset, MODEL, {
            templateId: preset.id, prompt: '   ', aspect: 16,
            durationSeconds, negativePrompt: [],
        }), expected);
    }
    assert.deepEqual(resolveTemplateDraft(preset, MODEL, {
        templateId: preset.id, prompt: {}, aspect: '', negativePrompt: '  ',
    }), expected);
    assert.deepEqual(resolveTemplateDraft(preset, MODEL, {
        templateId: null, prompt: 'This draft has no valid template identity',
    }), expected);
});

test('malformed optional recipe settings use supported defaults', () => {
    assert.deepEqual(draftForTemplate({ ...preset, aspect: {}, durationSeconds: '10', negativePrompt: 42 }, MODEL), {
        ...expected, aspect: null, durationSeconds: 5, negativePrompt: '',
    });
    assert.equal(draftForTemplate({ ...preset, prompt: null }, MODEL), null);
    assert.equal(draftForTemplate({ ...preset, id: '' }, MODEL), null);
});

test('a normal studio entry retains its non-template draft unchanged', () => {
    const saved = { prompt: 'A standalone scene', aspect: '1:1' };
    assert.equal(resolveTemplateDraft(null, MODEL, saved), saved);
    assert.equal(resolveTemplateDraft(null, MODEL, null), null);
});
