import { ApiError } from '../src/lib/api';
import { createAssetLinks } from '../src/lib/libraryMedia';
import { clearPosters, posterFor } from '../src/lib/videoPoster';
import type { FrameDeps } from '../src/lib/chatVideoFrames';
const asset = { url: 'https://asset', mime_type: 'image/png' };
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
test('shares one request and caps concurrent requests at three', async () => {
    const reads = Array.from({ length: 5 }, () => deferred<typeof asset>());
    const getAsset = jest.fn((id: string) => reads[Number(id)].promise);
    const links = createAssetLinks({ getAsset });
    const first = links.request('0'); expect(links.request('0')).toBe(first);
    const rest = ['1', '2', '3', '4'].map(id => links.request(id));
    expect(getAsset).toHaveBeenCalledTimes(3);
    reads[0].resolve(asset); await first; expect(getAsset).toHaveBeenCalledTimes(4);
    reads.forEach(r => r.resolve(asset)); await Promise.all(rest);
    expect(getAsset).toHaveBeenCalledTimes(5);
});
test('held is distinct; TTL refetches; clear invalidates completed and pending files', async () => {
    let now = 0;
    const getAsset = jest.fn().mockResolvedValue(asset);
    const links = createAssetLinks({ getAsset, now: () => now, ttlMs: 20 });
    await links.request('a'); now = 19; await links.request('a'); expect(getAsset).toHaveBeenCalledTimes(1);
    now = 20; await links.request('a'); expect(getAsset).toHaveBeenCalledTimes(2);
    getAsset.mockRejectedValueOnce(new ApiError(404, 'held'));
    expect(await links.request('held')).toEqual({ kind: 'held' });
    const late = deferred<typeof asset>(); getAsset.mockReturnValueOnce(late.promise);
    const pending = links.request('late'); links.clear(); late.resolve(asset);
    expect(await pending).toEqual({ kind: 'none' }); expect(links.peek('a')).toBeUndefined(); expect(links.peek('late')).toBeUndefined();
});
test('429 returns none for the sent failure, drains all queued work as cooldown, and resumes after Retry-After', async () => {
    let now = 0; const sent = deferred<typeof asset>();
    const getAsset = jest.fn().mockReturnValueOnce(sent.promise).mockResolvedValue(asset);
    const links = createAssetLinks({ getAsset, concurrency: 1, now: () => now });
    const a = links.request('a'), b = links.request('b'), c = links.request('c');
    sent.reject(new ApiError(429, 'rate_limited', { retryAfterSeconds: 5 }));
    expect(await a).toEqual({ kind: 'none' });
    expect(await b).toEqual({ kind: 'cooldown', until: 5000 }); expect(await c).toEqual({ kind: 'cooldown', until: 5000 });
    expect(await links.request('d')).toEqual({ kind: 'cooldown', until: 5000 }); expect(getAsset).toHaveBeenCalledTimes(1);
    now = 5000; expect(await links.request('b')).toMatchObject({ kind: 'file' }); expect(getAsset).toHaveBeenCalledTimes(2);
});
test('poster requests share work, use a bounded midpoint and release the player', async () => {
    clearPosters(); const release = jest.fn(), generate = jest.fn().mockResolvedValue([{}]);
    const deps = { createPlayer: jest.fn(() => ({ status: 'readyToPlay', duration: 0.4, addListener: () => ({ remove: jest.fn() }), generateThumbnailsAsync: generate, release })) } as unknown as FrameDeps;
    const a = posterFor('job', 'url', deps); expect(posterFor('job', 'url', deps)).toBe(a);
    await a; await flush(); expect(generate).toHaveBeenCalledWith([0.2], { maxWidth: 480, maxHeight: 480 }); expect(release).toHaveBeenCalledTimes(1);
    await posterFor('job', 'new-url', deps); expect(deps.createPlayer).toHaveBeenCalledTimes(1); clearPosters();
});
