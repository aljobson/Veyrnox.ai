import type { ApiClient } from '../src/lib/api';
import { fetchFreeAllowance, freeLines } from '../src/lib/freeAllowance';

const apiWith = (result: unknown) => ({ request: jest.fn(async () => result) }) as unknown as ApiClient;

describe('fetchFreeAllowance', () => {
    test('disabled means nothing, whatever left says', async () => {
        expect(await fetchFreeAllowance(apiWith({ enabled: false, left: { a: 3 } }))).toEqual({});
        expect(await fetchFreeAllowance(apiWith({}))).toEqual({});
    });

    test('keeps only positive whole numbers', async () => {
        expect(await fetchFreeAllowance(apiWith({ enabled: true, left: { a: 3, b: 0, c: -1, d: 1.5, e: '2' } }))).toEqual({ a: 3 });
        expect(await fetchFreeAllowance(apiWith({ enabled: true, left: [1] }))).toEqual({});
        expect(await fetchFreeAllowance(apiWith({ enabled: true, left: null }))).toEqual({});
    });
});

describe('freeLines', () => {
    const models = [{ id: 'a', name: 'Model A' }, { id: 'b', name: 'Model B' }, { id: 'c', name: 'Model C' }];
    test('names the model and how many are left, singular and plural', () => {
        expect(freeLines({ a: 3, b: 1 }, models)).toEqual(['Model A: 3 free runs left today', 'Model B: 1 free run left today']);
    });
    test('skips models not in the catalog and shows nothing when empty', () => {
        expect(freeLines({ zzz: 2 }, models)).toEqual([]);
        expect(freeLines({}, models)).toEqual([]);
    });
    test('caps the list', () => {
        const many = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, name: `M${i}` }));
        expect(freeLines(Object.fromEntries(many.map((m) => [m.id, 1])), many)).toHaveLength(5);
    });
});
