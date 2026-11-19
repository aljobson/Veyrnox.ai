import { extractFrames, frameTimes, type FrameDeps } from '../src/lib/chatVideoFrames';
import { pickVideoFrames, type VideoResult } from '../src/lib/chatPhotos';
import { createVideoAttach } from '../src/lib/chatVideoAttempt';
jest.mock('expo-video', () => { throw new Error('missing native module'); });
test('equal segment midpoints', () => { expect(frameTimes(10, 4)).toEqual([1.25, 3.75, 6.25, 8.75]); expect(frameTimes(0, 4)).toEqual([]); expect(frameTimes(0.02, 4)).toEqual([0, 0, 0, 0]); });
function fake(ready = true) {
    const release = jest.fn(), remove = jest.fn();
    const generate = jest.fn(async () => [1, 2, 3, 4]);
    const save = jest.fn(async () => ({ uri: 'frame.jpg' }));
    const player = { status: ready ? 'readyToPlay' : 'loading', duration: 10, addListener: jest.fn(() => ({ remove })), generateThumbnailsAsync: generate, release };
    const deps = { createPlayer: () => player, manipulate: () => ({ renderAsync: async () => ({ saveAsync: save }) }) } as unknown as FrameDeps;
    return { release, remove, generate, save, deps };
}
test('saves bounded JPEG frames and always releases the player', async () => {
    const f = fake(); expect(await extractFrames('clip', 4, f.deps)).toEqual(Array(4).fill('frame.jpg'));
    expect(f.generate).toHaveBeenCalledWith([1.25, 3.75, 6.25, 8.75], { maxWidth: 1280, maxHeight: 1280 });
    expect(f.save).toHaveBeenCalledWith({ compress: 0.85, format: 'jpeg' }); expect(f.release).toHaveBeenCalledTimes(1); expect(f.remove).toHaveBeenCalledTimes(2);
});
test('load timeout releases player and listeners; missing module degrades', async () => {
    jest.useFakeTimers(); const f = fake(false); const work = extractFrames('clip', 4, f.deps);
    const rejected = expect(work).rejects.toThrow('video_unreadable'); await jest.advanceTimersByTimeAsync(12000); await rejected;
    expect(f.release).toHaveBeenCalledTimes(1); expect(f.remove).toHaveBeenCalledTimes(2); jest.useRealTimers();
    await expect(extractFrames('clip', 4)).rejects.toThrow('video_unreadable');
});
test('picker refuses insufficient room without opening; successful frames are images', async () => {
    const pick = jest.fn(async () => ({ canceled: false, assets: [{ uri: 'clip' }] })) as any;
    const extract = jest.fn(async () => ['one.jpg', 'two.jpg']);
    expect(await pickVideoFrames(1, { pick, extract })).toEqual({ images: [], problem: 'room' }); expect(pick).not.toHaveBeenCalled();
    const result = await pickVideoFrames(2, { pick, extract });
    expect(pick).toHaveBeenCalledWith({ mediaTypes: ['videos'], allowsMultipleSelection: false }); expect(extract).toHaveBeenCalledWith('clip', 2, undefined, { cancelled: false });
    expect(result.images.map(image => [image.video, image.uri, image.preview])).toEqual([[true, 'one.jpg', 'one.jpg'], [true, 'two.jpg', 'two.jpg']]);
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function videoPick(result: unknown = { canceled: false, assets: [{ uri: 'clip' }] }) {
    return jest.fn(async () => result as Awaited<ReturnType<typeof import('expo-image-picker').launchImageLibraryAsync>>);
}
afterEach(() => { jest.useRealTimers(); });

test.each([
    [{ canceled: true, assets: null }, 'video_none'],
    [{ canceled: false, assets: [] }, 'video_none'],
    [{ canceled: false }, 'video_none'],
    [{ canceled: false, assets: [{}] }, 'video_none'],
    [{ canceled: false, assets: [{ uri: '' }] }, 'video_none'],
])('picker result %j does not start reading', async (result, problem) => {
    const extract = jest.fn(), onReading = jest.fn();
    expect(await pickVideoFrames(4, { pick: videoPick(result), extract }, onReading)).toEqual({ images: [], problem });
    expect(onReading).not.toHaveBeenCalled(); expect(extract).not.toHaveBeenCalled();
});

test('reading starts exactly once after the picker resolves and before extraction', async () => {
    jest.useFakeTimers();
    const selected = deferred<Awaited<ReturnType<ReturnType<typeof videoPick>>>>();
    const order: string[] = [];
    const pick = jest.fn(() => { order.push('pick'); return selected.promise; });
    const onReading = jest.fn(() => { order.push('reading'); });
    const extract = jest.fn(async () => { order.push('extract'); return ['one.jpg']; });
    const work = pickVideoFrames(4, { pick, extract }, onReading);
    await jest.advanceTimersByTimeAsync(60000);
    expect(order).toEqual(['pick']); expect(jest.getTimerCount()).toBe(0);
    selected.resolve({ canceled: false, assets: [{ uri: 'clip' }] } as Awaited<ReturnType<typeof pick>>);
    expect((await work).problem).toBeNull();
    expect(order).toEqual(['pick', 'reading', 'extract']); expect(onReading).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
});

test.each(['pick', 'reading', 'extract'] as const)('%s throws -> unreadable and no deadline timer remains', async stage => {
    jest.useFakeTimers();
    const fail = () => { throw new Error('unexpected'); };
    const pick = stage === 'pick' ? jest.fn(fail) : videoPick();
    const extract = stage === 'extract' ? jest.fn(fail) : jest.fn(async () => []);
    expect(await pickVideoFrames(4, { pick, extract }, stage === 'reading' ? fail : undefined))
        .toEqual({ images: [], problem: 'video_unreadable' });
    expect(jest.getTimerCount()).toBe(0);
});

test('unsettled extraction reaches the default deadline and cancels further work', async () => {
    jest.useFakeTimers();
    const extract = jest.fn<ReturnType<typeof extractFrames>, Parameters<typeof extractFrames>>(() => new Promise(() => {}));
    const work = pickVideoFrames(4, { pick: videoPick(), extract });
    const settled = jest.fn(); void work.then(settled);
    await jest.advanceTimersByTimeAsync(29999); expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(await work).toEqual({ images: [], problem: 'video_unreadable' });
    expect(extract.mock.calls[0][3]).toEqual({ cancelled: true });
    expect(jest.getTimerCount()).toBe(0);
});

test('late thumbnails after a 5s deadline never render/save and release the player once', async () => {
    jest.useFakeTimers();
    const f = fake();
    f.generate.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([1, 2, 3, 4]), 6000)));
    const manipulate = jest.fn(f.deps.manipulate);
    const extraction = jest.fn((uri: string, count: number, _: FrameDeps | undefined, cancel?: { cancelled: boolean }) =>
        extractFrames(uri, count, { ...f.deps, manipulate }, cancel));
    const work = pickVideoFrames(4, { pick: videoPick(), extract: extraction }, undefined, 5000);
    await jest.advanceTimersByTimeAsync(5000);
    expect(await work).toEqual({ images: [], problem: 'video_unreadable' });
    await jest.advanceTimersByTimeAsync(1000);
    await expect(extraction.mock.results[0].value).rejects.toThrow('video_unreadable');
    expect(manipulate).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});

test.each([['render', 4000, 3, 2], ['save', 5000, 2, 2]] as const)(
    'cumulative work reaches 30s during a later %s; no more native calls begin', async (_, saveMs, renders, saves) => {
        jest.useFakeTimers();
        const release = jest.fn(), renderedRelease = jest.fn(), remove = jest.fn();
        const delay = <T,>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));
        const save = jest.fn(() => delay(saveMs, { uri: 'frame.jpg' }));
        const manipulate = jest.fn(() => ({ renderAsync: () => delay(5000, { saveAsync: save, release: renderedRelease }) }));
        const player = {
            status: 'loading', duration: 10, release,
            addListener: jest.fn((event: string, callback: () => void) => {
                if (event === 'sourceLoad') setTimeout(() => { player.status = 'readyToPlay'; callback(); }, 5000);
                return { remove };
            }),
            generateThumbnailsAsync: jest.fn(() => delay(5000, [1, 2, 3, 4])),
        };
        const deps = { createPlayer: () => player, manipulate } as unknown as FrameDeps;
        const extraction = jest.fn((uri: string, count: number, _: FrameDeps | undefined, cancel?: { cancelled: boolean }) =>
            extractFrames(uri, count, deps, cancel));
        const work = pickVideoFrames(4, { pick: videoPick(), extract: extraction });
        await jest.advanceTimersByTimeAsync(30000);
        expect(await work).toEqual({ images: [], problem: 'video_unreadable' });
        expect(manipulate).toHaveBeenCalledTimes(renders); expect(save).toHaveBeenCalledTimes(saves);
        await jest.advanceTimersByTimeAsync(12000);
        await expect(extraction.mock.results[0].value).rejects.toThrow('video_unreadable');
        expect(manipulate).toHaveBeenCalledTimes(renders); expect(save).toHaveBeenCalledTimes(saves);
        expect(release).toHaveBeenCalledTimes(1); expect(renderedRelease).toHaveBeenCalledTimes(renders);
        expect(remove).toHaveBeenCalledTimes(2); expect(jest.getTimerCount()).toBe(0);
    },
);

test('cancellation during load prevents thumbnails and releases the player', async () => {
    jest.useFakeTimers();
    const f = fake(false), player = f.deps.createPlayer('clip');
    const extraction = jest.fn((uri: string, count: number, _: FrameDeps | undefined, cancel?: { cancelled: boolean }) =>
        extractFrames(uri, count, f.deps, cancel));
    const work = pickVideoFrames(4, { pick: videoPick(), extract: extraction }, undefined, 5000);
    await jest.advanceTimersByTimeAsync(5000);
    expect((await work).problem).toBe('video_unreadable');
    const callback = (player.addListener as jest.Mock).mock.calls.find(call => call[0] === 'sourceLoad')[1];
    callback();
    await expect(extraction.mock.results[0].value).rejects.toThrow('video_unreadable');
    expect(f.generate).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
});

const empty: VideoResult = { images: [], problem: null };
const frames: VideoResult = { images: [{ id: 'frame', uri: 'frame.jpg' }], problem: null };
function attachment() {
    let notice: string | null = null;
    let mounted = true;
    const attempts: { result: ReturnType<typeof deferred<VideoResult>>; reading: () => void }[] = [];
    const pick = jest.fn((_room: number, reading: () => void) => {
        const result = deferred<VideoResult>(); attempts.push({ result, reading }); return result.promise;
    });
    const setNotice = jest.fn((value: string | null | ((current: string | null) => string | null)) => {
        notice = typeof value === 'function' ? value(notice) : value;
    });
    const addImages = jest.fn();
    const attach = createVideoAttach({ pick, setNotice, addImages, isMounted: () => mounted, t: key => key, videoAttempt: { current: 0 } });
    return { attach, pick, setNotice, addImages, attempts, notice: () => notice, unmount: () => { mounted = false; } };
}

test('older attempt cannot commit, show reading or clear the newer reading notice', async () => {
    const f = attachment();
    const a = f.attach(4, 4); f.attempts[0].reading();
    const b = f.attach(4, 4); f.attempts[1].reading();
    f.attempts[0].reading(); f.attempts[0].result.resolve(frames); await a;
    expect(f.notice()).toBe('chatDepth.reading'); expect(f.addImages).not.toHaveBeenCalled();
    expect(f.setNotice).toHaveBeenCalledTimes(3); // A reading, retire A, B reading
    f.attempts[1].result.resolve(frames); await b;
    expect(f.addImages).toHaveBeenCalledTimes(1); expect(f.addImages).toHaveBeenCalledWith(frames.images, 4);
    expect(f.notice()).toBeNull();
});

test.each(['complete', 'timeout', 'throw'] as const)('B cancels; retired A cannot restore its notice on %s', async outcome => {
    const f = attachment();
    const a = f.attach(4, 4); f.attempts[0].reading();
    const b = f.attach(4, 4);
    expect(f.notice()).toBeNull();
    f.attempts[1].result.resolve(empty); await b;
    const writes = f.setNotice.mock.calls.length;
    if (outcome === 'throw') f.attempts[0].result.reject(new Error('late'));
    else f.attempts[0].result.resolve(outcome === 'timeout' ? { images: [], problem: 'video_unreadable' } : frames);
    await a;
    expect(f.notice()).toBeNull(); expect(f.setNotice).toHaveBeenCalledTimes(writes);
    expect(f.addImages).not.toHaveBeenCalled();
});

test('B picker never resolves; A reading is retired before opening B', async () => {
    const f = attachment();
    const a = f.attach(4, 4); f.attempts[0].reading();
    f.pick.mockImplementationOnce((_room, reading) => {
        expect(f.notice()).toBeNull();
        const result = deferred<VideoResult>(); f.attempts.push({ reading, result }); return result.promise;
    });
    void f.attach(4, 4);
    f.attempts[0].result.resolve(frames); await a;
    expect(f.notice()).toBeNull(); expect(f.addImages).not.toHaveBeenCalled();
});

test.each([false, true])('unrelated notice survives cleanup (superseded=%s)', async superseded => {
    const f = attachment();
    const a = f.attach(4, 4); f.attempts[0].reading(); f.setNotice('photo error');
    if (superseded) {
        const b = f.attach(4, 4); expect(f.notice()).toBe('photo error');
        f.attempts[1].result.resolve(empty); await b;
    }
    f.attempts[0].result.resolve(frames); await a;
    expect(f.notice()).toBe('photo error');
});

test.each([
    ['room', 'chatDepth.videoRoom'], ['video_none', 'chatDepth.videoNone'], ['video_unreadable', 'chatDepth.videoFailed'],
] as const)('problem %s survives finally as %s', async (problem, message) => {
    const f = attachment(); const work = f.attach(4, 4); f.attempts[0].reading();
    f.attempts[0].result.resolve({ images: [], problem }); await work;
    expect(f.notice()).toBe(message);
    const next = f.attach(4, 4); f.attempts[1].result.resolve(empty); await next;
    expect(f.notice()).toBe(message);
});

test('unexpected failure replaces reading with the retry message', async () => {
    const f = attachment(); const work = f.attach(4, 4); f.attempts[0].reading();
    f.attempts[0].result.reject(new Error('unexpected')); await work;
    expect(f.notice()).toBe('chatDepth.videoFailed'); expect(f.addImages).not.toHaveBeenCalled();
});

test.each([false, true])('unmount blocks callbacks, commit and cleanup (reject=%s)', async reject => {
    const f = attachment(); const work = f.attach(4, 4); f.attempts[0].reading();
    f.unmount(); f.setNotice.mockClear(); f.attempts[0].reading();
    if (reject) f.attempts[0].result.reject(new Error('late'));
    else f.attempts[0].result.resolve(frames);
    await work;
    expect(f.setNotice).not.toHaveBeenCalled(); expect(f.addImages).not.toHaveBeenCalled();
    await f.attach(4, 4); expect(f.pick).toHaveBeenCalledTimes(1);
});
