import test from 'node:test';
import assert from 'node:assert/strict';
import { draftForTemplate, resolveTemplateDraft, templateArrival, templateModelEligible, createPromptModelAvailable } from '../app/veyrnox/_lib/templateDraft.js';
import { takeStudioDraft, writeStudioDraft } from '../app/veyrnox/_lib/landingDraft.js';
import { presetHref } from '../app/veyrnox/_lib/tokens.js';

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

const original = { id: MODEL, modality: 'image-to-video', durations: [5, 10] };
const other = { id: 'wan-2.5-kie', modality: 'image-to-video', durations: [5, 10] };
const catalog = [original, other];
const query = values => new URLSearchParams(values);
const exact = { ...preset, sourcePromptOrigin: 'community-source-exact', sourcePromptRunnable: false, sourcePrompt: 'The exact community prompt, with references.' };

test('a non-runnable exact community prompt is restored without adaptation', () => {
    assert.deepEqual(draftForTemplate(exact, MODEL), { ...expected, prompt: exact.sourcePrompt });
    assert.equal(resolveTemplateDraft(exact, MODEL, null).prompt, exact.sourcePrompt);
});

test('only a matching arrival binding allows the recipe on another model', () => {
    const saved = { ...expected, model: other.id, prompt: 'Personal edit' };
    assert.equal(draftForTemplate(exact, other.id), null);
    assert.equal(draftForTemplate(exact, other.id, 'another-template'), null);
    assert.equal(draftForTemplate(exact, other.id, exact.id).prompt, exact.sourcePrompt);
    assert.equal(resolveTemplateDraft(exact, other.id, saved, exact.id).prompt, saved.prompt);
    assert.equal(resolveTemplateDraft(exact, other.id, saved, 'another-template'), null);
    // Create model changes have no arrival binding, even with an old matching draft.
    assert.equal(resolveTemplateDraft(exact, other.id, saved), null);
});

test('URL model, aspect and both durations override matching stored choices', () => {
    for (const seconds of [5, 10]) {
        const saved = { ...expected, model: MODEL, durationSeconds: seconds === 5 ? 10 : 5, prompt: 'Personal edit' };
        const href = presetHref(exact, seconds, { model: other.id, aspect: '4:5' });
        const arrival = templateArrival(exact, catalog, new URL(href, 'https://example.test').searchParams, saved);
        assert.equal(arrival.modelId, other.id);
        assert.deepEqual(arrival.draft, { ...expected, prompt: saved.prompt, aspect: '4:5', durationSeconds: seconds });
    }
});

test('blocked storage restores URL choices and the fetched exact prompt on another model', () => {
    const storage = { getItem() { throw Error('blocked'); } };
    for (const seconds of [5, 10]) {
        const saved = takeStudioDraft(storage, other.id, Date.now(), exact.id);
        const arrival = templateArrival(exact, catalog, query({ model: other.id, aspect: '16:9', duration: `${seconds}s` }), saved);
        assert.equal(arrival.modelId, other.id);
        assert.deepEqual(arrival.draft, { ...expected, prompt: exact.sourcePrompt, aspect: '16:9', durationSeconds: seconds });
    }
});

test('matching stored choices precede defaults; another template or legacy draft cannot override arrival', () => {
    const saved = { ...expected, model: other.id, prompt: 'Edited', aspect: '1:1', durationSeconds: 5 };
    assert.deepEqual(templateArrival(exact, catalog, query({}), saved), {
        modelId: other.id, draft: { ...expected, prompt: 'Edited', aspect: '1:1', durationSeconds: 5 },
    });
    for (const templateId of ['unrelated', undefined]) {
        const arrival = templateArrival(exact, catalog, query({}), { ...saved, templateId });
        assert.equal(arrival.modelId, MODEL);
        assert.deepEqual(arrival.draft, { ...expected, prompt: exact.sourcePrompt });
        assert.deepEqual(templateArrival(exact, catalog, query({ model: other.id }), { ...saved, templateId }).draft, { ...expected, prompt: exact.sourcePrompt });
    }
});

test('a matching arrival draft can carry another catalog-declared duration', () => {
    const arrival = templateArrival(exact, [original, { ...other, durations: [6, 10] }], query({}), {
        ...expected, model: other.id, durationSeconds: 6,
    });
    assert.equal(arrival.draft.durationSeconds, 6);
    assert.equal(arrival.modelId, other.id);
});

test('arrival model eligibility is shared, modality-specific and excludes gated, edit, plan and topic rows', () => {
    assert.equal(templateModelEligible(other, original), true);
    for (const change of [{ gated: true }, { premium: true }, { isEdit: true }, { takesPlan: true }, { takesTopic: true }, { modality: 'text-to-video' }, { modality: null }]) {
        const candidate = { ...other, ...change };
        assert.equal(templateModelEligible(candidate, original), false, JSON.stringify(change));
        const arrival = templateArrival(exact, [original, candidate], query({ model: other.id }), { ...expected, model: other.id });
        assert.equal(arrival.modelId, MODEL, JSON.stringify(change));
    }
    assert.equal(templateModelEligible(other, { ...original, modality: null }), false);
    assert.equal(templateArrival(exact, catalog, query({ model: 'unknown' }), null).modelId, MODEL);
    assert.equal(createPromptModelAvailable({ takesTopic: true }), false);
    assert.equal(createPromptModelAvailable({ takesTopic: true }, true), true, 'Create retains its topic flag');
});

test('template-scoped storage reads preserve model precedence without weakening normal studio isolation', () => {
    const values = new Map();
    const storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key), removeItem: key => values.delete(key) };
    const saved = { ...expected, model: other.id };
    writeStudioDraft(storage, saved);
    assert.equal(takeStudioDraft(storage, MODEL), null);
    writeStudioDraft(storage, saved);
    assert.equal(takeStudioDraft(storage, MODEL, Date.now(), 'unrelated'), null);
    writeStudioDraft(storage, saved);
    assert.deepEqual(takeStudioDraft(storage, MODEL, Date.now(), preset.id), saved);
});
