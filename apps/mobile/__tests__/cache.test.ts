import { POLICIES, formatAge, createCache, createMemoryStorage } from '../src/lib/cache';

function setup() {
    const storage = createMemoryStorage();
    let time = 1_000_000;
    const cache = createCache(storage, () => time);
    return { storage, cache, advance: (ms: number) => void (time += ms) };
}

test('balance and Library always refetch but show the saved copy first', async () => {
    const storage = createMemoryStorage();
    const cache = createCache(storage, () => 5000);
    await cache.write(POLICIES.balance, { balance: 1 }, 'u1');
    const seen: unknown[] = [];
    await cache.swr({ policy: POLICIES.balance, userId: 'u1', fetcher: async () => ({ balance: 2 }), onData: (v) => seen.push(v) });
    expect(seen).toEqual([{ balance: 1 }, { balance: 2 }]);
});

test('formats the age of a saved copy', () => {
    expect(formatAge(5_000)).toBe('');
    expect(formatAge(5 * 60_000)).toBe('5 min');
    expect(formatAge(3 * 3_600_000)).toBe('3 h');
    expect(formatAge(2 * 86_400_000)).toBe('2 d');
});

describe('cache', () => {
    test('a miss fetches, stores and reports a live value', async () => {
        const { cache } = setup();
        const seen: unknown[] = [];
        const fetcher = jest.fn(async () => ({ balance: 5 }));
        const out = await cache.swr({ policy: POLICIES.balance, userId: 'u1', fetcher, onData: (v, m) => seen.push([v, m.fromCache]) });
        expect(out.value).toEqual({ balance: 5 });
        expect(out.meta.fromCache).toBe(false);
        expect(seen).toEqual([[{ balance: 5 }, false]]);
    });

    test('a fresh copy is used without a fetch', async () => {
        const { cache, advance } = setup();
        await cache.write(POLICIES.catalog, [5]);
        advance(10_000);
        const fetcher = jest.fn(async () => [9]);
        const out = await cache.swr({ policy: POLICIES.catalog, fetcher });
        expect(fetcher).not.toHaveBeenCalled();
        expect(out.value).toEqual([5]);
        expect(out.meta.stale).toBe(false);
    });

    test('a stale copy is shown first, then replaced by the fresh value', async () => {
        const { cache, advance } = setup();
        await cache.write(POLICIES.library, ['a'], 'u1');
        advance(POLICIES.library.freshMs + 1);
        const seen: Array<[unknown, boolean, boolean]> = [];
        const out = await cache.swr({
            policy: POLICIES.library, userId: 'u1', fetcher: async () => ['a', 'b'],
            onData: (v, m) => seen.push([v, m.fromCache, m.stale]),
        });
        expect(seen).toEqual([[['a'], true, true], [['a', 'b'], false, false]]);
        expect(out.value).toEqual(['a', 'b']);
    });

    test('offline with a saved copy returns it labelled stale; with none it throws', async () => {
        const { cache, advance } = setup();
        const offline = async () => { throw new Error('network'); };
        await expect(cache.swr({ policy: POLICIES.catalog, fetcher: offline })).rejects.toThrow('network');
        await cache.write(POLICIES.catalog, [1], undefined);
        advance(POLICIES.catalog.freshMs + 1);
        const out = await cache.swr({ policy: POLICIES.catalog, fetcher: offline });
        expect(out.value).toEqual([1]);
        expect(out.meta).toMatchObject({ fromCache: true, stale: true });
    });

    test('a copy past its max age is discarded', async () => {
        const { cache, advance, storage } = setup();
        await cache.write(POLICIES.balance, { balance: 1 }, 'u1');
        advance(POLICIES.balance.maxAgeMs + 1);
        expect(await cache.read(POLICIES.balance, 'u1')).toBeNull();
        expect(await storage.keys()).toEqual([]);
    });

    test('per-user data is keyed by user and never stored without one', async () => {
        const { cache, storage } = setup();
        await cache.write(POLICIES.library, ['mine'], 'u1');
        expect(await cache.read(POLICIES.library, 'u2')).toBeNull();
        await cache.write(POLICIES.library, ['anon']);
        expect(await cache.read(POLICIES.library)).toBeNull();
        expect(await storage.keys()).toHaveLength(1);
    });

    test('corrupt stored data is a miss', async () => {
        const { cache, storage } = setup();
        await storage.set('veyrnox.cache.v1.catalog', '{not json');
        expect(await cache.read(POLICIES.catalog)).toBeNull();
        expect(await storage.keys()).toEqual([]);
    });

    test('a failing disk does not break the live path', async () => {
        const cache = createCache({ get: async () => { throw new Error('io'); }, set: async () => { throw new Error('io'); }, remove: async () => undefined, keys: async () => [] });
        const out = await cache.swr({ policy: POLICIES.catalog, fetcher: async () => [2] });
        expect(out.value).toEqual([2]);
    });

    test('clear removes every saved copy and nothing else', async () => {
        const { cache, storage } = setup();
        await cache.write(POLICIES.balance, { balance: 1 }, 'u1');
        await cache.write(POLICIES.catalog, [1]);
        await storage.set('other.key', 'keep');
        await cache.clear();
        expect(await storage.keys()).toEqual(['other.key']);
    });
});
