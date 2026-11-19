import { canCompare, comparableWith, compareHref, compareRows, isPromptGenerator } from '../src/lib/modelCompare';
import type { CatalogModel } from '../src/lib/media';
import { chooseLocale } from '../src/lib/i18n';
import en from '../src/lib/i18n/messages/en/modelCompare';

const model = (extra: Partial<CatalogModel> = {}): CatalogModel => ({
    id: 'nano-banana-kie', name: 'Nano Banana', modality: 'text-to-image', credits: 3,
    durations: [], gated: false, capabilities: { inputs: { prompt: {} } }, ...extra,
});
beforeEach(() => chooseLocale('en'));
afterEach(() => chooseLocale('en'));

test.each<[string, CatalogModel['capabilities'], boolean]>([
    ['prompt only', { inputs: { prompt: {} } }, true],
    ['required image', { inputs: { prompt: {} }, media: { image: { required: true } } }, false],
    ['no prompt', { inputs: { duration: {} } }, false],
    ['false prompt', { inputs: { prompt: false } }, false],
    ['optional media', { inputs: { prompt: {} }, media: { image: { required: false }, audio: {} } }, true],
    ['null capabilities', null, false],
])('isPromptGenerator handles %s', (_, capabilities, expected) => {
    expect(isPromptGenerator(model({ capabilities }))).toBe(expected);
});

test('comparableWith excludes self, gated, required-media and other modalities, and sorts by name', () => {
    const source = model();
    const alpha = model({ id: 'alpha', name: 'Alpha' });
    const zulu = model({ id: 'zulu', name: 'Zulu' });
    const all = [zulu, source, model({ id: 'closed', gated: true }),
        model({ id: 'video', modality: 'text-to-video' }), model({ id: 'edit', modality: 'image-to-image' }),
        model({ id: 'upload', capabilities: { inputs: { prompt: {} }, media: { image: { required: true } } } }),
        model({ id: 'no-prompt', capabilities: null }), alpha];
    const original = [...all];
    expect(comparableWith(source, all)).toEqual([alpha, zulu]);
    expect(all).toEqual(original);
    expect(comparableWith(model({ gated: true }), all)).toEqual([]);
    expect(comparableWith(model({ capabilities: null }), all)).toEqual([]);
});

test.each<[string, Partial<CatalogModel>, boolean]>([
    ['distinct prompt generator', { id: 'peer' }, true],
    ['same id', {}, false],
    ['different modality', { id: 'peer', modality: 'text-to-video' }, false],
    ['gated', { id: 'peer', gated: true }, false],
    ['missing prompt', { id: 'peer', capabilities: null }, false],
    ['required upload', { id: 'peer', capabilities: { inputs: { prompt: {} }, media: { image: { required: true } } } }, false],
])('canCompare handles %s symmetrically', (_, extra, expected) => {
    expect(canCompare(model(), model(extra))).toBe(expected);
    expect(canCompare(model(extra), model())).toBe(expected);
});

test('rows start with catalog prices, then union facts in first-seen order with missing values as en dashes', () => {
    const a = model({ capabilities: { inputs: { prompt: {}, aspect_ratio: { type: 'enum', values: ['1:1', '16:9'] } } } });
    const b = model({ id: 'peer', credits: 11, capabilities: {
        inputs: { prompt: {}, style: { type: 'enum', values: ['photo', 'film'] } }, media: { image: { required: false } },
    } });
    expect(compareRows(a, b)).toEqual([
        { label: 'Price', values: ['3 cr per image.', '11 cr per image.'] },
        { label: 'Mode', values: ['text to image', 'text to image'] },
        { label: 'Prompt', values: ['Text prompt', 'Text prompt'] },
        { label: 'Aspect ratio', values: ['1:1, 16:9', '–'] },
        { label: 'Image input', values: ['–', 'Optional'] },
        { label: 'Style', values: ['–', 'photo, film'] },
    ]);
});

test('a clashing Mode enum keeps the first fact value on both sides without duplicate rows', () => {
    const a = model({ capabilities: { inputs: { prompt: {}, mode: { type: 'enum', values: ['draft'] } } } });
    const b = model({ id: 'peer', capabilities: { inputs: { prompt: {}, mode: { type: 'enum', values: ['quality'] } } } });
    expect(compareRows(a, b).filter(row => row.label === 'Mode')).toEqual([
        { label: 'Mode', values: ['text to image', 'text to image'] },
    ]);
});

test('video price units preserve catalog presentation without recalculating credits', () => {
    const a = model({ modality: 'text-to-video', durations: [5, 10], credits: 7 });
    const b = model({ id: 'peer', modality: 'text-to-video', durations: [5], credits: 13,
        capabilities: { inputs: { prompt: {} }, presentation: { fixedDurationLabel: '8s' } } });
    expect(compareRows(a, b)[0]).toEqual({ label: 'Price', values: ['7 cr per 5 s clip; 10 s costs double.', '13 cr per 8 s clip.'] });
});

test('comparison href converts supplier ids before sorting and is independent of input order', () => {
    const expected = { pathname: '/model/compare', params: { a: 'nano-banana-a1', b: 'nano-banana-a2' } };
    expect(compareHref('nano-banana-kie', 'nano-banana-grsai')).toEqual(expected);
    expect(compareHref('nano-banana-grsai', 'nano-banana-kie')).toEqual(expected);
    // Default JS ordering puts '-' before '.', unlike localeCompare in common locales.
    expect(compareHref('model.1-kie', 'model-1-grsai').params).toEqual({ a: 'model-1-a2', b: 'model.1-a1' });
});

test.each(['ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'])('%s has every Compare key and preserves placeholders', locale => {
    const messages = require(`../src/lib/i18n/messages/app/${locale}`).default as Record<string, string>;
    for (const [key, value] of Object.entries(en)) {
        expect(typeof messages[key]).toBe('string');
        expect(messages[key].trim()).not.toBe('');
        expect((messages[key].match(/\{\w+\}/g) ?? []).sort()).toEqual((value.match(/\{\w+\}/g) ?? []).sort());
    }
});
