jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: () => `uuid-key-${++n}` }; });
import { bindCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { createCache, type CacheStorage } from '../src/lib/cache';
import { claimLegacyOddlings, createOddlingsStore, LEGACY_MARKER, switchLink } from '../src/lib/oddlingsAccountStore';
const memory = (): CacheStorage => {
    const data = new Map<string, string>();
    return { get: async k => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); }, remove: async k => { data.delete(k); }, keys: async () => [...data.keys()] };
};
let docs: CacheStorage, app: CacheStorage, store: ReturnType<typeof createOddlingsStore>;
let text: string | null, marker: string | null;
const file = { exists: () => text !== null, read: jest.fn(async () => text), remove: jest.fn(async () => { text = null; }) };
const secure = { get: jest.fn(async () => marker), set: jest.fn(async (_key: string, value: string) => { marker = value; }) };
const adopt = (id: string) => bindCacheUser(id, createCache(app), app, docs);
beforeEach(async () => {
    resetCacheUser(); docs = memory(); app = memory(); store = createOddlingsStore(docs); marker = null;
    text = JSON.stringify({ version: 1, items: [{ id: 'old', savedAt: 1, picks: { oddling_name: 'Legacy' } }], draft: null });
    file.read.mockClear(); file.remove.mockReset().mockImplementation(async () => { text = null; });
    secure.set.mockReset().mockImplementation(async (_k, v) => { marker = v; }); secure.get.mockClear(); await adopt('A');
});
test('claims once; token refresh preserves newer saves and project link', async () => {
    await claimLegacyOddlings('A', store, file, secure);
    await store.save({ oddling_name: 'New' }, 2);
    await store.mutate(r => ({ ...r, projectId: 'P' }));
    await claimLegacyOddlings('A', store, file, secure);
    expect((await store.read())?.local.items).toHaveLength(2); expect((await store.read())?.projectId).toBe('P');
    expect(marker).toBe('done:A'); expect(text).toBeNull();
    await adopt('B'); await claimLegacyOddlings('B', store, file, secure); expect(await store.read()).toBeNull();
});
test('unwritable marker fails closed for every account and does not read the file', async () => {
    secure.set.mockRejectedValue(new Error('unavailable'));
    await claimLegacyOddlings('A', store, file, secure);
    await adopt('B'); await claimLegacyOddlings('B', store, file, secure);
    expect(file.read).not.toHaveBeenCalled(); expect(file.remove).not.toHaveBeenCalled(); expect(await store.read()).toBeNull();
    secure.set.mockImplementation(async (_k, v) => { marker = v; });
    await claimLegacyOddlings('B', store, file, secure); expect(marker).toBe('done:B');
});
test('failed delete, wipe and restart never give the file to B', async () => {
    file.remove.mockRejectedValue(new Error('busy'));
    await claimLegacyOddlings('A', store, file, secure);
    await wipeCache(createCache(app), docs); store = createOddlingsStore(docs); await adopt('B'); file.read.mockClear();
    await claimLegacyOddlings('B', store, file, secure);
    expect(file.read).not.toHaveBeenCalled(); expect(await store.read()).toBeNull();
});
test('interrupted finish resumes only for A, without duplicate imports', async () => {
    file.remove.mockRejectedValue(new Error('busy'));
    secure.set.mockImplementation(async (_k, v) => { if (v.startsWith('done:')) throw new Error('crash'); marker = v; });
    await expect(claimLegacyOddlings('A', store, file, secure)).rejects.toThrow('crash');
    expect(marker).toBe('claiming:A');
    await adopt('B'); file.read.mockClear(); await claimLegacyOddlings('B', store, file, secure); expect(file.read).not.toHaveBeenCalled();
    await adopt('A'); secure.set.mockImplementation(async (_k, v) => { marker = v; });
    await claimLegacyOddlings('A', store, file, secure); await claimLegacyOddlings('A', store, file, secure);
    expect((await store.read())?.local.items).toHaveLength(1);
});
test('resume merges into existing applied record and leaves pending operations intact', async () => {
    file.remove.mockRejectedValue(new Error('busy'));
    secure.set.mockImplementation(async (_k, v) => { if (v.startsWith('done:')) throw new Error('crash'); marker = v; });
    await expect(claimLegacyOddlings('A', store, file, secure)).rejects.toThrow();
    await store.save({ oddling_name: 'New' }, 2);
    secure.set.mockImplementation(async (_k, v) => { marker = v; });
    await claimLegacyOddlings('A', store, file, secure);
    expect((await store.read())?.local.items).toHaveLength(2); expect((await store.read())?.ops).toHaveLength(2);
});
test('no file writes no marker', async () => {
    text = null; await claimLegacyOddlings('A', store, file, secure);
    expect(secure.get).toHaveBeenCalledWith(LEGACY_MARKER); expect(secure.set).not.toHaveBeenCalled();
});

test('adopted legacy draft stays pending when linking a project with a different draft', async () => {
    const draft = { savedAt: 1, picks: { oddling_name: 'Legacy draft' } };
    text = JSON.stringify({ version: 1, items: [], draft });
    await claimLegacyOddlings('A', store, file, secure);
    const claimed = await store.read();
    await store.mutate(r => switchLink(r, 'P', { items: [], draft: { savedAt: 2, picks: { oddling_name: 'Server draft' } } }, 1));
    expect(claimed?.ops).toEqual([expect.objectContaining({ kind: 'draft' })]);
    expect((await store.read())?.local.draft).toEqual(draft);
    expect((await store.read())?.ops).toEqual(claimed?.ops);
    await claimLegacyOddlings('A', store, file, secure);
    expect((await store.read())?.ops).toEqual(claimed?.ops);
});
test('legacy claim preserves an existing local draft and its generation', async () => {
    await store.draft({ oddling_name: 'Current draft' }, 2);
    const before = await store.read();
    text = JSON.stringify({ version: 1, items: [], draft: { savedAt: 1, picks: { oddling_name: 'Legacy draft' } } });
    await claimLegacyOddlings('A', store, file, secure);
    expect((await store.read())?.local.draft).toEqual(before?.local.draft);
    expect((await store.read())?.ops).toEqual(before?.ops);
});
