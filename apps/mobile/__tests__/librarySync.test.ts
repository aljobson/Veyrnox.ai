import type { ApiClient } from '../src/lib/api';
import { clearRemoteDraft, fetchLibrarySync, fromSharedDraft, pushDraft, pushFavourite, reconcileFavourites, toSharedDraft } from '../src/lib/librarySync';
import { clearDraft, loadDraft, saveDraft } from '../src/lib/createDraftStore';
import { createCache, createMemoryStorage } from '../src/lib/cache';
import { readFavourites, writeFavourites } from '../src/lib/libraryView';
import { SAVED_DRAFT_VERSION, type CreateDraft } from '../src/lib/createOptions';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const local: CreateDraft = { v: SAVED_DRAFT_VERSION, modelId: 'veo-3', prompt: 'a red fox', duration: 8, aspect: '16:9', count: 2, seed: '42', negative: 'blur', voice: 'v1', audioSeconds: '3', cinemaOn: true, characterOn: true };
const api = (reply: (path: string, init?: RequestInit) => unknown) => {
    const calls: { path: string; init?: RequestInit }[] = [];
    const request = async (path: string, init?: RequestInit) => { calls.push({ path, init }); return reply(path, init); };
    return { calls, request } as unknown as Pick<ApiClient, 'request'> & { calls: typeof calls };
};
const off = () => api(() => { throw Object.assign(new Error('not_found'), { status: 404 }); });

describe('shared draft', () => {
    test('carries words and settings only, as the web reads them', () => {
        expect(toSharedDraft(local)).toEqual({ v: 1, modelId: 'veo-3', prompt: 'a red fox', duration: 8, aspect: '16:9', count: 2, seed: '42', negative: 'blur', voice: 'v1' });
    });
    test('an empty form shares nothing', () => expect(toSharedDraft({ ...local, prompt: ' ', seed: '', negative: '', voice: '' })).toBeNull());
    test('reads back only for the model of the screen, with the phone-only settings off', () => {
        const back = fromSharedDraft({ v: 1, modelId: 'veo-3', prompt: 'hi', duration: 5, aspect: '9:16', count: 1, seed: '', negative: '', voice: '' }, 'veo-3');
        expect(back).toMatchObject({ modelId: 'veo-3', prompt: 'hi', duration: 5, aspect: '9:16', cinemaOn: false, characterOn: false });
        expect(fromSharedDraft({ v: 1, modelId: 'veo-3', prompt: 'hi' }, 'other')).toBeNull();
        expect(fromSharedDraft({ v: 2, modelId: 'veo-3', prompt: 'hi' }, 'veo-3')).toBeNull();
        expect(fromSharedDraft(null, 'veo-3')).toBeNull();
    });
});

describe('account requests', () => {
    test('a failing or refused server is "unavailable" and never throws', async () => {
        expect(await fetchLibrarySync(off())).toEqual({ kind: 'unavailable' });
        expect(await pushFavourite(off(), A, true)).toBe(false);
        expect(await pushDraft(off(), toSharedDraft(local)!)).toBe(false);
        expect(await clearRemoteDraft(off())).toBe(false);
    });
    test('the read is checked and ids and words never go in the address', async () => {
        const out = await fetchLibrarySync(api(() => ({ favourites: [A, 'x', 7], draft: { v: 1, modelId: 'veo-3', prompt: 'p' }, draft_updated_at: '2026-11-13T10:00:00Z' })));
        expect(out).toEqual({ kind: 'ok', favourites: [A], draft: { v: 1, modelId: 'veo-3', prompt: 'p' }, draftUpdatedAt: Date.parse('2026-11-13T10:00:00Z') });
        const a = api(() => ({}));
        await pushFavourite(a, A, false); await pushDraft(a, toSharedDraft(local)!); await clearRemoteDraft(a);
        expect(a.calls.map((c) => [c.path, c.init?.method])).toEqual([['/api/v1/library-sync/favourites', 'PUT'], ['/api/v1/library-sync/draft', 'PUT'], ['/api/v1/library-sync/draft', 'DELETE']]);
        expect(JSON.parse(String(a.calls[0].init?.body))).toEqual({ job_id: A, starred: false });
        for (const c of a.calls) expect(/fox|veo|1111/.test(c.path)).toBe(false);
    });
});

describe('favourites follow the account', () => {
    test('first sync keeps what only this phone starred and hands it back to upload', async () => {
        const cache = createCache(createMemoryStorage());
        await writeFavourites(cache, 'u1', [A]);
        const out = await reconcileFavourites(cache, 'u1', [B]);
        expect(out.upload).toEqual([A]);
        expect([...out.ids].sort()).toEqual([A, B].sort());
        expect((await readFavourites(cache, 'u1')).sort()).toEqual([A, B].sort());
    });
    test('later syncs: the account list wins, so an unstar elsewhere holds', async () => {
        const cache = createCache(createMemoryStorage());
        await writeFavourites(cache, 'u1', [A]);
        await reconcileFavourites(cache, 'u1', [A]);
        const out = await reconcileFavourites(cache, 'u1', [C]);
        expect(out).toEqual({ ids: [C], upload: [] });
        expect(await readFavourites(cache, 'u1')).toEqual([C]);
    });
    test('per account: another user on this phone is untouched, and no user means nothing is read or written', async () => {
        const cache = createCache(createMemoryStorage());
        await writeFavourites(cache, 'u1', [A]);
        await reconcileFavourites(cache, 'u1', []);
        expect(await readFavourites(cache, 'u2')).toEqual([]);
        expect(await reconcileFavourites(cache, undefined, [B])).toEqual({ ids: [], upload: [] });
    });
});

describe('create draft store with the account copy', () => {
    test('with nothing on the phone, the account\'s draft for this model is used; another model\'s is not', async () => {
        const cache = createCache(createMemoryStorage());
        const a = api(() => ({ favourites: [], draft: { v: 1, modelId: 'veo-3', prompt: 'from the web', duration: 5, aspect: '16:9', count: 1, seed: '', negative: '', voice: '' }, draft_updated_at: new Date().toISOString() }));
        expect((await loadDraft('veo-3', cache, 'u1', a))?.prompt).toBe('from the web');
        expect(await loadDraft('other-model', cache, 'u1', a)).toBeNull();
    });
    test('a newer draft on the phone beats an older account copy, and an older phone copy loses to a newer one', async () => {
        let now = 1_000_000;
        const cache = createCache(createMemoryStorage(), () => now);
        await saveDraft(local, cache, 'u1');
        const older = api(() => ({ favourites: [], draft: { v: 1, modelId: 'veo-3', prompt: 'older', duration: 5, aspect: null, count: 1, seed: '', negative: '', voice: '' }, draft_updated_at: new Date(now - 5000).toISOString() }));
        expect((await loadDraft('veo-3', cache, 'u1', older))?.prompt).toBe('a red fox');
        const newer = api(() => ({ favourites: [], draft: { v: 1, modelId: 'veo-3', prompt: 'newer', duration: 5, aspect: null, count: 1, seed: '', negative: '', voice: '' }, draft_updated_at: new Date(now + 5000).toISOString() }));
        expect((await loadDraft('veo-3', cache, 'u1', newer))?.prompt).toBe('newer');
    });
    test('saving keeps the phone copy and sends the shared words once the account answered; clearing clears both', async () => {
        const cache = createCache(createMemoryStorage());
        const a = api((path) => (path === '/api/v1/library-sync' ? { favourites: [], draft: null, draft_updated_at: null } : {}));
        await loadDraft('veo-3', cache, 'u1', a);
        await saveDraft(local, cache, 'u1', a);
        expect(a.calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(1);
        expect(JSON.parse(String(a.calls.at(-1)?.init?.body)).draft.cinemaOn).toBeUndefined();
        expect((await loadDraft('veo-3', cache, 'u1'))?.prompt).toBe('a red fox');
        await clearDraft(cache, 'u1', a);
        expect(a.calls.at(-1)?.init?.method).toBe('DELETE');
        expect(await loadDraft('veo-3', cache, 'u1')).toBeNull();
    });
    test('account copy off: nothing extra is sent after the first refusal and the phone copy works as before', async () => {
        const cache = createCache(createMemoryStorage());
        const a = off();
        await loadDraft('veo-3', cache, 'u1', a);
        await saveDraft(local, cache, 'u1', a);
        await clearDraft(cache, 'u1', a);
        expect(a.calls).toHaveLength(1);
        expect(await loadDraft('veo-3', cache, 'u1')).toBeNull();
    });
});
