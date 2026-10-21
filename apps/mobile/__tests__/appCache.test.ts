import { Directory, Paths } from 'expo-file-system';
import { bindCacheUser, clearExportFiles, createFileStorage, exportDirectory, resetCacheUser, userIdFromToken, wipeCache } from '../src/lib/appCache';
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

describe('export file cleanup', () => {
    test('a delete that throws is ignored, and the cache is still cleared', async () => {
        exportDirectory().create({ intermediates: true, idempotent: true });
        const failing = jest.spyOn(Directory.prototype, 'delete').mockImplementation(() => { throw new Error('io'); });
        try {
            expect(() => clearExportFiles()).not.toThrow();
            const storage = createMemoryStorage(), cache = createCache(storage);
            await cache.write(POLICIES.library, ['mine'], 'u1');
            await wipeCache(cache);
            expect(await storage.keys()).toEqual([]);
            await bindCacheUser('u1', cache, storage);
            await cache.write(POLICIES.library, ['mine'], 'u1');
            await bindCacheUser('u2', cache, storage);
            expect(await cache.read(POLICIES.library, 'u1')).toBeNull();
            expect(failing).toHaveBeenCalled();
        } finally {
            failing.mockRestore();
            clearExportFiles();
        }
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
