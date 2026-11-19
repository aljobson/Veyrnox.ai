import { ApiError, type ApiClient } from '../src/lib/api';
import { createMusicPlayer, type PlaybackStatus, type PlayerState } from '../src/lib/music/player';
import { createPlaylistPlayback } from '../src/lib/music/playlistPlayback';
import { playlist, deferred, songId, secondId } from './fixtures/musicPlaylists';
import { song, JOB } from './fixtures/music';
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function setup() {
    const request = jest.fn(async (path: string) => ({ ...song, id: path.split('/').at(-1) }));
    const getAsset = jest.fn(async () => ({ url: 'https://signed.test/private', mime_type: 'audio/wav' }));
    const callbacks: ((value: string | null) => void)[] = [];
    const subscribe = (cb: (value: string | null) => void) => { callbacks.push(cb); return jest.fn(); };
    const ports: { play: jest.Mock; pause: jest.Mock; seekTo: jest.Mock; emit(s: Partial<PlaybackStatus>): void }[] = [];
    let onState!: (state: PlayerState) => void;
    const playback = createPlaylistPlayback({ api: { request } as unknown as ApiClient, songs: playlist.songs, initialAppState: 'active',
        subscribeAppState: subscribe, onState: jest.fn(), makePlayer: callback => {
            onState = callback;
            return createMusicPlayer({ getAsset, recordListen: jest.fn(async () => {}), setAudioMode: jest.fn(async () => {}),
                subscribeAppState: subscribe, onState: callback,
                factory: () => {
                    let listener!: (s: PlaybackStatus) => void;
                    const port = { isLoaded: true, play: jest.fn(), pause: jest.fn(), remove: jest.fn(), seekTo: jest.fn(async () => {}),
                        addListener: (_: string, cb: (s: PlaybackStatus) => void) => { listener = cb; return { remove: jest.fn() }; },
                        emit: (s: Partial<PlaybackStatus>) => listener({ isLoaded: true, playing: true, currentTime: 0, duration: 30, didJustFinish: false, playbackState: 'ready', ...s }) };
                    ports.push(port); return port;
                },
            });
        },
    });
    return { playback, request, getAsset, ports, change: (s: string | null) => callbacks.forEach(cb => cb(s)), emit: (s: PlayerState) => onState(s) };
}
test.each([false, true])('song resolution preserves crop provenance; canonical=%p', async canonical => {
    const s = setup(); s.request.mockResolvedValue({ ...song, id: songId, provenance: { crop: { start_seconds: 2, end_seconds: 7 }, ...(canonical ? { render_state: 'canonical' } : {}) } });
    await s.playback.start(0);
    expect(s.getAsset).toHaveBeenCalledWith(JOB); // Song detail job, never the playlist row audio_url.
    expect(s.ports[0].seekTo).toHaveBeenCalledWith(canonical ? 0 : 2);
    expect(s.ports[0].play).toHaveBeenCalledTimes(1); s.playback.dispose();
});
test('ends advance in order and unavailable songs have visible skipped ids', async () => {
    const s = setup(); await s.playback.start(0); s.ports[0].emit({ didJustFinish: true }); await flush();
    expect(s.request.mock.calls.map(([path]) => path.split('/').at(-1))).toEqual([songId, secondId]);
    expect(s.ports[1].play).toHaveBeenCalledTimes(1); s.playback.dispose();
    const other = setup(); other.request.mockRejectedValueOnce(new ApiError(404, 'not_found')); await other.playback.start(0);
    expect(other.playback.snapshot().skipped).toEqual([songId]); expect(other.playback.snapshot().index).toBe(1); other.playback.dispose();
});
test.each(['inactive', 'background', null])('no audio starts if app becomes %p during initial audio load', async state => {
    const s = setup(), wait = deferred<{ url: string; mime_type: string }>(); s.getAsset.mockReturnValueOnce(wait.promise);
    const playing = s.playback.start(0); await flush(); s.change(state); wait.resolve({ url: 'https://signed.test', mime_type: 'audio/wav' }); await playing;
    expect(s.ports.every(port => port.play.mock.calls.length === 0)).toBe(true);
    s.change('active'); await flush(); expect(s.ports.every(port => port.play.mock.calls.length === 0)).toBe(true); s.playback.dispose();
});
test('inactive during advancement load prevents the next song starting', async () => {
    const s = setup(); await s.playback.start(0); const wait = deferred<{ url: string; mime_type: string }>(); s.getAsset.mockReturnValueOnce(wait.promise);
    s.ports[0].emit({ didJustFinish: true }); await flush(); s.change('inactive'); wait.resolve({ url: 'https://signed.test', mime_type: 'audio/wav' }); await flush();
    expect(s.ports[1].play).not.toHaveBeenCalled(); s.playback.dispose();
});
test.each(['inactive', 'pause', 'dispose', 'track'])('%s invalidates delayed song resolution', async action => {
    const s = setup(), wait = deferred<typeof song>(); s.request.mockReturnValueOnce(wait.promise);
    const playing = s.playback.start(0); await flush();
    if (action === 'inactive') s.change('inactive');
    if (action === 'pause') s.playback.pause();
    if (action === 'dispose') s.playback.dispose();
    if (action === 'track') await s.playback.start(1);
    const before = s.getAsset.mock.calls.length;
    wait.resolve(song); await playing; expect(s.getAsset).toHaveBeenCalledTimes(before); s.playback.dispose();
});
test('an old ended event during a new track resolve cannot advance past the requested track', async () => {
    const s = setup(); await s.playback.start(0); const wait = deferred<typeof song>(); s.request.mockReturnValueOnce(wait.promise);
    const next = s.playback.next(); await flush(); s.ports[0].emit({ didJustFinish: true }); await flush();
    wait.resolve({ ...song, id: secondId }); await next;
    expect(s.playback.snapshot().index).toBe(1); expect(s.ports[1].play).toHaveBeenCalledTimes(1); s.playback.dispose();
});
