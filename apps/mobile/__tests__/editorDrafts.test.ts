import { bindCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { createCache, createMemoryStorage } from '../src/lib/cache';
import { readDraft, writeDraft } from '../src/lib/editorDrafts';
const storage = createMemoryStorage(), cacheStorage = createMemoryStorage(), cache = createCache(cacheStorage);
const document = { schema_version: 1 as const, project_id: 'p', brief: 'draft' };
const draft = { owner: 'u', projectId: 'p', baseRevision: 4, document, updatedAt: 1 };
beforeEach(async () => { resetCacheUser(); await wipeCache(cache, storage); await bindCacheUser('u', cache, cacheStorage, storage); });
test('round-trip per project and only the document record is persisted', async () => {
    expect(await writeDraft(draft, storage)).toBe(true);
    expect(await readDraft('p', storage)).toEqual(draft);
    expect(await readDraft('other', storage)).toBeNull();
    expect(JSON.parse((await storage.get('editor.draft.v1:p'))!)).toEqual(draft);
});
test('mismatched owner or project is removed', async () => {
    await storage.set('editor.draft.v1:p', JSON.stringify({ ...draft, owner: 'other' }));
    expect(await readDraft('p', storage)).toBeNull(); expect(await storage.keys()).toEqual([]);
    await storage.set('editor.draft.v1:p', JSON.stringify({ ...draft, projectId: 'other' }));
    expect(await readDraft('p', storage)).toBeNull(); expect(await storage.keys()).toEqual([]);
});
test('wipe removes durable drafts', async () => {
    await writeDraft(draft, storage); await wipeCache(cache, storage);
    expect(await storage.keys()).toEqual([]);
});
test('disk failure returns false, never a false promise of recovery', async () => {
    expect(await writeDraft(draft, { ...storage, set: async () => { throw new Error('full'); } })).toBe(false);
});
test('account changes during a write cannot resurrect the departed user’s draft', async () => {
    expect(await writeDraft(draft, { ...storage, set: async (key, value) => { resetCacheUser(); await storage.set(key, value); } })).toBe(false);
    expect(await storage.keys()).toEqual([]);
});
