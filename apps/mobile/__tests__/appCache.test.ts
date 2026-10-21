import { Directory, Paths } from 'expo-file-system';
import { bindCacheUser, createFileStorage, resetCacheUser, sweepUserDocs, userIdFromToken, wipeCache } from '../src/lib/appCache';
import { POLICIES, createCache, createMemoryStorage } from '../src/lib/cache';

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (sub: unknown) => `${b64({ alg: 'ES256' })}.${b64({ sub })}.sig`;

beforeEach(resetCacheUser);

describe('user id from the access token', () => {
    test('reads sub, and nothing else', () => {
        expect(userIdFromToken(token('u-1'))).toBe('u-1');
        expect(userIdFromToken(token(5))).toBeNull();
        expect(userIdFromToken('nonsense')).toBeNull();
        expect(userIdFromToken('a.%%%.c')).toBeNull();
    });
});

describe('wiping', () => {
    async function seeded() {
        const storage = createMemoryStorage();
        const cache = createCache(storage);
        await cache.write(POLICIES.library, ['mine'], 'u1');
        await cache.write(POLICIES.balance, { balance: 3 }, 'u1');
        await cache.write(POLICIES.catalog, [1]);
        return { storage, cache };
    }
    test('sign-out and account deletion (which signs out) wipe everything', async () => {
        const { storage, cache } = await seeded();
        await wipeCache(cache);
        expect(await storage.keys()).toEqual([]);
    });
    test('a different user signing in wipes the previous user\'s data', async () => {
        const { storage, cache } = await seeded();
        await bindCacheUser('u1', cache, storage); // first bind after a wipe-less start: unknown last user, so wipes
        await cache.write(POLICIES.library, ['mine'], 'u1');
        await bindCacheUser('u1', cache, storage); // same user: kept
        expect(await cache.read(POLICIES.library, 'u1')).not.toBeNull();
        await bindCacheUser('u2', cache, storage);
        expect(await cache.read(POLICIES.library, 'u1')).toBeNull();
    });
    test('a different user after an app restart is detected from the stored id', async () => {
        const storage = createMemoryStorage();
        const cache = createCache(storage);
        await bindCacheUser('u1', cache, storage);
        await cache.write(POLICIES.library, ['mine'], 'u1');
        resetCacheUser(); // new launch
        await bindCacheUser('u1', cache, storage);
        expect(await cache.read(POLICIES.library, 'u1')).not.toBeNull();
        resetCacheUser();
        await bindCacheUser('u2', cache, storage);
        expect(await cache.read(POLICIES.library, 'u1')).toBeNull();
    });
});

describe('file storage', () => {
    test('round-trips values, lists keys by their real names and removes', async () => {
        const storage = createFileStorage(() => new Directory(Paths.cache, 'test-cache'));
        await storage.set('veyrnox.cache.v1.library.u/1', '{"a":1}');
        expect(await storage.get('veyrnox.cache.v1.library.u/1')).toBe('{"a":1}');
        expect(await storage.keys()).toEqual(['veyrnox.cache.v1.library.u/1']);
        await storage.set('veyrnox.cache.v1.library.u/1', '{"a":2}');
        expect(await storage.get('veyrnox.cache.v1.library.u/1')).toBe('{"a":2}');
        await storage.remove('veyrnox.cache.v1.library.u/1');
        expect(await storage.get('veyrnox.cache.v1.library.u/1')).toBeNull();
        expect(await storage.keys()).toEqual([]);
    });
});

describe('durable user documents', () => {
    test('cold start with no cache marker preserves records owned by the same user', async () => {
        const docs = createMemoryStorage(), storage = createMemoryStorage(), cache = createCache(storage);
        const clear = jest.spyOn(cache, 'clear');
        await docs.set('draft', JSON.stringify({ owner: 'U' }));
        await bindCacheUser('U', cache, storage, docs);
        expect(await docs.get('draft')).not.toBeNull(); expect(clear).toHaveBeenCalledTimes(1);
        await bindCacheUser('U', cache, storage, docs);
        expect(await docs.get('draft')).not.toBeNull(); expect(clear).toHaveBeenCalledTimes(1);
    });
    test('switching users sweeps by each record, even without a cache marker', async () => {
        const docs = createMemoryStorage(), storage = createMemoryStorage(), cache = createCache(storage);
        await docs.set('u', JSON.stringify({ owner: 'U' }));
        await docs.set('v', JSON.stringify({ owner: 'V' }));
        await docs.set('broken', '{'); await docs.set('ownerless', '{}'); await docs.set('empty', '{"owner":""}');
        await bindCacheUser('V', cache, storage, docs);
        expect(await docs.keys()).toEqual(['v']);
        await wipeCache(cache, docs); expect(await docs.keys()).toEqual([]);
    });
});


test('same-user refresh does not sweep an unfinished draft write', async () => {
    const docs = createMemoryStorage(), storage = createMemoryStorage(), cache = createCache(storage);
    await bindCacheUser('U', cache, storage, docs);
    // File creation exposes an empty file until the asynchronous write completes.
    await docs.set('draft', '');
    const keys = jest.spyOn(docs, 'keys'), get = jest.spyOn(docs, 'get'), remove = jest.spyOn(docs, 'remove');
    await bindCacheUser('U', cache, storage, docs);
    expect(keys).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    expect(await docs.get('draft')).toBe('');
    await docs.set('draft', JSON.stringify({ owner: 'U' }));
    expect(await docs.get('draft')).toBe('{"owner":"U"}');
});
test('a failed read during a sweep preserves the record', async () => {
    const docs = createMemoryStorage();
    await docs.set('draft', JSON.stringify({ owner: 'U' }));
    const get = jest.spyOn(docs, 'get').mockRejectedValueOnce(new Error('read failed'));
    const remove = jest.spyOn(docs, 'remove');
    await sweepUserDocs('U', docs);
    expect(remove).not.toHaveBeenCalled();
    get.mockRestore(); expect(await docs.get('draft')).not.toBeNull();
});
test.each(['keys', 'remove'] as const)('a throwing sweep %s cannot reject account binding', async method => {
    const docs = createMemoryStorage(), storage = createMemoryStorage(), cache = createCache(storage);
    await docs.set('foreign', JSON.stringify({ owner: 'V' }));
    jest.spyOn(docs, method).mockRejectedValue(new Error('storage failed'));
    await expect(bindCacheUser('U', cache, storage, docs)).resolves.toBeUndefined();
});
