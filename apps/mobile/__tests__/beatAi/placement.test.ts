import { createBeatStore } from '../../src/lib/beatNative/store';
import { tryOp } from '../../src/lib/beatNative/doc';
import { createHistory, record as historyRecord, canUndo } from '../../src/lib/beatNative/history';
import { createPartRequest } from '../../src/lib/beatAi/useBeatAiRequest';
import { pendingStore } from '../../src/lib/beatAi/pending';
import { placedAlready } from '../../src/lib/beatAi/shared';
import { asset, beatId, client, doc, files, id, owner, row, deferred } from './fixtures';
import type { AiDoc, Asset } from '../../src/lib/beatAi/types';
import type { Edit } from '../../src/lib/beatNative/doc';
test('poll → place one history step → flush → verify saved placement → retire; replay places once', async () => {
    const f = files(), c = client(), store = createBeatStore(f.port), storage = pendingStore(f.port);
    f.data.set(`${beatId}.json`, JSON.stringify({ id: beatId, doc: doc(), revision: 1, updatedAt: doc().updatedAt }));
    await store.hydrateBeats(); let history = createHistory(store.getBeat(beatId)!);
    const apply = jest.fn((edit: Edit) => {
        const next = tryOp(store.getBeat(beatId)!, edit); if (next.refused) return false;
        if (next.doc !== store.getBeat(beatId)) { store.putBeat(next.doc); history = historyRecord(history, store.getBeat(beatId)!); } return true;
    });
    const accepted = { ...row(), requestId: id(8) }; await storage.put(accepted);
    c.request.mockResolvedValue({ state: 'succeeded', candidates: [{ ordinal: 1, state: 'succeeded', song_id: id(5), version_id: id(6), job_id: id(7) }] });
    const savedDoc = async () => JSON.parse((await f.port.read(`${beatId}.json`))!).doc as AiDoc;
    const flow = createPartRequest({ owner, beatId, client: c.client, storage, current: () => true, off: jest.fn(), store, apply, savedDoc, port: { load: async () => asset }, signal: new AbortController().signal });
    await flow.resume(accepted);
    expect(canUndo(history)).toBe(true); expect(placedAlready(await savedDoc(), accepted, 0)).toBe(true); expect(await storage.read(owner, beatId)).toEqual([]);
    const tracks = store.getBeat(beatId)!.tracks.length;
    await storage.put(accepted); await flow.resume(accepted); expect(store.getBeat(beatId)!.tracks).toHaveLength(tracks);
    store.resetBeats();
});
test('owner generation changes during asset load: no placement or retirement', async () => {
    const f = files(), c = client(), store = createBeatStore(f.port), storage = pendingStore(f.port), wait = deferred<Asset>();
    f.data.set(`${beatId}.json`, JSON.stringify({ id: beatId, doc: doc(), revision: 1, updatedAt: doc().updatedAt }));
    await store.hydrateBeats(); await store.flushBeat(beatId);
    let current = true; const apply = jest.fn(() => true), load = jest.fn(() => wait.promise);
    const accepted = { ...row(), requestId: id(8) }; await storage.put(accepted);
    c.request.mockResolvedValue({ state: 'succeeded', candidates: [{ ordinal: 1, state: 'succeeded', song_id: id(5), version_id: id(6), job_id: id(7) }] });
    const flow = createPartRequest({ owner, beatId, client: c.client, storage, current: () => current, off: jest.fn(), store, apply, port: { load }, signal: new AbortController().signal });
    const resume = flow.resume(accepted);
    for (let n = 0; n < 20 && !load.mock.calls.length; n++) await Promise.resolve();
    current = false; wait.resolve(asset); await resume;
    expect(apply).not.toHaveBeenCalled(); expect(await storage.read(owner, beatId)).toHaveLength(1); store.resetBeats();
});
test('refused placement and failed flush keep the receipt for a later check', async () => {
    for (const refused of [true, false]) {
        const f = files(), c = client(), storage = pendingStore(f.port);
        f.data.set(`${beatId}.json`, JSON.stringify({ id: beatId, doc: doc(), revision: 1, updatedAt: doc().updatedAt }));
        const store = createBeatStore(f.port); await store.hydrateBeats();
        const accepted = { ...row(), requestId: id(8) }; await storage.put(accepted);
        c.request.mockResolvedValue({ state: 'succeeded', candidates: [{ ordinal: 1, state: 'succeeded', song_id: id(5), version_id: id(6), job_id: id(7) }] });
        if (!refused) jest.spyOn(store, 'flushBeat').mockRejectedValue(new Error('disk'));
        const flow = createPartRequest({ owner, beatId, client: c.client, storage, current: () => true, off: jest.fn(), store,
            apply: edit => refused ? false : store.putBeat(edit(store.getBeat(beatId)!)), port: { load: async () => asset }, signal: new AbortController().signal });
        await flow.resume(accepted); expect(flow.snapshot().error).toBeTruthy(); expect(await storage.read(owner, beatId)).toHaveLength(1); store.resetBeats();
    }
});
test('empty terminal success retires after the library note without a placement', async () => {
    const f = files(), c = client(), storage = pendingStore(f.port);
    f.data.set(`${beatId}.json`, JSON.stringify({ id: beatId, doc: doc(), revision: 1, updatedAt: doc().updatedAt }));
    const store = createBeatStore(f.port); await store.hydrateBeats();
    const accepted = { ...row(), requestId: id(8) }; await storage.put(accepted);
    c.request.mockResolvedValue({ state: 'succeeded', candidates: [] });
    const apply = jest.fn(), load = jest.fn();
    const flow = createPartRequest({ owner, beatId, client: c.client, storage, current: () => true, off: jest.fn(), store, apply, port: { load }, signal: new AbortController().signal });
    await flow.resume(accepted);
    expect(flow.snapshot().messages).toEqual(['beatAi.library']); expect(await storage.read(owner, beatId)).toEqual([]);
    expect(apply).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled(); store.resetBeats();
});
