import { ApiError } from '../src/lib/api';
import { resetCacheUser } from '../src/lib/appCache';
import { pollUntil } from '../src/lib/music/actionPoll';
import { deferred } from './fixtures/musicActions';
type Status = { state: string };
let read: jest.Mock, onChange: jest.Mock, changeApp: (value: string | null | undefined) => void;
let stopApp: jest.Mock, poll: ReturnType<typeof pollUntil<Status>>;
function start(initialAppState: string | null = 'active', ceilingMs = 300000) {
    poll = pollUntil({ read, onChange, terminal: s => ['ready', 'failed', 'refunded'].includes(s.state), ceilingMs,
        initialAppState, subscribeAppState: fn => { changeApp = fn; return stopApp; } });
}
beforeEach(() => { jest.useFakeTimers(); read = jest.fn().mockResolvedValue({ state: 'running' }); onChange = jest.fn(); stopApp = jest.fn(); });
afterEach(() => { poll?.dispose(); jest.useRealTimers(); });
test('starts at 1.5s, backs off and caps the interval at 5s', async () => {
    start(); await jest.advanceTimersByTimeAsync(1499); expect(read).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(1);
    for (const [delay, count] of [[2250, 2], [3375, 3], [5000, 4], [5000, 5]]) {
        await jest.advanceTimersByTimeAsync(delay - 1); expect(read).toHaveBeenCalledTimes(count - 1);
        await jest.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(count);
    }
});
test.each(['ready', 'failed', 'refunded'])('terminal %s cancels all polling', async state => {
    read.mockResolvedValue({ state }); start(); await jest.advanceTimersByTimeAsync(1500);
    expect(poll.snapshot()).toEqual({ state: 'done', value: { state } });
    await jest.advanceTimersByTimeAsync(400000); await poll.refresh(); expect(read).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
test.each(['inactive', 'background', 'unknown', null, undefined])('pauses on non-active AppState %p and resumes once', async state => {
    start(); changeApp(state); expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(10000); await poll.refresh(); expect(read).not.toHaveBeenCalled();
    changeApp('active'); await jest.advanceTimersByTimeAsync(1500); expect(read).toHaveBeenCalledTimes(1);
});
test('initial unknown AppState never starts a timer', async () => {
    start(null); await jest.advanceTimersByTimeAsync(10000); expect(read).not.toHaveBeenCalled();
    changeApp('active'); await jest.advanceTimersByTimeAsync(1500); expect(read).toHaveBeenCalledTimes(1);
});
test('an in-flight response cannot restart timers in the background', async () => {
    const wait = deferred<Status>(); read.mockReturnValue(wait.promise); start(); await jest.advanceTimersByTimeAsync(1500);
    changeApp('inactive'); wait.resolve({ state: 'running' }); await Promise.resolve(); await Promise.resolve();
    expect(jest.getTimerCount()).toBe(0); await jest.advanceTimersByTimeAsync(10000); expect(read).toHaveBeenCalledTimes(1);
});
test.each(['dispose', 'account'])('%s stops timers and ignores a late response', async reason => {
    const wait = deferred<Status>(); read.mockReturnValue(wait.promise); start(); await jest.advanceTimersByTimeAsync(1500);
    if (reason === 'dispose') poll.dispose(); else resetCacheUser();
    wait.resolve({ state: 'ready' }); await Promise.resolve(); await Promise.resolve();
    await jest.advanceTimersByTimeAsync(400000); await poll.refresh();
    expect(read).toHaveBeenCalledTimes(1); expect(onChange).not.toHaveBeenCalled(); expect(stopApp).toHaveBeenCalledTimes(1);
    expect(poll.snapshot().value).toBeNull(); expect(jest.getTimerCount()).toBe(0);
});
test.each([new ApiError(0, 'network'), new ApiError(502, 'temporarily_unavailable')])('transient %p never becomes a failed action', async error => {
    read.mockRejectedValueOnce(error).mockResolvedValueOnce({ state: 'ready' }); start();
    await jest.advanceTimersByTimeAsync(1500); expect(poll.snapshot()).toEqual({ state: 'polling', value: null });
    await jest.advanceTimersByTimeAsync(2250); expect(poll.snapshot().state).toBe('done');
});
test('unavailable stops as off', async () => {
    read.mockRejectedValue(new ApiError(404, 'music_stems_unavailable')); start(); await jest.advanceTimersByTimeAsync(1500);
    expect(poll.snapshot()).toEqual({ state: 'off', value: null }); await jest.advanceTimersByTimeAsync(10000); expect(read).toHaveBeenCalledTimes(1);
});
test('hard ceiling stops automatic reads and manual refresh remains available', async () => {
    start('active', 4000); await jest.advanceTimersByTimeAsync(4000); expect(poll.snapshot().state).toBe('waiting');
    expect(read).toHaveBeenCalledTimes(2); await jest.advanceTimersByTimeAsync(10000); expect(read).toHaveBeenCalledTimes(2);
    await poll.refresh(); expect(read).toHaveBeenCalledTimes(3); expect(poll.snapshot().state).toBe('waiting');
    read.mockResolvedValue({ state: 'ready' }); await poll.refresh(); expect(poll.snapshot().state).toBe('done');
});
test('ceiling also bounds a hung read without overlapping manual requests', async () => {
    const wait = deferred<Status>(); read.mockReturnValue(wait.promise); start('active', 3000);
    await jest.advanceTimersByTimeAsync(3000); expect(poll.snapshot().state).toBe('waiting'); await poll.refresh(); expect(read).toHaveBeenCalledTimes(1);
    wait.resolve({ state: 'running' }); await Promise.resolve(); await Promise.resolve(); expect(poll.snapshot().state).toBe('waiting');
});

test('time spent in the background does not count toward the ceiling', async () => {
    start('active', 10000); await jest.advanceTimersByTimeAsync(4000); changeApp('background');
    await jest.advanceTimersByTimeAsync(60000); expect(poll.snapshot().state).toBe('polling');
    changeApp('active'); await jest.advanceTimersByTimeAsync(1500); expect(read.mock.calls.length).toBeGreaterThan(0);
    expect(poll.snapshot().state).toBe('polling'); await jest.advanceTimersByTimeAsync(7000); expect(poll.snapshot().state).toBe('waiting');
});
