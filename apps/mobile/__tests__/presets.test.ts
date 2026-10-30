import { ApiError } from '../src/lib/api';
import { fetchPresets, groupByCategory, groupByTheme, parsePresets, presetHref, presetPrice, searchPresets, themeTitle } from '../src/lib/presets';

const base = {
    id: 'a',
    title: 'Product Hero',
    category: 'PRODUCTS',
    theme: 'E-COMMERCE',
    modelId: 'kling-3.0-i2v',
    modelName: 'Kling 3.0',
    modality: 'image-to-video',
    prompt: 'Animate the product.',
    promptOrigin: 'veyrnox-adaptation',
    needs: 'A clean product image',
    sourceAspect: '9:16',
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
        expect(p).toMatchObject({ id: 'a', title: 'Product Hero', modelId: 'kling-3.0-i2v', promptOrigin: 'veyrnox-adaptation', credits: 68, durationSeconds: 10, needs: 'A clean product image', sourceAspect: '9:16', available: true });
    });

    test('keeps an exact source prompt separate from the compatible generation prompt', () => {
        const [p] = parsePresets({ presets: [{ ...base, sourcePrompt: 'Exact community text', sourcePromptOrigin: 'community-source-exact', sourcePromptStatus: 'exact', sourcePromptRunnable: false, sourcePromptIssues: ['source-input-contract-not-wired'], sourcePromptDuplicateOf: 'earlier-template' }] });
        expect(p).toMatchObject({ prompt: 'Animate the product.', sourcePrompt: 'Exact community text', sourcePromptOrigin: 'community-source-exact', sourcePromptStatus: 'exact', sourcePromptRunnable: false, sourcePromptIssues: ['source-input-contract-not-wired'], sourcePromptDuplicateOf: 'earlier-template' });
        expect((presetHref(p) as { params: { prompt: string } }).params.prompt).toBe('Animate the product.');
        const [invalidOrigin] = parsePresets({ presets: [{ ...base, sourcePrompt: '', sourcePromptOrigin: 'community-source-exact' }] });
        expect(invalidOrigin).toMatchObject({ sourcePrompt: null, sourcePromptOrigin: null });
        const [missingOrigin] = parsePresets({ presets: [{ ...base, sourcePrompt: 'Unverified source text' }] });
        expect(missingOrigin).toMatchObject({ sourcePrompt: null, sourcePromptOrigin: null });
        const verbatim = `  Начало\n${'界'.repeat(2200)}  `;
        const [longSource] = parsePresets({ presets: [{ ...base, sourcePrompt: verbatim, sourcePromptOrigin: 'community-source-exact' }] });
        expect(longSource.sourcePrompt).toBe(verbatim);
    });

    test('keeps source prompt gap states even when no exact text exists', () => {
        const [unavailable] = parsePresets({ presets: [{ ...base, sourcePromptStatus: 'unavailable', sourcePromptRunnable: false, sourcePromptIssues: ['source-prompt-unavailable'] }] });
        expect(unavailable).toMatchObject({ sourcePrompt: null, sourcePromptStatus: 'unavailable', sourcePromptRunnable: false, sourcePromptIssues: ['source-prompt-unavailable'] });
        const [legacy] = parsePresets({ presets: [base] });
        expect(legacy.sourcePromptStatus).toBe('adaptation-only');
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
        const items = parsePresets({ presets: [base, { ...base, id: 'b', theme: 'SOCCER FEVER' }, { ...base, id: 'c', theme: undefined, category: 'UGC' }] });
        const groups = groupByTheme(items);
        expect(groups.map((g) => g.category)).toEqual(['SOCCER FEVER', 'E-COMMERCE', 'UGC']);
        expect(groups[1].items.map((i) => i.id)).toEqual(['a']);
        expect(themeTitle('AI DANCE')).toBe('AI Dance');
        expect(themeTitle('E-COMMERCE')).toBe('E-commerce');
    });
});

describe('searchPresets', () => {
    test('matches all words across title, theme and prompt', () => {
        const items = parsePresets({ presets: [base, { ...base, id: 'b', title: 'Pet Press Conference', theme: 'PET', prompt: 'A playful animal interview.' }] });
        expect(searchPresets(items, 'pet interview').map((p) => p.id)).toEqual(['b']);
        expect(searchPresets(items, '  ')).toHaveLength(2);
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

    test('opens the selected template with the Community prompt and its validated id', () => {
        const [adapted] = parsePresets({ presets: [{ ...base, sourcePrompt: 'Exact @image1 source text', sourcePromptOrigin: 'community-source-exact', sourcePromptRunnable: false }] });
        expect(presetHref({ ...adapted, prompt: adapted.sourcePrompt! })).toMatchObject({ pathname: '/create/[modelId]', params: { tid: 'a', prompt: 'Exact @image1 source text' } });
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

    test('hides copy-only templates but keeps exact prompts that run or have a runnable adaptation', async () => {
        const exact = { sourcePromptOrigin: 'community-source-exact', sourcePrompt: 'Exact @image1 community text' };
        const presets = [
            { ...base, id: 'plain' },
            { ...base, id: 'runs', ...exact, prompt: 'Exact @image1 community text', promptOrigin: 'community-source-exact', sourcePromptRunnable: true },
            { ...base, id: 'adapted', ...exact, sourcePromptRunnable: false },
            { ...base, id: 'copy-only', ...exact, prompt: 'Exact @image1 community text', promptOrigin: 'community-source-exact', sourcePromptRunnable: false },
        ];
        globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ presets }) })) as unknown as typeof fetch;
        expect((await fetchPresets()).map((p) => p.id)).toEqual(['plain', 'runs', 'adapted']);
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
