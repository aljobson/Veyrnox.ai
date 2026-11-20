import type { ApiClient } from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { createPublicPlayback } from '../src/lib/music/publicPlayback';
import { createPublicSession } from '../src/lib/music/publicSession';
import type { PlaybackStatus, PlayerState } from '../src/lib/music/player';
import { actor, commenter, slug, track, deferred } from './fixtures/musicPublic';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function setup(plays = { off: false }) {
    const session = createPublicSession(); session.available(); let appState: string | null = 'active';
    let onApp: (s: string | null) => void = () => {}, onStatus: (s: PlaybackStatus) => void = () => {};
    const states: PlayerState[] = [];
    const native = { isLoaded: true, play: jest.fn(), pause: jest.fn(), remove: jest.fn(), seekTo: jest.fn(async () => {}),
        addListener: jest.fn((_e, cb) => { onStatus = cb; return { remove: jest.fn() }; }) };
    const request = jest.fn(async (path: string) => path.includes('explore/') ? track : { counted: true });
    const mode = jest.fn(async () => {}), factory = jest.fn(() => native);
    const controller = createPublicPlayback({ api: { request } as unknown as ApiClient, session, slug, creatorId: actor, plays, baseUrl: 'https://mock.test',
        getAppState: () => appState, subscribeAppState: cb => { onApp = cb; return jest.fn(); }, factory,
        setAudioMode: mode, onState: s => states.push(s) });
    return { session, native, request, mode, factory, controller, states,
        app(s: string | null, notify = true) { appState = s; if (notify) onApp(s); },
        status(patch: Partial<PlaybackStatus>) { onStatus({ isLoaded: true, playing: true, currentTime: 1, duration: 10, didJustFinish: false, playbackState: 'ready', ...patch }); },
    };
}
test.each(['inactive', 'background', null])('never starts in %s including unknown initial state', async state => {
    const h = setup(); h.app(state, false); await h.controller.start(); expect(h.request).not.toHaveBeenCalled(); h.controller.dispose();
});
test('anonymous asset input has no auth or signed URL and count once per explicit listen, not status updates', async () => {
    const h = setup(); await h.controller.start(); h.status({}); h.status({});
    expect(h.factory).toHaveBeenCalledWith(`https://mock.test/api/music/public/${slug}/asset`);
    expect(h.native.play).toHaveBeenCalledTimes(1); expect(h.request.mock.calls.filter(([p]) => p.endsWith('/comments'))).toHaveLength(1);
    h.controller.pause(); await h.controller.start(); expect(h.request.mock.calls.filter(([p]) => p.endsWith('/comments'))).toHaveLength(2); h.controller.dispose();
});
test.each(['mirror', 'mode', 'load', 'seek'])('inactive during %s await cannot start playback', async step => {
    const h = setup(), wait = deferred<any>();
    if (step === 'mirror') h.request.mockReturnValueOnce(wait.promise);
    if (step === 'mode') h.mode.mockReturnValueOnce(wait.promise);
    if (step === 'load') h.native.isLoaded = false;
    if (step === 'seek') h.native.seekTo.mockReturnValueOnce(wait.promise);
    const flight = h.controller.start(); await flush(); h.app('inactive', false);
    if (step === 'load') h.status({ isLoaded: true }); else wait.resolve(step === 'mirror' ? track : undefined);
    await flight; expect(h.native.play).not.toHaveBeenCalled(); expect(h.request.mock.calls.filter(([p]) => p.endsWith('/comments'))).toHaveLength(0); h.controller.dispose();
});
test('block during mirror resolution invalidates pending start', async () => {
    const h = setup(), wait = deferred<any>(); h.request.mockReturnValueOnce(wait.promise); const play = h.controller.start();
    h.session.acknowledge(actor, true); wait.resolve(track); await play; expect(h.factory).not.toHaveBeenCalled(); h.controller.dispose();
});
test('block during playback disposes player and refuses further play/count', async () => {
    const h = setup(); await h.controller.start(); h.session.acknowledge(actor, true); expect(h.native.pause).toHaveBeenCalled(); expect(h.native.remove).toHaveBeenCalled();
    const calls = h.request.mock.calls.length; await h.controller.start(); expect(h.request).toHaveBeenCalledTimes(calls); h.controller.dispose();
});
test('blocks unavailable invalidates playing handles across the session', async () => {
    const h = setup(); await h.controller.start(); h.session.unavailable(); expect(h.native.remove).toHaveBeenCalled();
    await h.controller.start(); expect(h.native.play).toHaveBeenCalledTimes(1); h.controller.dispose();
});
test('plays-off disables all further count attempts for this visit', async () => {
    const h = setup(); h.request.mockImplementation(async path => { if (path.includes('explore/')) return track; throw new ApiError(404, 'music_plays_unavailable'); });
    await h.controller.start(); await flush(); h.controller.pause(); await h.controller.start();
    expect(h.request.mock.calls.filter(([p]) => p.endsWith('/comments'))).toHaveLength(1); h.controller.dispose();
});
test('automatic recovery keeps one count and cannot recover after block', async () => {
    const h = setup(); await h.controller.start(); h.status({ error: 'failed' }); await flush();
    expect(h.native.play).toHaveBeenCalledTimes(2); expect(h.request.mock.calls.filter(([p]) => p.endsWith('/comments'))).toHaveLength(1);
    h.session.acknowledge(actor, true); h.status({ error: 'failed' }); await flush(); expect(h.native.play).toHaveBeenCalledTimes(2); h.controller.dispose();
});

test('plays-off circuit survives native handle disposal and refocus within one screen visit', async () => {
    const plays = { off: false }, first = setup(plays);
    first.request.mockImplementation(async path => { if (path.includes('explore/')) return track; throw new ApiError(404, 'music_plays_unavailable'); });
    await first.controller.start(); await flush(); first.controller.dispose();
    const second = setup(plays); await second.controller.start();
    expect(second.native.play).toHaveBeenCalledTimes(1);
    expect(second.request.mock.calls.filter(([p]) => p.endsWith('/comments'))).toHaveLength(0);
    second.controller.dispose();
});

test('acknowledged block aborts a pending count_play request', async () => {
    const h = setup(), pending = deferred<any>();
    h.request.mockImplementation(path => path.includes('explore/') ? Promise.resolve(track) : pending.promise);
    await h.controller.start();
    const call = (h.request.mock.calls as unknown as [string, RequestInit][]).find(([path]) => path.endsWith('/comments'))!;
    expect(call[1].signal?.aborted).toBe(false); h.session.acknowledge(actor, true);
    expect(call[1].signal?.aborted).toBe(true); pending.resolve({ counted: false }); await flush(); h.controller.dispose();
});

test('blocking an unrelated commenter keeps already-playing creator audio running', async () => {
    const h = setup(); await h.controller.start(); const removals = h.native.remove.mock.calls.length;
    h.session.acknowledge(commenter, true); h.status({ currentTime: 4 });
    expect(h.controller.snapshot().state).toBe('playing'); expect(h.native.remove).toHaveBeenCalledTimes(removals);
    expect(h.request.mock.calls.filter(([p]) => p.endsWith('/comments'))).toHaveLength(1); h.controller.dispose();
});
