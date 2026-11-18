import { ApiError } from '../src/lib/api';
import { createMusicPlayer, hookPlayback, songPlayback, type PlaybackStatus, type PlayerPort, type PlayerState } from '../src/lib/music/player';
import { song, hook, HOOK_JOB, JOB } from './fixtures/music';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function setup(initial: string | null = 'active') {
    let time = 0; let appState = (_: string | null | undefined) => {};
    const ports: (PlayerPort & { emit(status: Partial<PlaybackStatus>): void })[] = [];
    const getAsset = jest.fn(async () => ({ url: `https://signed.test/${ports.length}`, mime_type: 'audio/wav', asset_expires_at: '2099-01-01' }));
    const recordListen = jest.fn(async () => {}), mode = jest.fn(async () => {}), unsubscribe = jest.fn(), states: PlayerState[] = [];
    const factory = jest.fn((_url: string) => {
        let callback = (_: PlaybackStatus) => {};
        const p = { isLoaded: true, play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(async (_seconds: number) => {}), remove: jest.fn(),
            addListener: jest.fn((_event: string, cb: (s: PlaybackStatus) => void) => { callback = cb; return { remove: jest.fn() }; }),
            emit: (s: Partial<PlaybackStatus>) => callback({ isLoaded: true, playing: true, currentTime: 0, duration: 30, didJustFinish: false, playbackState: 'readyToPlay', ...s }) };
        ports.push(p); return p;
    });
    const controller = createMusicPlayer({ getAsset, factory, recordListen, setAudioMode: mode,
        subscribeAppState: cb => { appState = cb; cb(initial); return unsubscribe; }, onState: s => states.push(s), now: () => time });
    return { controller, getAsset, ports, factory, recordListen, mode, unsubscribe, states, advance: (ms: number) => { time += ms; }, changeAppState: (value: string | null) => appState(value), background: () => appState('background'), activate: () => appState('active') };
}
test('detail playback applies only preview crop offsets; canonical and other effects start at zero', () => {
    const crop = { start_seconds: 3, end_seconds: 8 };
    expect(songPlayback({ ...song, provenance: { crop } })).toEqual({ songId: 's1', jobId: JOB, start: 3, end: 8 });
    expect(songPlayback({ ...song, provenance: { crop, render_state: 'canonical' } })).toEqual({ songId: 's1', jobId: JOB, start: 0 });
    expect(songPlayback({ ...song, provenance: { fade: {}, speed: { speed_ratio: 2 }, crop: { start_seconds: NaN, end_seconds: 8 } } }).start).toBe(0);
    expect(() => songPlayback({ ...song, audio_url: null, lifecycle_status: 'trashed' })).toThrow();
});
test('resolves getAsset by job id, never plays relative audio path; only one live native handle', async () => {
    const s = setup(); await s.controller.load(songPlayback(song));
    expect(s.getAsset).toHaveBeenCalledWith(JOB); expect(s.factory).toHaveBeenCalledWith('https://signed.test/0');
    expect(s.mode).toHaveBeenCalledWith({ playsInSilentMode: true, shouldPlayInBackground: false });
    await s.controller.load(songPlayback(song)); expect(s.ports[0].remove).toHaveBeenCalledTimes(1);
    s.controller.dispose(); expect(s.ports[1].remove).toHaveBeenCalledTimes(1); expect(s.unsubscribe).toHaveBeenCalledTimes(1);
});
test('hook uses its saved version job, seeks and stops at bounds, records its song once per start', async () => {
    const s = setup(); await s.controller.load(hookPlayback(hook)); await s.controller.play(); await s.controller.play(); await flush();
    expect(s.getAsset).toHaveBeenCalledWith(HOOK_JOB); expect(s.getAsset).not.toHaveBeenCalledWith(JOB);
    expect(s.ports[0].seekTo).toHaveBeenCalledWith(4); expect(s.recordListen).toHaveBeenCalledTimes(1); expect(s.recordListen).toHaveBeenCalledWith('s1');
    await s.controller.seek(-10); expect(s.ports[0].seekTo).toHaveBeenLastCalledWith(4);
    s.ports[0].emit({ currentTime: 9 }); expect(s.controller.getState().state).toBe('ended'); expect(s.ports[0].pause).toHaveBeenCalled();
    await s.controller.play(); expect(s.ports[0].seekTo).toHaveBeenLastCalledWith(4);
    s.background(); expect(s.controller.getState().state).toBe('paused');
    await s.controller.play(); expect(s.recordListen).toHaveBeenCalledTimes(2);
    s.controller.dispose();
});
test('preview crop seeks and stops; canonical crop plays without offsets', async () => {
    const s = setup(); const crop = { start_seconds: 2, end_seconds: 7 };
    await s.controller.load(songPlayback({ ...song, provenance: { crop } })); await s.controller.play();
    expect(s.ports[0].seekTo).toHaveBeenCalledWith(2); s.ports[0].emit({ currentTime: 7 }); expect(s.controller.getState().state).toBe('ended');
    await s.controller.load(songPlayback({ ...song, provenance: { crop, render_state: 'canonical' } })); await s.controller.play();
    expect(s.ports[1].seekTo).toHaveBeenCalledWith(0); s.ports[1].emit({ currentTime: 7 }); expect(s.controller.getState().state).toBe('playing');
    s.controller.dispose();
});
test('signed URL expiry re-resolves even if file retention has not expired', async () => {
    const s = setup(); await s.controller.load(songPlayback(song)); await s.controller.play(); s.controller.pause();
    s.advance(15 * 60_000); await s.controller.play(); expect(s.getAsset).toHaveBeenCalledTimes(2); expect(s.ports[0].remove).toHaveBeenCalledTimes(1);
    s.controller.dispose();
});
test('native errors re-resolve once, preserve position, and do not record another listen', async () => {
    const s = setup(); await s.controller.load(songPlayback(song)); await s.controller.play();
    s.ports[0].emit({ currentTime: 5 }); s.ports[0].emit({ error: 'native asset error' }); await flush();
    expect(s.getAsset).toHaveBeenCalledTimes(2); expect(s.ports[1].seekTo).toHaveBeenCalledWith(5);
    expect(s.recordListen).toHaveBeenCalledTimes(1); expect(s.controller.getState().state).toBe('playing');
    s.ports[1].emit({ playbackState: 'error' }); await flush(); expect(s.getAsset).toHaveBeenCalledTimes(2);
    expect(s.controller.getState().state).toBe('error'); s.controller.dispose();
});
test('held and 429 have plain states; listen errors never interrupt audio', async () => {
    const s = setup(); s.getAsset.mockRejectedValueOnce(new ApiError(409, 'held'));
    await s.controller.load(songPlayback(song)); expect(s.controller.getState().state).toBe('held'); expect(s.factory).not.toHaveBeenCalled();
    s.getAsset.mockRejectedValueOnce(new ApiError(429, 'rate_limited', { retryAfterSeconds: 5 })); await s.controller.play();
    expect(s.controller.getState().retryAt).toBe(5000); await s.controller.play(); expect(s.getAsset).toHaveBeenCalledTimes(2);
    s.advance(5000); s.recordListen.mockRejectedValueOnce(new ApiError(404, 'music_library_tabs_unavailable')); await s.controller.play(); await flush();
    expect(s.controller.getState().state).toBe('playing'); s.controller.dispose();
});
test('screen exit while asset is pending cannot leak or start a player', async () => {
    const s = setup(); let finish!: (value: { url: string; mime_type: string; asset_expires_at: string }) => void;
    s.getAsset.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = s.controller.load(songPlayback(song)); await flush(); s.controller.dispose();
    finish({ url: 'https://signed.test', mime_type: 'audio/wav', asset_expires_at: '' }); await pending;
    expect(s.factory).not.toHaveBeenCalled();
});
test('background during a re-resolve cancels autoplay', async () => {
    const s = setup(); await s.controller.load(songPlayback(song)); s.advance(15 * 60_000);
    let finish!: (value: { url: string; mime_type: string; asset_expires_at: string }) => void;
    s.getAsset.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = s.controller.play(); await flush(); s.background(); finish({ url: 'https://signed.test', mime_type: 'audio/wav', asset_expires_at: '' });
    await pending; expect(s.ports[1].play).not.toHaveBeenCalled(); s.controller.dispose();
});

test.each(['inactive', null, 'unknown'])('initial %p state allows a user-initiated play', async initial => {
    const s = setup(initial); await s.controller.load(songPlayback(song)); await s.controller.play();
    expect(s.ports[0].play).toHaveBeenCalledTimes(1); expect(s.controller.getState().state).toBe('playing');
    s.controller.dispose();
});
test('a backgrounded play is visibly refused and can be retried on return', async () => {
    const s = setup('background'); await s.controller.load(songPlayback(song)); await s.controller.play();
    expect(s.controller.getState().state).toBe('background'); expect(s.ports[0].play).not.toHaveBeenCalled();
    s.ports[0].emit({ playing: false }); expect(s.controller.getState().state).toBe('background');
    expect(s.recordListen).not.toHaveBeenCalled(); s.activate(); await s.controller.play();
    expect(s.ports[0].play).toHaveBeenCalledTimes(1); expect(s.recordListen).toHaveBeenCalledTimes(1);
    s.controller.dispose();
});

test.each(['inactive', 'background', null, 'unknown'])('a change to %p pauses current playback', async value => {
    const s = setup(); await s.controller.load(songPlayback(song)); await s.controller.play();
    jest.mocked(s.ports[0].pause).mockClear(); s.changeAppState(value);
    expect(s.ports[0].pause).toHaveBeenCalledTimes(1); expect(s.controller.getState().state).toBe('paused');
    await s.controller.play();
    expect(s.controller.getState().state).toBe(value === 'background' ? 'background' : 'playing');
    s.controller.dispose();
});
test('inactive during URL refresh cancels autoplay but permits the next explicit play', async () => {
    const s = setup(); await s.controller.load(songPlayback(song)); s.advance(15 * 60_000);
    let finish!: (value: { url: string; mime_type: string; asset_expires_at: string }) => void;
    s.getAsset.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = s.controller.play(); await flush(); s.changeAppState('inactive');
    finish({ url: 'https://signed.test', mime_type: 'audio/wav', asset_expires_at: '' }); await pending;
    expect(s.ports[1].play).not.toHaveBeenCalled(); await s.controller.play();
    expect(s.ports[1].play).toHaveBeenCalledTimes(1); s.controller.dispose();
});
