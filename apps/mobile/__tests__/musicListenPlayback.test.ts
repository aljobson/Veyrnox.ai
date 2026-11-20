import { createListenPlayback } from '../src/lib/music/listenPlayback';
import type { PlaybackStatus, PlayerState } from '../src/lib/music/player';
import { shared, token, deferred, flush } from './fixtures/musicPublication';
function setup() {
    let appState: string | null = 'active', onApp: (s: string | null) => void = () => {}, onAccount = () => {};
    let onStatus: (s: PlaybackStatus) => void = () => {};
    const offApp = jest.fn(), offAccount = jest.fn(), detach = jest.fn(), states: PlayerState[] = [];
    const native = { isLoaded: true, play: jest.fn(), pause: jest.fn(), remove: jest.fn(), seekTo: jest.fn(async () => {}),
        addListener: jest.fn((_e, cb) => { onStatus = cb; return { remove: detach }; }) };
    const read = jest.fn(async () => shared.song), mode = jest.fn(async () => {}), factory = jest.fn(() => native);
    const controller = createListenPlayback({ token, baseUrl: 'https://mock.test', read, getAppState: () => appState,
        subscribeAppState: cb => { onApp = cb; return offApp; }, subscribeAccount: cb => { onAccount = cb; return offAccount; },
        factory, setAudioMode: mode, onState: s => states.push(s) });
    return { controller, native, read, mode, factory, states, offApp, offAccount, detach, account: () => onAccount(),
        app(s: string | null, notify = true) { appState = s; if (notify) onApp(s); },
        status(patch: Partial<PlaybackStatus> = {}) { onStatus({ isLoaded: true, playing: true, currentTime: 1, duration: 10, didJustFinish: false, playbackState: 'ready', ...patch }); } };
}
test('explicit play goes loading to playing using only the anonymous asset route', async () => {
    const h = setup(); await h.controller.start();
    expect(h.states.map(s => s.state)).toEqual(['loading', 'playing']);
    expect(h.factory).toHaveBeenCalledWith(`https://mock.test${shared.song.audio_url}`);
    expect(h.mode).toHaveBeenCalledWith({ playsInSilentMode: true, shouldPlayInBackground: false });
    expect(h.native.play).toHaveBeenCalledTimes(1); h.controller.dispose();
    expect(h.offApp).toHaveBeenCalled(); expect(h.offAccount).toHaveBeenCalled(); expect(h.native.remove).toHaveBeenCalled();
});
test.each(['inactive', 'background', null])('cannot start while %s', async state => {
    const h = setup(); h.app(state); await h.controller.start(); expect(h.read).not.toHaveBeenCalled(); h.controller.dispose();
});
describe.each(['read', 'mode', 'load', 'seek'])('await boundary %s', stage => {
    test.each(['inactive', 'account', 'dispose', 'silent-inactive'])('%s cancels late playback', async interruption => {
        const h = setup(), wait = deferred<any>();
        if (stage === 'read') h.read.mockReturnValueOnce(wait.promise);
        if (stage === 'mode') h.mode.mockReturnValueOnce(wait.promise);
        if (stage === 'load') h.native.isLoaded = false;
        if (stage === 'seek') h.native.seekTo.mockReturnValueOnce(wait.promise);
        const flight = h.controller.start(); await flush();
        if (interruption === 'account') h.account(); else if (interruption === 'dispose') h.controller.dispose();
        else h.app('inactive', interruption !== 'silent-inactive');
        if (stage === 'load') h.status(); else wait.resolve(stage === 'read' ? shared.song : undefined);
        await flight; expect(h.native.play).not.toHaveBeenCalled(); h.controller.dispose();
    });
});
test('account change pauses and destroys a playing handle', async () => {
    const h = setup(); await h.controller.start(); h.account(); expect(h.controller.snapshot().state).toBe('paused');
    expect(h.native.pause).toHaveBeenCalled(); expect(h.native.remove).toHaveBeenCalled(); h.controller.dispose();
});
test('failed read becomes generic error without exposing transport data', async () => {
    const h = setup(); h.read.mockRejectedValueOnce(new Error(token)); await h.controller.start();
    expect(h.controller.snapshot().state).toBe('error'); expect(JSON.stringify(h.states)).not.toContain(token); h.controller.dispose();
});
test('native readiness timeout settles and disposes the handle', async () => {
    jest.useFakeTimers(); const h = setup(); h.native.isLoaded = false;
    const play = h.controller.start(); await flush(); await jest.advanceTimersByTimeAsync(30000); await play;
    expect(h.controller.snapshot().state).toBe('error'); expect(h.native.play).not.toHaveBeenCalled(); h.controller.dispose(); jest.useRealTimers();
});
