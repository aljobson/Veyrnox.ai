import { extractFrames, frameTimes, type FrameDeps } from '../src/lib/chatVideoFrames';
import { pickVideoFrames } from '../src/lib/chatPhotos';
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
    expect(pick).toHaveBeenCalledWith({ mediaTypes: ['videos'], allowsMultipleSelection: false }); expect(extract).toHaveBeenCalledWith('clip', 2);
    expect(result.images.map(image => [image.video, image.uri, image.preview])).toEqual([[true, 'one.jpg', 'one.jpg'], [true, 'two.jpg', 'two.jpg']]);
});
