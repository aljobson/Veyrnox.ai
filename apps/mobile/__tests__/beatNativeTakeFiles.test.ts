import { createTakeFiles } from '../src/lib/beatNative/takeFiles';
import { configureBeatTakeStorage, putBeatTake, appendBeatTake, loadBeatTake, hydrateBeatTakes, pendingBeatTakes, discardBeatTakes } from '../src/lib/beatNative/takeShared';
import { takeIO, takeRow } from './beatNativeTakeFixtures';
test('whole takes, little-endian samples, checkpoints and lifecycle rows round trip', async () => {
    const io = takeIO(), adapter = createTakeFiles(io), row = takeRow(); configureBeatTakeStorage(adapter);
    await putBeatTake(row); expect(new DataView(io.data.get([...io.data.keys()].find(n => n.endsWith('.f32'))!)!.buffer).getFloat32(0, true)).toBe(0.25);
    const chunk = takeRow('take-2'); await appendBeatTake(chunk, 0); await appendBeatTake(chunk, 1000);
    configureBeatTakeStorage(createTakeFiles(io)); await hydrateBeatTakes();
    expect((await loadBeatTake(row.id))?.samples).toEqual(row.samples);
    expect((await loadBeatTake(chunk.id))?.samples.length).toBe(2000);
    expect(pendingBeatTakes(row.beatId)).toHaveLength(2); await discardBeatTakes([row.id]); expect(pendingBeatTakes(row.beatId)).toHaveLength(1);
    await expect(adapter.get('../escape')).rejects.toThrow('invalid_take_id');
    await expect(adapter.putChunk({ ...row, id: 'take-1:../x', takeId: row.id, offset: -1 })).rejects.toThrow();
});
test.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('interruption at replacement operation %i retains readable checkpoint data', async step => {
    const io = takeIO(), adapter = createTakeFiles(io), row = takeRow(); configureBeatTakeStorage(adapter); await appendBeatTake(row, 0);
    io.interrupt(step); try { await appendBeatTake(row, 1000); } catch { /* Simulated process kill. */ }
    io.resume(); configureBeatTakeStorage(createTakeFiles(io)); await hydrateBeatTakes();
    expect(pendingBeatTakes(row.beatId)).toHaveLength(1);
    const loaded = await loadBeatTake(row.id); expect(loaded?.samples.slice(0, 1000)).toEqual(row.samples);
    expect([1000, 2000]).toContain(loaded?.samples.length);
});
test('a published manifest recovers the gap before putState, while incomplete first writes are not published', async () => {
    const io = takeIO(), adapter = createTakeFiles(io), row = takeRow(); await adapter.put(row);
    configureBeatTakeStorage(createTakeFiles(io)); await hydrateBeatTakes(); expect(pendingBeatTakes(row.beatId)).toHaveLength(1); expect(await loadBeatTake(row.id)).not.toBeNull();
    const empty = takeIO(); empty.interrupt(2); await expect(createTakeFiles(empty).put(takeRow('new'))).rejects.toThrow();
    empty.resume(); expect(await createTakeFiles(empty).listState()).toEqual([]);
});

test.each([1, 2, 3, 4, 5, 6])('whole-file replacement interruption %i retains a matching audio/metadata pair', async step => {
    const io = takeIO(), adapter = createTakeFiles(io), row = takeRow(); await adapter.put(row); await adapter.putState(row);
    io.interrupt(step); try { await adapter.put({ ...row, samples: new Float32Array(500).fill(0.5), length: 500 }); } catch { /* Simulated process kill. */ }
    io.resume(); const reopened = createTakeFiles(io), loaded = await reopened.get(row.id);
    expect([500, 1000]).toContain(loaded?.samples.length); expect(loaded?.samples[0]).toBe(loaded?.samples.length === 500 ? 0.5 : 0.25);
    expect(await reopened.listState()).toHaveLength(1);
});

test('startup skips malformed manifests, cleans temporary files once, and checkpoints avoid directory scans', async () => {
    const io = takeIO(); const remove = jest.fn(async (name: string) => { io.data.delete(name); });
    const initial = createTakeFiles(io), row = takeRow(); await initial.put(row); await initial.putState(row);
    io.data.set('damaged.whole.json', new TextEncoder().encode('{bad json'));
    io.data.set('invalid.whole.json', new TextEncoder().encode(JSON.stringify({ id: '../escape', sampleRate: 1000, length: 10, audioVersion: 'bad' })));
    io.data.set('damaged.state.json', new TextEncoder().encode('{bad json'));
    io.data.set('unfinished.whole.f32.tmp', new Uint8Array([1]));
    const list = jest.fn(io.list), read = jest.fn(io.read), adapter = createTakeFiles({ ...io, list, read, remove });
    expect((await adapter.listState()).map(r => r.id)).toEqual([row.id]);
    expect(io.data.has('unfinished.whole.f32.tmp')).toBe(false);
    expect((await adapter.get(row.id))?.samples).toEqual(row.samples);
    list.mockClear(); read.mockClear();
    await adapter.putChunk({ ...row, id: `${row.id}:1000`, takeId: row.id, offset: 1000 });
    await adapter.putState({ ...row, length: 2000 });
    expect(list).not.toHaveBeenCalled(); expect(read.mock.calls.some(([name]) => name.startsWith('damaged'))).toBe(false);
    expect(await adapter.listChunksFor(row.id)).toHaveLength(1);
});
