jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: () => `uuid-key-${++n}` }; });
import { bindCacheUser, getCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { createCache, type CacheStorage } from '../src/lib/cache';
import { createOddlingsStore, ODDLINGS_KEY } from '../src/lib/oddlingsAccountStore';
const memory = (): CacheStorage => {
    const data = new Map<string, string>();
    return { get: async k => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); }, remove: async k => { data.delete(k); }, keys: async () => [...data.keys()] };
};
let docs: CacheStorage, storage: CacheStorage, store: ReturnType<typeof createOddlingsStore>;
beforeEach(async () => { resetCacheUser(); docs = memory(); storage = memory(); store = createOddlingsStore(docs); await bindCacheUser('A', createCache(storage), storage, docs); });
test('account mismatch reads null and removes the record', async () => {
    await store.save({ oddling_name: 'A' }, 1);
    resetCacheUser();
    expect(await store.read()).toBeNull(); expect(await docs.get(ODDLINGS_KEY)).toBeNull();
});
test('real adoption sweep and session wipe remove durable records', async () => {
    await store.save({ oddling_name: 'A' }, 1);
    await bindCacheUser('B', createCache(storage), storage, docs);
    expect(await store.read()).toBeNull();
    await store.save({ oddling_name: 'B' }, 2);
    await wipeCache(createCache(storage), docs);
    expect(await docs.keys()).toEqual([]); expect(getCacheUser()).toBeUndefined();
});
test('a user change during storage.set undoes the write', async () => {
    const set = docs.set;
    docs.set = async (k, v) => { await set(k, v); resetCacheUser(); };
    expect((await store.save({ oddling_name: 'A' }, 1)).ok).toBe(false);
    expect(await docs.get(ODDLINGS_KEY)).toBeNull();
});
test('concurrent writes, including separate store instances, lose neither mutation', async () => {
    const other = createOddlingsStore(docs);
    await Promise.all([store.save({ oddling_name: 'A' }, 1), other.save({ oddling_name: 'B' }, 2)]);
    expect((await store.read())?.local.items.map(i => i.name)).toEqual(['B', 'A']);
    expect((await store.read())?.ops.map(o => o.gen)).toEqual([1, 2]);
});
test('queued writes from a lost session cannot repopulate a newly adopted account', async () => {
    let release!: () => void;
    const set = docs.set;
    docs.set = async (k, v) => { await new Promise<void>(r => { release = r; }); await set(k, v); };
    const first = store.save({ oddling_name: 'A' }, 1);
    const second = store.save({ oddling_name: 'A2' }, 2);
    while (!release) await Promise.resolve();
    resetCacheUser(); release();
    await Promise.all([first, second]); expect(await docs.keys()).toEqual([]);
});
