import { createTakePlayback } from '../src/lib/beatNative/takePlayback';
import { addAudioTrack, commitRecording, takeAsset } from '../src/lib/beatNative/takeShared';
import { fixedDoc, deferred } from './beatNativeFixtures';
import { fakeContext, takeRow } from './beatNativeTakeFixtures';
import type { BeatAsset, BeatDoc } from '../src/lib/beatNative/doc';
import type { NativeAssetPort } from '../src/lib/beatNative/nativeAssets';
import { createNativeHeldAssets } from '../src/lib/beatNative/nativeHeldAssets';
function recorded() { const doc = addAudioTrack({ ...fixedDoc(), tempo: { bpm: 120 } }), row = { ...takeRow(), samples: new Float32Array(10000), length: 10000 }; return { row, doc: commitRecording(doc, { trackId: doc.tracks.at(-1)!.id, start: 3840, length: 15360, takes: [{ asset: takeAsset(row) }] }) }; }
function remote(asset: BeatAsset, reverse = false): BeatDoc {
    const doc = addAudioTrack({ ...fixedDoc(), tempo: { bpm: 120 } }), track = doc.tracks.at(-1)!;
    return { ...doc, view: 'song', assets: { ...doc.assets, a1: asset }, tracks: doc.tracks.map(item => item.id === track.id ? { ...item,
        regions: [{ id: 'r1', start: 0, length: 1920, assetId: 'a1', phaseSec: 0, gainDb: 0, fadeIn: null, fadeOut: null, reverse }] } : item) };
}
const song = (source: 'song' | 'target' = 'song'): BeatAsset => ({ source,
    ref: source === 'song'
        ? { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222', jobId: '33333333-3333-4333-8333-333333333333' }
        : { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222', requestId: '33333333-3333-4333-8333-333333333333', kind: 'target', instrument: 'drums' },
    name: 'Audio', durationSec: 2, bpm: null, sourceChannels: 2, encodedBytes: 100 });
const stereo = () => {
    const channels = [new Float32Array([1, 2, 3, 4]), new Float32Array([5, 6, 7, 8])];
    return { length: 4, numberOfChannels: 2, sampleRate: 2, getChannelData: (channel: number) => channels[channel] };
};
test('schedules clipped pieces with correct context time/offset and stops all owned sources', async () => {
    const { context, sources } = fakeContext(), { row, doc } = recorded(); const load = jest.fn(async () => row), player = createTakePlayback(context, load);
    await player.window(doc, { fromSec: 3, toSec: 3.15, contextTime: 10 }, { startSec: 3, endSec: 4 });
    expect(sources[0].start).toHaveBeenCalledWith(10, 1, 1); expect(sources[0].stop).toHaveBeenCalledWith(11);
    player.stop(); expect(sources[0].stop).toHaveBeenLastCalledWith(); expect(sources[0].disconnect).toHaveBeenCalled();
    await player.window(doc, { fromSec: 2, toSec: 2.15, contextTime: 12 }, { startSec: 2, endSec: 10 });
    expect(sources).toHaveLength(2); expect(load).toHaveBeenCalledTimes(1); player.close(); expect(sources[1].disconnect).toHaveBeenCalled();
});
test('missing cloud-only takes stay silent, and loads resolving after stop cannot schedule', async () => {
    const { context, sources } = fakeContext(), { row, doc } = recorded(), pending = deferred<typeof row | null>();
    const player = createTakePlayback(context, () => pending.promise);
    const work = player.window(doc, { fromSec: 2, toSec: 2.15, contextTime: 1 }, { startSec: 2, endSec: 10 }); player.stop(); pending.resolve(row); await work; expect(sources).toEqual([]);
    const missing = createTakePlayback(context, async () => null); await missing.window(doc, { fromSec: 2, toSec: 2.15, contextTime: 1 }, { startSec: 2, endSec: 10 }); expect(sources).toEqual([]);
});
test.each(['song', 'target'] as const)('%s regions load through the native asset port and schedule once', async source => {
    const { context, sources } = fakeContext(), load = jest.fn(async () => stereo());
    const assets = { load } as NativeAssetPort, player = createTakePlayback(context, undefined, undefined, assets), doc = remote(song(source));
    await player.preload(doc);
    await player.window(doc, { fromSec: 0, toSec: 0.15, contextTime: 10 }, { startSec: 0, endSec: 2 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(doc.assets!.a1, 120, context, expect.any(AbortSignal));
    expect(sources[0].buffer).toBe(await load.mock.results[0].value);
    expect(sources[0].start).toHaveBeenCalledWith(10, 0, 1);
});
test('reverse copies every channel without mutating the decoded buffer and is cached', async () => {
    const { context, sources } = fakeContext(), decoded = stereo(), load = jest.fn(async () => decoded);
    const player = createTakePlayback(context, undefined, undefined, { load } as NativeAssetPort), doc = remote(song(), true);
    await player.preload(doc);
    await player.window(doc, { fromSec: 0, toSec: 0.15, contextTime: 1 }, { startSec: 0, endSec: 2 });
    await player.window(doc, { fromSec: 0, toSec: 0.15, contextTime: 2 }, { startSec: 0, endSec: 2 });
    expect(load).toHaveBeenCalledTimes(1);
    expect([...decoded.getChannelData(0)]).toEqual([1, 2, 3, 4]);
    expect([...sources[0].buffer.getChannelData(0)]).toEqual([4, 3, 2, 1]);
    expect([...sources[0].buffer.getChannelData(1)]).toEqual([8, 7, 6, 5]);
});
test('a remote load that resolves after stop cannot populate or schedule the next run', async () => {
    const { context, sources } = fakeContext(), first = deferred<ReturnType<typeof stereo>>(), load = jest.fn(() => first.promise), releaseArchives = jest.fn();
    const player = createTakePlayback(context, undefined, undefined, { load, releaseArchives } as unknown as NativeAssetPort), doc = remote(song());
    const stale = player.window(doc, { fromSec: 0, toSec: 0.15, contextTime: 1 }, { startSec: 0, endSec: 2 });
    player.stop(); expect(releaseArchives).toHaveBeenCalledTimes(1); first.resolve(stereo()); await stale;
    load.mockResolvedValue(stereo());
    await player.window(doc, { fromSec: 0, toSec: 0.15, contextTime: 2 }, { startSec: 0, endSec: 2 });
    expect(load).toHaveBeenCalledTimes(2); expect(sources).toHaveLength(1);
});
test('stem regions load through the native asset port and schedule like other remote audio', async () => {
    const { context, sources } = fakeContext();
    const stem: BeatAsset = { source: 'stem', ref: { songId: '1', versionId: '2', requestId: '3', part: 'vocals' },
        name: 'Vocals', durationSec: 2, bpm: null, sourceChannels: 2, encodedBytes: 100 };
    const load = jest.fn(async () => stereo()), player = createTakePlayback(context, undefined, undefined, { load } as NativeAssetPort), doc = remote(stem);
    await expect(player.preload(doc)).resolves.toBeUndefined();
    await expect(player.window(doc, { fromSec: 0, toSec: 0.15, contextTime: 1 }, { startSec: 0, endSec: 2 })).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledWith(stem, 120, context, expect.any(AbortSignal));
    expect(sources).toHaveLength(1); expect(sources[0].buffer).toBe(await load.mock.results[0].value);
});
test('a decoded set over the run budget fails before network loading instead of thrashing', async () => {
    const { context } = fakeContext(), load = jest.fn(), first = song(), second = { ...song('target'), name: 'Second' };
    first.durationSec = 300; second.durationSec = 300;
    const doc = remote(first, true), track = doc.tracks.at(-1)!;
    doc.assets!.a2 = second;
    track.regions.push({ id: 'r2', start: 1920, length: 1920, assetId: 'a2', phaseSec: 0, gainDb: 0, fadeIn: null, fadeOut: null, reverse: true });
    const player = createTakePlayback(context, undefined, undefined, { load } as NativeAssetPort);
    await expect(player.preload(doc)).rejects.toThrow('audio_playback_too_large');
    await expect(player.preload(doc)).rejects.toThrow('audio_playback_too_large');
    expect(load).not.toHaveBeenCalled();
});
test('two distinct stem requests count two retained archives before playback loading', async () => {
    const makeStem = (requestId: string, part: 'vocals' | 'instrumental'): BeatAsset => ({ source: 'stem',
        ref: { songId: '1', versionId: '2', requestId, part }, name: part, durationSec: 40, bpm: null, sourceChannels: 2, encodedBytes: 1 });
    const first = makeStem('3', 'vocals'), second = makeStem('4', 'instrumental');
    const doc = remote(first), track = doc.tracks.at(-1)!;
    doc.assets!.a2 = second;
    track.regions.push({ id: 'r2', start: 1920, length: 1920, assetId: 'a2', phaseSec: 0, gainDb: 0, fadeIn: null, fadeOut: null, reverse: false });
    const load = jest.fn(), player = createTakePlayback(fakeContext().context, undefined, undefined, { load } as NativeAssetPort);
    await expect(player.preload(doc)).rejects.toThrow('audio_playback_too_large');
    expect(load).not.toHaveBeenCalled();
});
test('shared held state silences playback until the export retry clears it, then playback can recover', async () => {
    const { context, sources } = fakeContext(), good = song(), held = { ...song('target'), name: 'Held' };
    const doc = remote(good), track = doc.tracks.at(-1)!; doc.assets!.a2 = held;
    track.regions.push({ id: 'r2', start: 0, length: 1920, assetId: 'a2', phaseSec: 0, gainDb: 0, fadeIn: null, fadeOut: null, reverse: false });
    const error = Object.assign(new Error('held'), { status: 404, code: 'held' }), report = jest.fn(), heldAssets = createNativeHeldAssets();
    let refused = true;
    const load = jest.fn(async (asset: BeatAsset) => {
        if (asset.name === 'Held' && refused) { heldAssets.markHeld(asset); throw error; }
        return stereo();
    });
    const player = createTakePlayback(context, undefined, undefined, { load, heldAssets } as NativeAssetPort, report);
    await player.preload(doc);
    await player.window(doc, { fromSec: 0, toSec: 0.15, contextTime: 1 }, { startSec: 0, endSec: 2 });
    expect(sources).toHaveLength(1); expect(report).toHaveBeenCalledTimes(1); expect(report).toHaveBeenCalledWith(held, error);
    player.stop(); await player.preload(doc);
    expect(load.mock.calls.filter(([asset]) => asset.name === 'Held')).toHaveLength(1); expect(report).toHaveBeenCalledTimes(2);
    refused = false; heldAssets.retry(); player.stop(); await player.preload(doc);
    expect(load.mock.calls.filter(([asset]) => asset.name === 'Held')).toHaveLength(2);
    await player.window(doc, { fromSec: 0, toSec: 0.15, contextTime: 2 }, { startSec: 0, endSec: 2 });
    expect(sources).toHaveLength(3);
});
test('retryable offline regions are retried on the next run, and muted regions preload when they fit', async () => {
    const { context } = fakeContext(), doc = remote(song()); doc.tracks.at(-1)!.mute = true;
    const offline = Object.assign(new Error('offline'), { status: 0 }), load = jest.fn().mockRejectedValueOnce(offline).mockResolvedValueOnce(stereo());
    const report = jest.fn(), player = createTakePlayback(context, undefined, undefined, { load } as NativeAssetPort, report);
    await expect(player.preload(doc)).resolves.toBeUndefined(); expect(load).toHaveBeenCalledTimes(1); expect(report).toHaveBeenCalledTimes(1);
    player.stop(); await expect(player.preload(doc)).resolves.toBeUndefined(); expect(load).toHaveBeenCalledTimes(2);
});
test('a decoded region over the cache budget stays silent instead of stopping a recording range', async () => {
    const { context, sources } = fakeContext(), doc = remote(song()), report = jest.fn();
    const oversized = { length: 100_000_000, numberOfChannels: 1, sampleRate: 48_000,
        getChannelData: jest.fn(() => new Float32Array(0)) };
    const player = createTakePlayback(context, undefined, undefined,
        { load: jest.fn(async () => oversized) } as unknown as NativeAssetPort, report);
    await expect(player.window(doc, { fromSec: 0, toSec: 0.15, contextTime: 1 }, { startSec: 0, endSec: 2 }, { recording: true, assetMode: 'all-supported' }))
        .resolves.toBeUndefined();
    expect(sources).toEqual([]); expect(report).toHaveBeenCalledTimes(1);
    expect((report.mock.calls[0][1] as Error).message).toBe('audio_playback_too_large');
});
test('recording asset modes preserve take-only microphone backing and enable supported MIDI-capture backing', async () => {
    const { context, sources } = fakeContext(), doc = remote(song()), load = jest.fn(async () => stereo());
    const player = createTakePlayback(context, undefined, undefined, { load } as NativeAssetPort);
    const window = { fromSec: 0, toSec: 0.15, contextTime: 1 }, bounds = { startSec: 0, endSec: 2 };
    await player.preload(doc, { recording: true, assetMode: 'takes-only' });
    await player.window(doc, window, bounds, { recording: true, assetMode: 'takes-only' });
    expect(load).not.toHaveBeenCalled(); expect(sources).toHaveLength(0);
    await player.preload(doc, { recording: true, assetMode: 'all-supported' });
    await player.window(doc, window, bounds, { recording: true, assetMode: 'all-supported' });
    expect(load).toHaveBeenCalledTimes(1); expect(sources).toHaveLength(1);
});
