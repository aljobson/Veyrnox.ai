import { bindCacheUser, getCacheUser, resetCacheUser, subscribeCacheUser, wipeCache } from '../src/lib/appCache';
import { createCache, createMemoryStorage, POLICIES } from '../src/lib/cache';
const USER = 'veyrnox.cache.v1.__user';
function deferred<T = void>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(resetCacheUser);
function setup() { const storage = createMemoryStorage(), docs = createMemoryStorage(); return { storage, docs, cache: createCache(storage) }; }
test('bind A paused reading the marker cannot take ownership after B', async () => {
    const { storage, docs, cache } = setup(), gate = deferred<string | null>();
    jest.spyOn(storage, 'get').mockReturnValueOnce(gate.promise);
    const seen: (string | undefined)[] = [], unsub = subscribeCacheUser(() => seen.push(getCacheUser()));
    const a = bindCacheUser('A', cache, storage, docs);
    await bindCacheUser('B', cache, storage, docs); await docs.set('b', '{"owner":"B"}'); await cache.write(POLICIES.library, ['B'], 'B');
    gate.resolve(null); await a; unsub();
    expect(getCacheUser()).toBe('B'); expect(seen.at(-1)).toBe('B'); expect(await storage.get(USER)).toBe('B');
    expect(await docs.get('b')).not.toBeNull(); expect(await cache.read(POLICIES.library, 'B')).not.toBeNull();
});
test('bind A paused inside a sweep cannot remove B documents', async () => {
    const { storage, docs, cache } = setup(), gate = deferred<string | null>(); await docs.set('b', '{"owner":"B"}');
    jest.spyOn(docs, 'get').mockReturnValueOnce(gate.promise);
    const a = bindCacheUser('A', cache, storage, docs); await tick();
    await bindCacheUser('B', cache, storage, docs); gate.resolve('{"owner":"B"}'); await a;
    expect(await docs.get('b')).not.toBeNull(); expect(await storage.get(USER)).toBe('B');
});
test('wipe paused listing documents cannot remove them after B binds', async () => {
    const { storage, docs, cache } = setup(), gate = deferred<string[]>();
    jest.spyOn(docs, 'keys').mockReturnValueOnce(gate.promise);
    const a = wipeCache(cache, docs); await tick(); await bindCacheUser('B', cache, storage, docs); await docs.set('b', '{"owner":"B"}');
    gate.resolve(['b']); await a; expect(await docs.get('b')).not.toBeNull();
});
test.each(['bind', 'wipe'])('%s paused inside cache clear preserves B marker and entries', async action => {
    const { storage, docs, cache } = setup(), gate = deferred();
    const keys = storage.keys; jest.spyOn(storage, 'keys').mockImplementationOnce(async () => { await gate.promise; return keys(); });
    const a = action === 'bind' ? bindCacheUser('A', cache, storage, docs) : wipeCache(cache, docs); await tick();
    await bindCacheUser('B', cache, storage, docs); await cache.write(POLICIES.library, ['B'], 'B');
    gate.resolve(); await a;
    expect(getCacheUser()).toBe('B'); expect(await storage.get(USER)).toBe('B'); expect(await cache.read(POLICIES.library, 'B')).not.toBeNull();
});
test('clear checks liveness after keys and defaults to clearing everything', async () => {
    const { storage, cache } = setup(), gate = deferred<string[]>(); let live = true;
    await cache.write(POLICIES.library, ['B'], 'B'); const keys = await storage.keys();
    jest.spyOn(storage, 'keys').mockReturnValueOnce(gate.promise);
    const run = cache.clear(() => live); live = false; gate.resolve(keys); await run;
    expect(await storage.keys()).toEqual(keys); await cache.clear(); expect(await storage.keys()).toEqual([]);
});
test('clear checks liveness before each parallel removal', async () => {
    const { storage, cache } = setup(); let live = true;
    await cache.write(POLICIES.library, [], 'A'); await cache.write(POLICIES.library, [], 'B');
    const remove = storage.remove;
    jest.spyOn(storage, 'remove').mockImplementation(async key => { live = false; await remove(key); });
    await cache.clear(() => live); expect(await cache.read(POLICIES.library, 'B')).not.toBeNull();
});
