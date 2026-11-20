import { createPersistedListeners } from '../src/lib/beatNative/persistedListeners';
import { configureBeatTakeStorage, putBeatTake, reconcileBeatTakes, loadBeatTake, takeAsset } from '../src/lib/beatNative/takeShared';
import { createTakeFiles } from '../src/lib/beatNative/takeFiles';
import { fixedDoc } from './beatNativeFixtures';
import { takeIO, takeRow } from './beatNativeTakeFixtures';

test('many edits coalesce by take set and retry still commits every saved take across undo', async () => {
    jest.useFakeTimers(); const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const persisted = createPersistedListeners();
    try {
        configureBeatTakeStorage(createTakeFiles(takeIO()));
        const doc = fixedDoc(), first = takeRow('first', doc.id), second = takeRow('second', doc.id);
        await putBeatTake(first); await putBeatTake(second);
        let unavailable = true;
        const listener = jest.fn(async (_id, saved) => {
            if (unavailable) throw new Error('take_store_unreadable');
            await reconcileBeatTakes(saved);
        });
        persisted.subscribe(listener);
        for (let i = 0; i < 100; i++) {
            const assets = i % 2 ? { a: takeAsset(first), b: takeAsset(second) } : { b: takeAsset(second), a: takeAsset(first) };
            await persisted.notify(doc.id, { ...doc, title: `Edit ${i}`, assets });
        }
        await persisted.notify(doc.id, { ...doc, assets: { a: takeAsset(first) } });
        await persisted.notify(doc.id, doc); // Undo all takes before reconciliation succeeds.
        listener.mockClear();
        await jest.advanceTimersByTimeAsync(5000); expect(listener).toHaveBeenCalledTimes(3);
        unavailable = false; listener.mockClear();
        await jest.advanceTimersByTimeAsync(5000); expect(listener).toHaveBeenCalledTimes(3);
        expect((await loadBeatTake(first.id))?.state).toBe('committed');
        expect((await loadBeatTake(second.id))?.state).toBe('committed');
        await jest.advanceTimersByTimeAsync(5000); expect(listener).toHaveBeenCalledTimes(3);
    } finally { persisted.reset(); warning.mockRestore(); jest.useRealTimers(); }
});

test('identical take sets belonging to different beats retain separate deliveries', async () => {
    jest.useFakeTimers(); const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const persisted = createPersistedListeners();
    try {
        const listener = jest.fn(async (): Promise<void> => { throw new Error('unavailable'); }); persisted.subscribe(listener);
        const doc = fixedDoc(); await persisted.notify(doc.id, doc);
        await persisted.notify('another-beat', { ...doc, id: 'another-beat' });
        listener.mockResolvedValue(undefined); listener.mockClear();
        await jest.advanceTimersByTimeAsync(5000);
        expect(listener.mock.calls).toEqual([[doc.id, doc], ['another-beat', { ...doc, id: 'another-beat' }]]);
    } finally { persisted.reset(); warning.mockRestore(); jest.useRealTimers(); }
});
