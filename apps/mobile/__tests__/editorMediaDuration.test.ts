import { probeDuration } from '../src/lib/editorMediaDuration';
const mockListeners: Record<string, Function> = {};
const mockRelease = jest.fn();
const mockCreate = jest.fn(() => ({ status: 'loading', addListener: (name: string, fn: Function) => { mockListeners[name] = fn; return { remove: jest.fn() }; }, release: mockRelease }));
jest.mock('expo-video', () => ({ createVideoPlayer: (...args: unknown[]) => mockCreate(...args as []) }));
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());
test.each([4, 20, 0, NaN, Infinity, -1])('sourceLoad %s is verified or rejected and released', async seconds => {
    const result = probeDuration('file://device'); mockListeners.sourceLoad({ duration: seconds });
    expect(await result).toBe(Number.isFinite(seconds) && seconds > 0 ? seconds : null); expect(mockRelease).toHaveBeenCalledTimes(1);
});
test('timeout and native errors release the player', async () => {
    const timeout = probeDuration('file://device', 30); jest.advanceTimersByTime(30); expect(await timeout).toBeNull();
    const error = probeDuration('file://device'); mockListeners.statusChange({ status: 'error' }); expect(await error).toBeNull();
    expect(mockRelease).toHaveBeenCalledTimes(2);
});
