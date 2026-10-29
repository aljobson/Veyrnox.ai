import { bindCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { createCache, createMemoryStorage, type CacheStorage } from '../src/lib/cache';
import { addPending, markPlaced, readPending, removePending } from '../src/lib/editorGenerationReturns';

const storage = createMemoryStorage(), cacheStorage = createMemoryStorage(), cache = createCache(cacheStorage);
const slot = 'editor.generated.v1:p';
const job = (n = 1) => ({ jobId: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`, kind: 'video' as const, frame: 24, name: 'Result', createdAt: Date.now() });
beforeEach(async () => { resetCacheUser(); await wipeCache(cache, storage); await bindCacheUser('u', cache, cacheStorage, storage); });

test('add, read and remove a pending result', async () => {
    const item = job();
    await addPending('p', item, storage);
    expect(await readPending('p', storage)).toEqual([{ ...item, placed: false }]);
    await removePending('p', item.jobId, storage);
    expect(await readPending('p', storage)).toEqual([]);
    expect(await storage.get(slot)).toBeNull();
});
test('deduplicates job ids and retains delivery history', async () => {
    const item = job();
    await addPending('p', item, storage);
    await markPlaced('p', item.jobId, storage);
    await addPending('p', item, storage);
    expect(await readPending('p', storage)).toEqual([{ ...item, placed: true }]);
});
test('keeps the newest ten', async () => {
    const now = Date.now();
    for (let n = 0; n < 12; n++) await addPending('p', { ...job(n), createdAt: now - n }, storage);
    expect((await readPending('p', storage)).map(item => item.jobId)).toEqual(Array.from({ length: 10 }, (_, n) => job(n).jobId));
});
test.each([{ owner: 'other', projectId: 'p' }, { owner: 'u', projectId: 'other' }])('removes another owner or project record: %j', async fields => {
    await storage.set(slot, JSON.stringify({ ...fields, items: [job()] }));
    expect(await readPending('p', storage)).toEqual([]);
    expect(await storage.get(slot)).toBeNull();
});
test('missing placed reads false and markPlaced persists true; a missing item is a no-op', async () => {
    const item = job();
    await storage.set(slot, JSON.stringify({ owner: 'u', projectId: 'p', items: [item] }));
    expect((await readPending('p', storage))[0].placed).toBe(false);
    await markPlaced('p', item.jobId, storage);
    await markPlaced('p', job(2).jobId, storage);
    expect(await readPending('p', storage)).toEqual([{ ...item, placed: true }]);
});
test.each([{ jobId: 'invalid' }, { frame: -1 }, { frame: 18000 }, { frame: 0.5 }])('drops invalid values: %j', async patch => {
    await addPending('p', { ...job(), ...patch }, storage);
    expect(await readPending('p', storage)).toEqual([]);
});
test('drops items older than 24 hours', async () => {
    const item = job();
    await addPending('p', item, storage);
    expect(await readPending('p', storage, item.createdAt + 86400001)).toEqual([]);
    expect(await storage.get(slot)).toBeNull();
});
test('parallel adds keep both jobs', async () => {
    await Promise.all([addPending('p', job(1), storage), addPending('p', job(2), storage)]);
    expect(await readPending('p', storage)).toHaveLength(2);
});
test('no owner writes nothing', async () => {
    resetCacheUser();
    await addPending('p', job(), storage);
    expect(await storage.get(slot)).toBeNull();
});
test('an owner change during the write removes the record', async () => {
    await addPending('p', job(), { ...storage, set: async (key, value) => { resetCacheUser(); await storage.set(key, value); } });
    expect(await storage.get(slot)).toBeNull();
});
test('unreadable records are removed and storage failures stay quiet', async () => {
    await storage.set(slot, '{');
    expect(await readPending('p', storage)).toEqual([]);
    expect(await storage.get(slot)).toBeNull();
    const failed: CacheStorage = { ...storage, get: async () => { throw new Error('disk'); }, set: async () => { throw new Error('disk'); }, remove: async () => { throw new Error('disk'); } };
    await expect(addPending('p', job(), failed)).resolves.toBeUndefined();
    await expect(readPending('p', failed)).resolves.toEqual([]);
    await expect(markPlaced('p', job().jobId, failed)).resolves.toBeUndefined();
    await expect(removePending('p', job().jobId, failed)).resolves.toBeUndefined();
});

test('a failed read cannot overwrite existing durable jobs during add', async () => {
    await addPending('p', job(1), storage);
    await addPending('p', job(2), { ...storage, get: async () => { throw new Error('disk'); } });
    expect((await readPending('p', storage)).map(item => item.jobId)).toEqual([job(1).jobId]);
});
test('a queued acknowledgement rechecks readiness before writing', async () => {
    await addPending('p', job(), storage);
    let current = true;
    const removal = removePending('p', job().jobId, storage, () => current);
    current = false; await removal;
    expect(await readPending('p', storage)).toHaveLength(1);
});
