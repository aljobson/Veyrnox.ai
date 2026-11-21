import { ApiError, type ApiClient } from '../src/lib/api';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { createRenderFlow, canPlayRenderResult } from '../src/lib/music/renderFlow';
import { RENDER_DEFINITIVE_CODES } from '../src/lib/music/renderMessages';
import { renderAvailability } from '../src/lib/music/renderAvailability';
import { subscribeSongChanges } from '../src/lib/music/songChanges';
import { resetNetworkState, markOffline } from '../src/lib/network';
import { SONG_ID, VERSION_ID, NEXT_VERSION_ID, deferred } from './fixtures/musicActions';
import { renderSong, renderedSong, renderCreated, renderEarlyReplay } from './fixtures/musicRender';
let request: jest.Mock, flow: ReturnType<typeof createRenderFlow>, mint: jest.Mock;
const posts = () => request.mock.calls.filter(([p]) => p.endsWith('/render'));
beforeEach(async () => {
    resetCacheUser(); resetNetworkState(); await bindCacheUser('render-user');
    request = jest.fn().mockResolvedValue(renderSong); let n = 0; mint = jest.fn(() => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`);
    flow = createRenderFlow({ request } as unknown as ApiClient, SONG_ID, mint); await flow.load();
});
afterEach(() => { flow.dispose(); resetCacheUser(); resetNetworkState(); jest.restoreAllMocks(); });
const measured = () => flow.setDuration(12, VERSION_ID);
test('normal song has no duration; stale and non-finite callbacks cannot enable fade', async () => {
    expect('duration_seconds' in renderSong).toBe(false);
    flow.setDuration(12, NEXT_VERSION_ID); flow.setDuration(NaN, VERSION_ID); await flow.confirm();
    expect(posts()).toHaveLength(0); expect(flow.snapshot().duration).toBeNull(); measured();
    request.mockResolvedValueOnce(renderCreated).mockResolvedValueOnce(renderedSong); await flow.confirm();
    expect(flow.snapshot().duration).toBeNull(); flow.setDuration(99, VERSION_ID); expect(flow.snapshot().duration).toBeNull();
});
test('double tap sends one POST, refreshes song/library, and plays only exact result', async () => {
    measured(); const changed = jest.fn(), stop = subscribeSongChanges(changed), wait = deferred<typeof renderCreated>();
    request.mockImplementation(p => p.endsWith('/render') ? wait.promise : renderedSong);
    const a = flow.confirm(), b = flow.confirm(); await Promise.resolve(); expect(posts()).toHaveLength(1);
    wait.resolve(renderCreated); await Promise.all([a, b]);
    expect(JSON.parse(posts()[0][1].body)).toEqual({ operation: 'fade', version_id: VERSION_ID, fade_in_seconds: 1, fade_out_seconds: 1, idempotency_key: `render.${mint.mock.results[0].value}` });
    expect(changed).toHaveBeenCalledTimes(1); expect(canPlayRenderResult(flow.snapshot())).toBe(true);
    await flow.confirm(); expect(posts()).toHaveLength(1); stop();
});
test.each(['operation', 'fadeIn', 'fadeOut', 'speed', 'split', 'peak'] as const)('ambiguous attempt blocks changing %s and reload, then replays exact request', async field => {
    measured(); request.mockRejectedValueOnce(new ApiError(502, 'temporarily_unavailable')); await flow.confirm();
    const before = flow.snapshot(), body = posts()[0][1].body;
    flow.edit(field === 'operation' ? { operation: 'reverse' } : { [field]: 2 }); await flow.load();
    expect(flow.snapshot()).toEqual(before);
    request.mockResolvedValueOnce(renderEarlyReplay).mockResolvedValueOnce(renderedSong); await flow.confirm();
    expect(posts()[1][1].body).toBe(body); expect(mint).toHaveBeenCalledTimes(1); expect(flow.snapshot().result).toEqual(renderEarlyReplay);
});
test('replay after another session advanced the song keeps the result number without playback', async () => {
    measured(); request.mockRejectedValueOnce(new ApiError(502, 'temporarily_unavailable')); await flow.confirm();
    request.mockResolvedValueOnce(renderEarlyReplay).mockResolvedValueOnce({ ...renderedSong, version_id: '44444444-2222-4333-8444-555555555555' });
    await flow.confirm(); expect(flow.snapshot().result?.version_number).toBe(2); expect(canPlayRenderResult(flow.snapshot())).toBe(false);
});
test.each(RENDER_DEFINITIVE_CODES)('%s clears ambiguity and permits editing', async code => {
    measured(); request.mockRejectedValueOnce(new ApiError(400, code)); await flow.confirm();
    expect(flow.snapshot().ambiguous).toBe(false); flow.edit({ operation: 'speed' });
    expect(flow.snapshot().form.operation).toBe('speed');
});
test.each(['network', 'temporarily_unavailable', 'bad_response', 'unknown_server_error'])('%s preserves the attempt', async code => {
    measured(); request.mockRejectedValueOnce(new ApiError(code === 'network' ? 0 : 502, code)); await flow.confirm();
    expect(flow.snapshot().ambiguous).toBe(true);
    request.mockResolvedValueOnce(renderEarlyReplay).mockResolvedValueOnce(renderedSong); await flow.confirm();
    expect(posts()[1][1].body).toBe(posts()[0][1].body);
});
test('definitive error followed by input change uses a fresh signature and key', async () => {
    measured(); request.mockRejectedValueOnce(new ApiError(400, 'fade_range_invalid')); await flow.confirm(); flow.edit({ fadeIn: 0.5 });
    request.mockResolvedValueOnce(renderCreated).mockResolvedValueOnce(renderedSong); await flow.confirm();
    const bodies = posts().map(([, init]) => JSON.parse(init.body)); expect(bodies[0].idempotency_key).not.toBe(bodies[1].idempotency_key);
    expect(bodies[1].fade_in_seconds).toBe(0.5);
});
test.each(['fade_range_invalid', 'reorder_range_invalid'])('%s updates only valid same-source duration metadata', async code => {
    measured(); request.mockRejectedValueOnce(new ApiError(400, code, { duration_seconds: 1.5 })); await flow.confirm();
    expect(flow.snapshot().duration).toBe(1.5);
    request.mockResolvedValueOnce(renderedSong); await flow.load(); flow.setDuration(60, VERSION_ID); expect(flow.snapshot().duration).toBeNull();
});
test('refresh failure preserves success; refresh cannot submit again', async () => {
    measured(); request.mockResolvedValueOnce(renderCreated).mockRejectedValueOnce(new Error('refresh')); await flow.confirm();
    expect(flow.snapshot()).toMatchObject({ result: renderCreated, error: 'refresh_failed', ambiguous: false });
    expect(canPlayRenderResult(flow.snapshot())).toBe(false); await flow.confirm(); await flow.load(); expect(posts()).toHaveLength(1);
    request.mockResolvedValueOnce(renderedSong); await flow.refresh(); expect(canPlayRenderResult(flow.snapshot())).toBe(true);
});
test.each(['speed', 'remaster', 'reverse'] as const)('%s needs no client duration', async operation => {
    flow.edit({ operation }); request.mockResolvedValueOnce({ ...renderCreated, operation }).mockResolvedValueOnce(renderedSong);
    await flow.confirm(); expect(posts()).toHaveLength(1);
});
test.each(['dispose', 'account'] as const)('%s drops late responses and duration callbacks', async kind => {
    measured(); const wait = deferred<typeof renderCreated>(); request.mockReturnValueOnce(wait.promise);
    const pending = flow.confirm(); await Promise.resolve();
    if (kind === 'dispose') flow.dispose(); else await bindCacheUser('next-user');
    wait.resolve(renderCreated); await pending; flow.setDuration(20, VERSION_ID);
    expect(flow.snapshot()).toMatchObject({ result: null, song: null, duration: null }); expect(request).toHaveBeenCalledTimes(2);
});
test('old account unavailable response cannot hide new account entry', async () => {
    measured(); const wait = deferred<never>(); request.mockReturnValueOnce(wait.promise); const pending = flow.confirm(); await Promise.resolve();
    await bindCacheUser('next-user'); wait.reject(new ApiError(404, 'music_editing_unavailable')); await pending;
    expect(renderAvailability().editing).toBe(true);
});
test('call-time editing and reverse gates persist until account change', async () => {
    flow.edit({ operation: 'reverse' }); request.mockRejectedValueOnce(new ApiError(404, 'music_reverse_unavailable')); await flow.confirm();
    expect(renderAvailability().reverse).toBe(false); expect(flow.snapshot().status).toBe('on');
    flow.edit({ operation: 'speed' }); request.mockRejectedValueOnce(new ApiError(404, 'music_editing_unavailable')); await flow.confirm();
    expect(renderAvailability().editing).toBe(false); expect(flow.snapshot().status).toBe('off');
    await bindCacheUser('next-user'); expect(renderAvailability()).toEqual({ editing: true, reverse: true });
});
test.each([{ actions: [] }, { lifecycle_status: 'trashed' }])('song gating %j blocks submits', async patch => {
    request.mockResolvedValueOnce({ ...renderSong, ...patch }); await flow.load(); measured(); await flow.confirm(); expect(posts()).toHaveLength(0);
});
test('offline check sends no POST and creates no ambiguous attempt; preserves earlier ambiguity', async () => {
    measured(); markOffline(); jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline')); await flow.confirm();
    expect(posts()).toHaveLength(0); expect(mint).not.toHaveBeenCalled(); expect(flow.snapshot().ambiguous).toBe(false);
    resetNetworkState(); request.mockRejectedValueOnce(new ApiError(502, 'temporarily_unavailable')); await flow.confirm();
    markOffline(); await flow.confirm(); expect(posts()).toHaveLength(1); expect(flow.snapshot().ambiguous).toBe(true);
});
test.each([NaN, Infinity, -1, 0, '20'])('invalid range-error duration %s does not replace the measured source', async seconds => {
    measured(); request.mockRejectedValueOnce(new ApiError(400, 'fade_range_invalid', { duration_seconds: seconds })); await flow.confirm();
    expect(flow.snapshot().duration).toBe(12);
});
test('a definitive source change requires a new measurement and signs the next request with the new source', async () => {
    measured(); request.mockRejectedValueOnce(new ApiError(409, 'source_changed')); await flow.confirm();
    request.mockResolvedValueOnce(renderedSong); await flow.load(); await flow.confirm(); expect(posts()).toHaveLength(1);
    flow.setDuration(12, NEXT_VERSION_ID); request.mockResolvedValueOnce(renderCreated).mockResolvedValueOnce(renderedSong); await flow.confirm();
    expect(JSON.parse(posts()[1][1].body).version_id).toBe(NEXT_VERSION_ID); expect(mint).toHaveBeenCalledTimes(2);
});
test.each(['dispose', 'account'] as const)('%s ignores a pending source load', async kind => {
    const wait = deferred<typeof renderSong>(); request.mockReturnValueOnce(wait.promise); const pending = flow.load();
    if (kind === 'dispose') flow.dispose(); else await bindCacheUser('next-user');
    wait.resolve(renderSong); await pending; expect(flow.snapshot().song).toBeNull(); expect(flow.isLive()).toBe(false);
});
