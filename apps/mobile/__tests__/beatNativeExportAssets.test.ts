import type { SessionTask } from '../src/auth/sessionTask';
import type { ApiClient } from '../src/lib/api';
import { addAudioRegion, type BeatRemoteAsset } from '../src/lib/beatNative/doc';
import { createNativeExportAssetSession } from '../src/lib/beatNative/nativeExportAssets';
import { createNativeHeldAssets } from '../src/lib/beatNative/nativeHeldAssets';
import type { NativeAssetPort } from '../src/lib/beatNative/nativeAssets';
import type { NativeOfflineContext } from '../src/lib/beatNative/nativeContext';
import type { PlaybackContext } from '../src/lib/beatNative/takePlayback';
import { fixedDoc, USER } from './beatNativeFixtures';
import { fakeContext } from './beatNativeTakeFixtures';

const remote: BeatRemoteAsset = { source: 'song', name: 'Song', durationSec: 2, bpm: null, sourceChannels: 2, encodedBytes: 100,
    ref: { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222', jobId: '33333333-3333-4333-8333-333333333333' } };
const docWith = () => addAudioRegion(fixedDoc(), remote, null, 0);
const task = (user: string | null = USER) => ({ gen: 1, user, current: () => true,
    tokens: Object.assign(async () => null, { generation: () => 1, expected: 1 }) } as SessionTask);
const api = (request: jest.Mock) => ({ request, stream: jest.fn(), getBalance: jest.fn() }) as unknown as ApiClient;

test('preflight is owner-fenced before a decoder exists; pattern selection needs no account or signing', async () => {
    const request = jest.fn(async () => ({ url: 'https://private.test/signed' })), decoder = jest.fn();
    const sessionTask = task(), session = createNativeExportAssetSession({ doc: docWith(), api: api(request), task: sessionTask,
        signal: new AbortController().signal, heldAssets: createNativeHeldAssets(), deps: { createDecoder: decoder } });
    await session.preflight({ range: 'song' });
    expect(request).toHaveBeenCalledWith('/api/v1/jobs/33333333-3333-4333-8333-333333333333/asset',
        { signal: expect.any(AbortSignal) }, { owner: USER, task: sessionTask });
    expect(decoder).not.toHaveBeenCalled();
    const signedOutRequest = jest.fn(), local = createNativeExportAssetSession({ doc: docWith(), api: api(signedOutRequest), task: task(null),
        signal: new AbortController().signal, heldAssets: createNativeHeldAssets() });
    await local.preflight({ pattern: true }); expect(signedOutRequest).not.toHaveBeenCalled();
});

test('a held preflight is sticky for the run and store until explicit retry', async () => {
    const heldAssets = createNativeHeldAssets(), request = jest.fn()
        .mockRejectedValueOnce(Object.assign(new Error('held'), { status: 404, code: 'held' }))
        .mockResolvedValue({ url: 'https://private.test/signed' });
    const make = () => createNativeExportAssetSession({ doc: docWith(), api: api(request), task: task(),
        signal: new AbortController().signal, heldAssets });
    const first = make();
    await expect(first.preflight({ range: 'song' })).rejects.toMatchObject({ key: 'beatExport.assetHeld' });
    expect(() => first.assertAssets({ range: 'song' })).toThrow('beatExport.assetHeld');
    await expect(first.confirm({ range: 'song' })).rejects.toMatchObject({ key: 'beatExport.assetHeld' });
    expect(request).toHaveBeenCalledTimes(1);
    await expect(make().preflight({ range: 'song' })).rejects.toMatchObject({ key: 'beatExport.assetHeld' });
    expect(request).toHaveBeenCalledTimes(1);
    heldAssets.retry();
    await expect(make().preflight({ range: 'song' })).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
});

test('prepare copies every channel and batch release closes the decoder and extracted archives', async () => {
    const sourceContext = fakeContext().context, source = sourceContext.createBuffer(2, 4, 48_000);
    source.getChannelData(0).set([1, 2, 3, 4]); source.getChannelData(1).set([5, 6, 7, 8]);
    const close = jest.fn(async () => {}), decoder = { ...fakeContext().context, close } as unknown as PlaybackContext;
    const releaseArchives = jest.fn(), load = jest.fn(async () => source), port = { load, releaseArchives } as NativeAssetPort;
    const target = fakeContext().context as unknown as NativeOfflineContext;
    const session = createNativeExportAssetSession({ doc: docWith(), api: api(jest.fn()), task: task(), signal: new AbortController().signal,
        heldAssets: createNativeHeldAssets(), deps: { port, createDecoder: () => decoder } });
    const copied = await session.prepare(remote, 120, target);
    expect(Array.from(copied.getChannelData(0))).toEqual([1, 2, 3, 4]);
    expect(Array.from(copied.getChannelData(1))).toEqual([5, 6, 7, 8]);
    expect(copied.getChannelData(0)).not.toBe(source.getChannelData(0));
    expect(load).toHaveBeenCalledWith(remote, 120, decoder, expect.any(AbortSignal));
    expect(JSON.stringify(load.mock.calls)).not.toContain('private.test');
    await session.releaseBatch(); expect(close).toHaveBeenCalledTimes(1); expect(releaseArchives).toHaveBeenCalledTimes(1);
    await session.close(); await session.close(); expect(close).toHaveBeenCalledTimes(1); expect(releaseArchives).toHaveBeenCalledTimes(2);
});
