import { extractFrame, preparePhoto, validateLocalMedia } from '../src/lib/liveEdit/media';
import { discardCacheCopy } from '../src/lib/cacheFiles';
import { ImageManipulator } from 'expo-image-manipulator';
import { createVideoPlayer } from 'expo-video';
jest.mock('expo-file-system', () => ({ File: class {} }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { PNG: 'png', JPEG: 'jpeg' } }));
jest.mock('expo-video', () => ({ createVideoPlayer: jest.fn() }));
jest.mock('../src/lib/cacheFiles', () => ({ discardCacheCopy: jest.fn() }));
afterEach(() => { jest.clearAllMocks(); jest.useRealTimers(); });
test('source limits refuse remote URLs, oversized stills and long clips without rescaling', () => {
    expect(() => validateLocalMedia('file:///a', 6000, 6000)).toThrow('photo-too-large');
    validateLocalMedia('file:///a.jpg', 100, 200); validateLocalMedia('content://a', 100, 200, 15000);
    for (const args of [['https://example.com/a', 100, 200], ['file:///a', 100, 200, 15001], ['file:///a', 100, 200, NaN]]) expect(() => validateLocalMedia(...args as [string, number, number, number?])).toThrow('invalid-local-media');
});
test('normalization retains original dimensions, limits inference and releases native refs', async () => {
    const release = jest.fn(), resize = jest.fn();
    const fullImage = { width: 1200, height: 800, saveAsync: async () => ({ uri: 'file:///cache/full.png' }), release };
    const smallImage = { saveAsync: async () => ({ uri: 'file:///cache/small.jpg', width: 384, height: 256, base64: 'AAAA' }), release };
    jest.mocked(ImageManipulator.manipulate).mockReturnValueOnce({ renderAsync: async () => fullImage, release } as never).mockReturnValueOnce({ resize, renderAsync: async () => smallImage, release } as never);
    const result = await preparePhoto('file:///picked.jpg', { sourceId: 2, frameId: 1 });
    expect(result).toMatchObject({ width: 1200, height: 800, uri: 'file:///cache/full.png', frame: { width: 384, height: 256 } });
    expect(resize).toHaveBeenCalledWith({ width: 384, height: 256 }); expect(release).toHaveBeenCalledTimes(4);
    expect(discardCacheCopy).toHaveBeenCalledWith('file:///cache/small.jpg'); expect(discardCacheCopy).not.toHaveBeenCalledWith('file:///picked.jpg');
});
test('video startup timeout and cancellation release the player and listener', async () => {
    jest.useFakeTimers(); const release = jest.fn(), remove = jest.fn();
    jest.mocked(createVideoPlayer).mockImplementation(() => ({ status: 'loading', addListener: () => ({ remove }), release }) as never);
    const timeout = extractFrame('file:///clip.mp4', 0, new AbortController().signal);
    const rejected = expect(timeout).rejects.toThrow('clip-timeout'); jest.advanceTimersByTime(15000); await rejected;
    expect(release).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
    const abort = new AbortController(), pending = extractFrame('file:///clip.mp4', 1, abort.signal); abort.abort();
    await expect(pending).rejects.toThrow('inference-cancelled'); expect(release).toHaveBeenCalledTimes(2); expect(jest.getTimerCount()).toBe(0);
});
