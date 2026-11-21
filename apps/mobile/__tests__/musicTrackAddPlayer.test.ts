import { createMusicPlayer, type PlayerPort, type PlayerState } from '../src/lib/music/player';
import { getTrackAddAudio } from '../src/lib/music/client';
import type { ApiClient } from '../src/lib/api';
import { trackAudio, trackStart } from './fixtures/musicTrackAdd';
import { SONG_ID, deferred } from './fixtures/musicActions';
const input = { songId: SONG_ID, jobId: trackStart.track_job_id, trackAddRequestId: trackStart.request_id, start: 0 };
function setup() {
    const request = jest.fn(async () => trackAudio);
    const api = { request } as unknown as ApiClient;
    const getAsset = jest.fn(), recordListen = jest.fn(), states: PlayerState[] = [], ports: PlayerPort[] = [];
    const factory = jest.fn((_url: string) => {
        const port: PlayerPort = { isLoaded: true, play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(async () => {}), remove: jest.fn(),
            addListener: jest.fn(() => ({ remove: jest.fn() })) };
        ports.push(port); return port;
    });
    const controller = createMusicPlayer({ getAsset, getTrackAddAudio: id => getTrackAddAudio(api, id), factory, recordListen,
        setAudioMode: async () => {}, subscribeAppState: () => () => {}, onState: s => states.push(s) });
    return { controller, request, factory, ports, states, getAsset, recordListen };
}
test('load is memory-only, each explicit play resolves fresh audio through the client, with no song listen', async () => {
    const s = setup(); await s.controller.load(input); expect(s.request).not.toHaveBeenCalled(); expect(s.factory).not.toHaveBeenCalled();
    await s.controller.play(); expect(s.request.mock.calls[0]).toEqual([`/api/v1/music/track-add-requests/${trackStart.request_id}/audio`, {}, { timeoutMs: 15000 }]);
    expect(s.factory).toHaveBeenLastCalledWith(trackAudio.url); expect(s.ports[0].play).toHaveBeenCalledTimes(1);
    s.controller.pause(); s.request.mockResolvedValueOnce({ ...trackAudio, url: 'https://mock.test/fresh-part.mp3' });
    await s.controller.play(); expect(s.request).toHaveBeenCalledTimes(2); expect(s.factory).toHaveBeenLastCalledWith('https://mock.test/fresh-part.mp3');
    expect(s.ports[0].remove).toHaveBeenCalledTimes(1); expect(s.getAsset).not.toHaveBeenCalled(); expect(s.recordListen).not.toHaveBeenCalled();
    expect(JSON.stringify(s.states)).not.toContain('https:'); s.controller.dispose(); expect(s.ports[1].remove).toHaveBeenCalledTimes(1);
});
test.each([{ url: 'http://mock.test/part.mp3' }, { mime_type: 'text/html' }, { url: 'file:///part.mp3' }])('unsafe asset %p never reaches the native player', async patch => {
    const s = setup(); s.request.mockResolvedValueOnce({ ...trackAudio, ...patch } as typeof trackAudio);
    await s.controller.load(input); await s.controller.play(); expect(s.factory).not.toHaveBeenCalled();
    expect(s.controller.getState().state).toBe('error'); s.controller.dispose();
});
test('the player independently validates audio even when supplied by a non-client resolver', async () => {
    const factory = jest.fn();
    const controller = createMusicPlayer({ getAsset: jest.fn(), getTrackAddAudio: async () => ({ ...trackAudio, mime_type: 'video/mp4' }),
        factory, recordListen: jest.fn(), setAudioMode: async () => {}, subscribeAppState: () => () => {}, onState: jest.fn() });
    await controller.load(input); await controller.play(); expect(factory).not.toHaveBeenCalled(); expect(controller.getState().state).toBe('error'); controller.dispose();
});
test('screen disposal during audio retrieval ignores the late URL', async () => {
    const s = setup(), wait = deferred<typeof trackAudio>(); s.request.mockImplementationOnce(() => wait.promise);
    await s.controller.load(input); const playing = s.controller.play(); await Promise.resolve(); await Promise.resolve();
    expect(s.request).toHaveBeenCalledTimes(1); s.controller.dispose(); wait.resolve(trackAudio); await playing;
    expect(s.factory).not.toHaveBeenCalled();
});
test('concurrent Play gestures fetch and play once', async () => {
    const s = setup(); await s.controller.load(input); await Promise.all([s.controller.play(), s.controller.play()]);
    expect(s.request).toHaveBeenCalledTimes(1); expect(s.ports[0].play).toHaveBeenCalledTimes(1); s.controller.dispose();
});
