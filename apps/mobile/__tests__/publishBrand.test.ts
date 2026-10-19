import { ApiError, type ApiClient } from '../src/lib/api';
import {
    BRAND_HEADER,
    brandStore,
    fetchBrands,
    parseBrands,
    reconcileBrand,
    roleLabel,
    withBrand,
} from '../src/lib/publishBrand';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

const fakeApi = () => {
    const request = jest.fn(async (_p: string, _i?: RequestInit) => ({ ok: true }));
    const stream = jest.fn(async () => new Response(''));
    return { api: { request, stream, getBalance: jest.fn() } as unknown as ApiClient, request, stream };
};
const headersOf = (r: jest.Mock, i = 0) => ((r.mock.calls[i][1] as RequestInit | undefined)?.headers ?? {}) as Record<string, string>;

beforeEach(() => brandStore.set(null));

describe('parseBrands', () => {
    test('keeps id, label, role, timezone and paid; drops rows without a valid id or role', () => {
        const rows = parseBrands({
            brands: [
                { id: ID_A, label: 'Studio', timezone: 'Europe/London', role: 'owner', paid: true },
                { id: 'nope', label: 'Bad id', role: 'owner' },
                { id: ID_B, label: 'Client', role: 'wizard' },
                { id: ID_B, label: 'Client', timezone: 'UTC', role: 'editor', paid: false },
                'junk',
            ],
        });
        expect(rows.map((b) => [b.id, b.role, b.paid])).toEqual([[ID_A, 'owner', true], [ID_B, 'editor', false]]);
    });
    test.each([[null], [undefined], [{}], [{ brands: 'x' }], [[]]])('%p gives an empty list', (body) => {
        expect(parseBrands(body)).toEqual([]);
    });
    test('a missing label gets a plain fallback and a long label is bounded', () => {
        const [a, b] = parseBrands({ brands: [{ id: ID_A, role: 'owner' }, { id: ID_B, role: 'owner', label: 'x'.repeat(500) }] });
        expect(a?.label).toBe('Brand');
        expect(b?.label.length).toBeLessThanOrEqual(60);
    });
});

describe('roles', () => {
    test('role labels are plain words', () => {
        expect(roleLabel('owner')).toBe('Owner');
        expect(roleLabel('viewer')).toBe('Viewer');
    });
});

describe('the selected brand', () => {
    test('is shared, notifies listeners, and stops notifying after unsubscribe', () => {
        const seen: (string | null)[] = [];
        const off = brandStore.subscribe(() => seen.push(brandStore.get()));
        brandStore.set(ID_A);
        brandStore.set(ID_A);
        brandStore.set(null);
        off();
        brandStore.set(ID_B);
        expect(seen).toEqual([ID_A, null]);
    });
    test('only a well-formed id can be selected', () => {
        brandStore.set('../../etc');
        expect(brandStore.get()).toBeNull();
    });
    test('a selection that is no longer in the list is cleared; a valid one is kept', () => {
        const brands = parseBrands({ brands: [{ id: ID_A, label: 'A', role: 'owner' }] });
        brandStore.set(ID_B);
        expect(reconcileBrand(brands)).toBeNull();
        expect(brandStore.get()).toBeNull();
        brandStore.set(ID_A);
        expect(reconcileBrand(brands)).toBe(ID_A);
    });
});

describe('withBrand', () => {
    test('adds the brand header to Publish calls only, and keeps the caller headers', async () => {
        const { api, request } = fakeApi();
        brandStore.set(ID_B);
        const wrapped = withBrand(api);
        await wrapped.request('/api/v1/social/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        await wrapped.request('/api/v1/balance');
        expect(headersOf(request, 0)).toEqual({ 'Content-Type': 'application/json', [BRAND_HEADER]: ID_B });
        expect(headersOf(request, 1)[BRAND_HEADER]).toBeUndefined();
    });
    test('adds nothing while no brand is chosen, so the server uses the person\'s own', async () => {
        const { api, request } = fakeApi();
        await withBrand(api).request('/api/v1/social/accounts');
        expect(headersOf(request)[BRAND_HEADER]).toBeUndefined();
    });
    test('reads the choice at call time, not when wrapped', async () => {
        const { api, request } = fakeApi();
        const wrapped = withBrand(api);
        brandStore.set(ID_A);
        await wrapped.request('/api/v1/social/posts');
        expect(headersOf(request)[BRAND_HEADER]).toBe(ID_A);
    });
    test('the brand list itself is never sent with a brand header', async () => {
        const { api, request } = fakeApi();
        brandStore.set(ID_A);
        await withBrand(api).request('/api/v1/social/brands');
        expect(headersOf(request)[BRAND_HEADER]).toBeUndefined();
    });
    test('other client methods pass through', () => {
        const { api } = fakeApi();
        const wrapped = withBrand(api);
        expect(wrapped.getBalance).toBe(api.getBalance);
    });
});

describe('fetchBrands', () => {
    test('reads /api/v1/social/brands and parses it', async () => {
        const { api, request } = fakeApi();
        request.mockResolvedValueOnce({ brands: [{ id: ID_A, label: 'A', role: 'owner' }] } as never);
        expect((await fetchBrands(api)).map((b) => b.id)).toEqual([ID_A]);
        expect(request.mock.calls[0][0]).toBe('/api/v1/social/brands');
    });
    test('teams not open (404) means no brands, not an error', async () => {
        const { api, request } = fakeApi();
        request.mockRejectedValueOnce(new ApiError(404, 'teams_not_open', { error: 'teams_not_open' }));
        expect(await fetchBrands(api)).toEqual([]);
    });
    test('other errors are passed on', async () => {
        const { api, request } = fakeApi();
        request.mockRejectedValueOnce(new ApiError(502, 'internal', { error: 'internal' }));
        await expect(fetchBrands(api)).rejects.toMatchObject({ status: 502 });
    });
});
