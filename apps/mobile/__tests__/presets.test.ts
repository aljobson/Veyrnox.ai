import { ApiError } from '../src/lib/api';
import { fetchPresets, groupByCategory, groupByTheme, parsePresets, presetHref, presetPrice, themeTitle } from '../src/lib/presets';

const base = {
    id: 'a',
    title: 'Product Hero',
    category: 'PRODUCTS',
    theme: 'BRAND',
    modelId: 'kling-3.0-i2v',
    modelName: 'Kling 3.0',
    modality: 'image-to-video',
    prompt: 'Animate the product.',
    needs: 'A clean product image',
    durationSeconds: 10,
    credits: 68,
    gated: false,
    available: true,
    isNew: true,
    previewUrl: 'https://veyrnox.ai/showcase/a.mp4',
    posterUrl: 'https://veyrnox.ai/showcase/a.jpg',
    previewAspect: '482 / 720',
};

describe('parsePresets', () => {
    test('keeps well-formed presets and reads the price from the response', () => {
        const [p] = parsePresets({ presets: [base] });
        expect(p).toMatchObject({ id: 'a', title: 'Product Hero', modelId: 'kling-3.0-i2v', credits: 68, durationSeconds: 10, needs: 'A clean product image', available: true });
    });

    test('drops gated presets, since the app does not offer those models', () => {
        expect(parsePresets({ presets: [{ ...base, gated: true }] })).toEqual([]);
    });

    test('drops entries without an id, title, model, prompt or a whole positive price', () => {
        const bad = [{ ...base, id: '' }, { ...base, title: 7 }, { ...base, modelId: undefined }, { ...base, prompt: '' }, { ...base, credits: 0 }, { ...base, credits: 1.5 }, null, 'x'];
        expect(parsePresets({ presets: bad })).toEqual([]);
    });

    test('ignores preview links that are not https, and keeps the rest', () => {
        const [p] = parsePresets({ presets: [{ ...base, previewUrl: 'http://x/a.mp4', posterUrl: 'javascript:alert(1)' }] });
        expect(p.previewUrl).toBeNull();
        expect(p.posterUrl).toBeNull();
    });

    test('treats a missing duration as none and a missing need as null', () => {
        const [p] = parsePresets({ presets: [{ ...base, durationSeconds: undefined, needs: null }] });
        expect(p.durationSeconds).toBeNull();
        expect(p.needs).toBeNull();
    });

    test('keeps an inactive template; an older server that omits the field means every template is active', () => {
        expect(parsePresets({ presets: [{ ...base, available: false }] })[0]).toMatchObject({ id: 'a', available: false });
        expect(parsePresets({ presets: [{ ...base, available: undefined }] })[0]).toMatchObject({ id: 'a', available: true });
    });

    test('gives an empty list for anything that is not a presets list', () => {
        expect(parsePresets(null)).toEqual([]);
        expect(parsePresets({ presets: 'no' })).toEqual([]);
    });
});

describe('groupByCategory', () => {
    test('groups in first-seen order and keeps each preset in its group', () => {
        const items = parsePresets({ presets: [base, { ...base, id: 'b', category: 'UGC' }, { ...base, id: 'c' }] });
        const groups = groupByCategory(items);
        expect(groups.map((g) => g.category)).toEqual(['PRODUCTS', 'UGC']);
        expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'c']);
    });
});

describe('groupByTheme', () => {
    test('groups by the shared web theme and falls back to category for older servers', () => {
        const items = parsePresets({ presets: [base, { ...base, id: 'b', theme: 'ACTION' }, { ...base, id: 'c', theme: undefined, category: 'UGC' }] });
        const groups = groupByTheme(items);
        expect(groups.map((g) => g.category)).toEqual(['ACTION', 'BRAND', 'UGC']);
        expect(groups[1].items.map((i) => i.id)).toEqual(['a']);
        expect(themeTitle('ART STYLES')).toBe('Art Styles');
    });
});

describe('presetPrice', () => {
    test('is the number from the server, worded with its length', () => {
        const [p] = parsePresets({ presets: [base] });
        expect(presetPrice(p)).toBe('68 credits · 10 s');
    });
    test('has no length when the server gave none', () => {
        const [p] = parsePresets({ presets: [{ ...base, durationSeconds: undefined }] });
        expect(presetPrice(p)).toBe('68 credits');
    });
});

describe('presetHref', () => {
    test('opens Create only for an available template', () => {
        const [available] = parsePresets({ presets: [base] });
        const [unavailable] = parsePresets({ presets: [{ ...base, available: false }] });
        expect(presetHref(available).pathname).toBe('/create/[modelId]');
        expect(presetHref(unavailable)).toEqual({ pathname: '/create/presets', params: { unavailable: 'a' } });
    });
});

describe('fetchPresets', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('reads the anonymous route', async () => {
        const fn = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ presets: [base] }) }));
        globalThis.fetch = fn as unknown as typeof fetch;
        const list = await fetchPresets();
        expect(list).toHaveLength(1);
        expect(String((fn.mock.calls[0] as unknown[])[0])).toMatch(/\/api\/presets$/);
    });

    test('throws an ApiError carrying the status when the server fails', async () => {
        globalThis.fetch = (async () => ({ ok: false, status: 502, json: async () => ({}) })) as unknown as typeof fetch;
        await expect(fetchPresets()).rejects.toMatchObject({ status: 502 });
    });

    test('throws a network ApiError when offline', async () => {
        globalThis.fetch = (async () => {
            throw new Error('offline');
        }) as unknown as typeof fetch;
        await expect(fetchPresets()).rejects.toBeInstanceOf(ApiError);
    });
});
