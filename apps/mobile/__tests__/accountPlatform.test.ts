import { ApiError } from '../src/lib/api';
import { emptyKit, fetchKit, kitErrorKey, kitProblem, normaliseColour, parseAssets, parseKitState, saveKit } from '../src/lib/brandKit';
import { groupModels, needs, priceLines } from '../src/lib/catalogPages';
import { modelEntries, MAX_RESULTS, screenEntries, searchEntries, SCREENS } from '../src/lib/siteSearch';
import type { CatalogModel } from '../src/lib/media';

const WS = '123e4567-e89b-42d3-a456-426614174000';
const model = (o: Partial<CatalogModel> & { id: string }): CatalogModel => ({ name: o.id, modality: 'text-to-image', credits: 3, gated: false, durations: [], capabilities: null, ...o });

describe('brand kit', () => {
    test('before anything is saved the server sends no kit: the starting kit is used', () => {
        const s = parseKitState({ kit: null, version: 0, canEdit: true });
        expect(s.kit).toEqual(emptyKit());
        expect(s).toMatchObject({ version: 0, canEdit: true });
    });
    test('a saved kit keeps its text styles and assets; junk is dropped and edit rights default to no', () => {
        const s = parseKitState({ kit: { name: 'Acme', palette: ['#aabbcc', 3], fonts: ['Arial'], textStyles: [{ a: 1 }], assets: [{ b: 2 }] }, version: 4 });
        expect(s.kit).toMatchObject({ name: 'Acme', palette: ['#aabbcc'], textStyles: [{ a: 1 }], assets: [{ b: 2 }] });
        expect(s).toMatchObject({ version: 4, canEdit: false });
        expect(parseKitState(null).kit).toEqual(emptyKit());
        expect(parseKitState({ version: -1 }).version).toBe(0);
    });
    test('colours are tidied to #rrggbb', () => {
        expect(normaliseColour('ABC')).toBe('#aabbcc');
        expect(normaliseColour('#AABBCC')).toBe('#aabbcc');
        expect(normaliseColour(' 32d6c5 ')).toBe('#32d6c5');
        expect(normaliseColour('#12345')).toBeNull();
        expect(normaliseColour('red')).toBeNull();
        expect(normaliseColour('')).toBeNull();
    });
    test('the server rules: name, 1-12 colours, 1-10 listed fonts, 8 KB', () => {
        const ok = emptyKit();
        expect(kitProblem(ok)).toBeNull();
        expect(kitProblem({ ...ok, name: '  ' })).toBe('name');
        expect(kitProblem({ ...ok, name: 'x'.repeat(81) })).toBe('name');
        expect(kitProblem({ ...ok, palette: [] })).toBe('palette');
        expect(kitProblem({ ...ok, palette: Array(13).fill('#000000') })).toBe('palette');
        expect(kitProblem({ ...ok, palette: ['#00000'] })).toBe('palette');
        expect(kitProblem({ ...ok, fonts: [] })).toBe('fonts');
        expect(kitProblem({ ...ok, fonts: ['Comic Sans'] })).toBe('fonts');
        expect(kitProblem({ ...ok, assets: [{ pad: 'x'.repeat(9000) }] })).toBe('size');
    });
    test('save sends the version it read, the whole kit and an idempotency key; a bad kit or workspace sends nothing', async () => {
        const request = jest.fn(async () => ({ kit: emptyKit(), version: 2, canEdit: true }));
        const api = { request } as never;
        const state = parseKitState({ kit: emptyKit(), version: 1, canEdit: true });
        const out = await saveKit(api, WS, state, { ...state.kit, name: 'New' }, 'brand-key-12345');
        expect(out.version).toBe(2);
        const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(`/api/v1/workspaces/${WS}/brand-kit`);
        expect(init.method).toBe('PUT');
        expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('brand-key-12345');
        expect(JSON.parse(String(init.body))).toMatchObject({ expected_version: 1, kit: { name: 'New' } });
        await expect(saveKit(api, WS, state, { ...state.kit, name: '' }, 'k')).rejects.toMatchObject({ code: 'invalid_brand_kit' });
        await expect(saveKit(api, 'not-a-uuid', state, state.kit, 'k')).rejects.toMatchObject({ code: 'invalid_workspace' });
        await expect(fetchKit(api, '../x')).rejects.toMatchObject({ code: 'invalid_workspace' });
        expect(request).toHaveBeenCalledTimes(1);
    });
    test('wording follows the HTTP status', () => {
        expect(kitErrorKey(new ApiError(404, 'unknown'))).toBe('brand.err.off');
        expect(kitErrorKey(new ApiError(409, 'unknown'))).toBe('brand.err.conflict');
        expect(kitErrorKey(new ApiError(429, 'unknown'))).toBe('brand.err.rate');
        expect(kitErrorKey(new ApiError(0, 'network'))).toBe('brand.err.network');
        expect(kitErrorKey(new ApiError(400, 'unknown'))).toBe('brand.err.invalid');
        expect(kitErrorKey(new Error('x'))).toBe('brand.err.failed');
    });
    test('workspace assets are read for display only', () => {
        const r = parseAssets({ assets: [{ id: 'a', project_id: 'p', sniffed_type: 'image/png', byte_size: 5000, duration_ms: 2500, width: 10, height: 20 }, { id: 5 }, null], truncated: true });
        expect(r).toEqual({ assets: [{ id: 'a', projectId: 'p', type: 'image/png', bytes: 5000, seconds: 3, width: 10, height: 20 }], truncated: true });
        expect(parseAssets(undefined)).toEqual({ assets: [], truncated: false });
    });
});

describe('catalogue pages', () => {
    const models = [
        model({ id: 'b', name: 'Zed', credits: 5 }),
        model({ id: 'a', name: 'Alpha', credits: 5 }),
        model({ id: 'v', name: 'Clip', modality: 'text-to-video', credits: 10, durations: [5, 10] }),
        model({ id: 'x', name: 'Odd', modality: 'weird', credits: 1 }),
    ];
    test('groups by kind in a fixed order, cheapest then name first, with no empty group', () => {
        const g = groupModels(models);
        expect(g.map((x) => x.kind)).toEqual(['image', 'video', 'other']);
        expect(g[0].models.map((m) => m.id)).toEqual(['a', 'b']);
        expect(groupModels([])).toEqual([]);
    });
    test('video shows each length; everything else one price', () => {
        expect(priceLines(models[2])).toEqual([{ seconds: 5, credits: 10 }, { seconds: 10, credits: 20 }]);
        expect(priceLines(models[0])).toEqual([{ seconds: null, credits: 5 }]);
    });
    test('lists only the files a model requires', () => {
        const m = model({ id: 'i', capabilities: { media: { image: { required: true, label: 'A photo' }, audio: { required: false } } } });
        expect(needs(m)).toEqual(['A photo']);
        expect(needs(models[0])).toEqual([]);
    });
});

describe('search', () => {
    const title = (k: string) => ({ 'srch.s.security': 'Account security', 'srch.s.account': 'Account', 'srch.s.help': 'Help' })[k] ?? k;
    const entries = [...screenEntries(title), ...modelEntries([model({ id: 'm/1', name: 'Sunrise Pro' })])];
    test('finds a screen by title, by a word in it, and by a synonym', () => {
        expect(searchEntries('account', entries)[0].href).toBe('/account');
        expect(searchEntries('secur', entries).some((e) => e.href === '/security')).toBe(true);
        expect(searchEntries('2fa', entries).map((e) => e.href)).toContain('/security');
    });
    test('every word must match; an empty or blank query finds nothing', () => {
        expect(searchEntries('account zzz', entries)).toEqual([]);
        expect(searchEntries('', entries)).toEqual([]);
        expect(searchEntries('   ', entries)).toEqual([]);
    });
    test('models open Create with an encoded id and ignore case and accents', () => {
        const r = searchEntries('SUNRISE', entries);
        expect(r[0].href).toBe('/create/m%2F1');
        expect(searchEntries('sünrise', entries)).toHaveLength(1);
        expect(searchEntries('Sunrise', entries)).toHaveLength(1);
    });
    test('results are capped and every screen href is a path', () => {
        const many = Array.from({ length: 50 }, (_, i) => ({ id: String(i), kind: 'model' as const, title: `Same ${i}`, detail: '', href: '/x', keywords: '' }));
        expect(searchEntries('same', many)).toHaveLength(MAX_RESULTS);
        expect(SCREENS.every((s) => s.href.startsWith('/'))).toBe(true);
    });
    test('Film Studio, Tools, Face Filters and MCP are searchable native screens', () => {
        for (const [query, href] of [['studio', '/film'], ['upscale', '/create/tools'], ['relight', '/face-filters'], ['connector', '/mcp']]) {
            expect(searchEntries(query, entries).map((entry) => entry.href)).toContain(href);
        }
    });
});
