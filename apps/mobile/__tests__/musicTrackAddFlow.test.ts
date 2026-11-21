import { ApiError, type ApiClient } from '../src/lib/api';
import { resetNetworkState } from '../src/lib/network';
import { resetCacheUser, bindCacheUser } from '../src/lib/appCache';
import { createSongActionFlow } from '../src/lib/music/actionFlow';
import { createActionAttempts } from '../src/lib/music/actionAttempts';
import { trackAddAction, TRACK_ADD_REJECTIONS } from '../src/lib/music/trackAddAction';
import { subscribeSongChanges } from '../src/lib/music/songChanges';
import { getMusicCreateSession } from '../src/lib/music/createSession';
import type { TrackAddStart, TrackAddRequest, MusicTrackAddQuote } from '../src/lib/music/trackAddTypes';
import { trackSong, trackQuote, trackStart, trackReplay, trackRequest, trackFailed, partFailureRefund, vocals } from './fixtures/musicTrackAdd';
import { SONG_ID, NEXT_VERSION_ID, deferred } from './fixtures/musicActions';
let request: jest.Mock, api: ApiClient, flow: ReturnType<typeof createSongActionFlow<TrackAddStart, TrackAddRequest, MusicTrackAddQuote>>;
const posts = () => request.mock.calls.filter(([p]) => p.endsWith('/track-adds'));
const reads = () => request.mock.calls.filter(([p]) => p.includes('/track-add-requests/'));
const input = { song_id: SONG_ID, version_id: trackSong.version_id, rights_confirmed: true, parameters: vocals };
beforeEach(async () => {
    jest.useFakeTimers(); resetNetworkState(); resetCacheUser(); await bindCacheUser('track-flow-user');
    request = jest.fn(async (p: string) => p.endsWith('/track-add-quotes') ? trackQuote : p.endsWith('/track-adds') ? trackStart
        : p.includes('/track-add-requests/') ? trackRequest : trackSong);
    api = { request } as unknown as ApiClient;
    flow = createSongActionFlow(api, trackAddAction(SONG_ID), SONG_ID,
        { mintKey: () => 'fixed-12345678', poll: { initialAppState: 'active', subscribeAppState: () => () => {} } });
    await flow.load(); flow.edit({ rights_confirmed: true, parameters: vocals });
});
afterEach(() => { flow.dispose(); resetCacheUser(); jest.useRealTimers(); resetNetworkState(); });
test('review refreshes source and carries a real quote without model_id through confirmation', async () => {
    expect(request.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    flow.edit({ rights_confirmed: false }); await flow.review(); expect(flow.snapshot().error).toBe('source_rights_required');
    flow.edit({ rights_confirmed: true }); request.mockResolvedValueOnce({ ...trackSong, version_id: NEXT_VERSION_ID });
    await flow.review(); expect(posts()).toHaveLength(0);
    const pending = flow.attempts.snapshot()!;
    expect(pending).toMatchObject({ quote: trackQuote, phase: 'UNSUBMITTED', key: 'trackadd.fixed-12345678' });
    expect(Object.isFrozen(pending.quote)).toBe(true); expect(pending.quote).not.toHaveProperty('model_id');
    expect(JSON.parse(request.mock.calls.find(([p]) => p.endsWith('/track-add-quotes'))![1].body).version_id).toBe(NEXT_VERSION_ID);
    await flow.confirm(); expect(flow.snapshot().result).toEqual(trackStart); expect(flow.snapshot().balance).toBe(90);
});
test.each(['mode', 'prompt', 'lyrics', 'vocal_gender', 'lyrics_rights_confirmed', 'rights'])('%s edit invalidates quote', async key => {
    await flow.review(); flow.edit(key === 'rights' ? { rights_confirmed: false } : { parameters: { ...vocals, [key]: 'changed' } });
    expect(flow.attempts.snapshot()).toBeNull(); await flow.confirm(); expect(posts()).toHaveLength(0);
});
test('late quote after an edit is ignored', async () => {
    const wait = deferred<typeof trackQuote>(); request.mockResolvedValueOnce(trackSong).mockImplementationOnce(() => wait.promise);
    const review = flow.review(); await Promise.resolve(); flow.edit({ parameters: { ...vocals, prompt: 'new' } });
    wait.resolve(trackQuote); await review; expect(flow.attempts.snapshot()).toBeNull();
});
test.each([undefined, 76])('same-key replay after unknown acceptance and expiry shows only returned balance %p', async balance_after => {
    request.mockResolvedValueOnce(trackSong).mockResolvedValueOnce({ ...trackQuote, expires_at: new Date(Date.now() + 1000).toISOString() });
    await flow.review(); const key = flow.attempts.snapshot()!.key;
    request.mockRejectedValueOnce(new ApiError(503, 'track_add_acceptance_unknown')); await flow.confirm();
    expect(flow.attempts.snapshot()).toMatchObject({ phase: 'AMBIGUOUS', key });
    const count = request.mock.calls.length; flow.edit({ parameters: { ...vocals, prompt: 'new' } }); await flow.review();
    expect(request).toHaveBeenCalledTimes(count); expect(flow.snapshot().input.parameters).toEqual(vocals);
    await jest.advanceTimersByTimeAsync(2000); request.mockResolvedValueOnce({ ...trackReplay, balance_after }); await flow.confirm();
    expect(posts().map(([, init]) => JSON.parse(init.body))).toEqual(Array(2).fill({ quote_id: trackQuote.quote_id, idempotency_key: key }));
    expect(flow.snapshot().balance).toBe(balance_after ?? null);
});
test('ambiguous replay ignores changed affordability and expiry', async () => {
    const attempts = createActionAttempts(api, trackAddAction(SONG_ID), () => 'fixed'); attempts.prepare(trackQuote, input);
    request.mockRejectedValueOnce(new ApiError(503, 'track_add_acceptance_unknown'));
    await expect(attempts.confirm(trackQuote)).rejects.toMatchObject({ code: 'track_add_acceptance_unknown' });
    const key = attempts.snapshot()!.key; request.mockResolvedValueOnce(trackReplay);
    await expect(attempts.confirm({ ...trackQuote, affordable: false, balance: 0, expires_at: '2000-01-01T00:00:00Z' })).resolves.toEqual(trackReplay);
    expect(posts().map(([, init]) => JSON.parse(init.body).idempotency_key)).toEqual([key, key]);
});
test.each([{ affordable: false }, { expires_at: '2000-01-01T00:00:00Z' }])('unsubmitted blocker %p never spends', async patch => {
    request.mockResolvedValueOnce(trackSong).mockResolvedValueOnce({ ...trackQuote, ...patch });
    await flow.review(); await flow.confirm(); expect(posts()).toHaveLength(0); expect(flow.attempts.snapshot()?.phase).toBe('UNSUBMITTED');
});
test('double confirm sends one POST', async () => {
    await flow.review(); const wait = deferred<TrackAddStart>(); request.mockImplementationOnce(() => wait.promise);
    const first = flow.confirm(), second = flow.confirm(); await Promise.resolve(); await Promise.resolve();
    expect(posts()).toHaveLength(1); wait.resolve(trackStart); await Promise.all([first, second]); expect(flow.attempts.snapshot()).toBeNull();
});
test.each(['track_mode_invalid', 'prompt_invalid', 'vocal_gender_invalid', 'lyrics_invalid', 'lyrics_rights_required',
    'lyrics_not_applicable', 'source_rights_required', 'format_unavailable', 'source_duration_unavailable', 'revision_conflict',
    'plan_unavailable', 'model_unavailable', 'source_unavailable', 'version_id_invalid', 'song_id_invalid', 'prompt_not_allowed',
    'source_influence_invalid', 'source_duration_invalid', 'source_changed', 'source_held'])('%s is definitive with no accepted spend or polling', async code => {
    await flow.review(); request.mockRejectedValueOnce(new ApiError(409, code)); await flow.confirm();
    expect(flow.attempts.snapshot()).toBeNull(); expect(flow.snapshot()).toMatchObject({ result: null, balance: null, poll: null });
    await flow.confirm(); expect(posts()).toHaveLength(1);
});
test('unknown acceptance is not in the definitive set', () => expect(TRACK_ADD_REJECTIONS.has('track_add_acceptance_unknown')).toBe(false));
test.each(['queued', 'running', 'ready', 'failed', 'refunded'] as const)('poll handles %s without candidates or version refresh', async state => {
    const changed = jest.fn(), stop = subscribeSongChanges(changed);
    await flow.review(); await flow.confirm(); request.mockResolvedValue({ ...trackRequest, state }); await jest.advanceTimersByTimeAsync(1500);
    expect(flow.snapshot().poll).toMatchObject({ state: ['ready', 'refunded'].includes(state) ? 'done' : 'polling', value: { state } });
    expect(changed).not.toHaveBeenCalled(); expect(getMusicCreateSession(api).tracker.snapshot().entries).toHaveLength(0);
    expect(request.mock.calls.some(([p]) => p.includes('/generations/'))).toBe(false); stop();
});
test('polls queued, running, failed, delayed settlement then refunded at bounded P2 cadence', async () => {
    await flow.review(); await flow.confirm();
    request.mockResolvedValueOnce(trackRequest).mockResolvedValueOnce({ ...trackRequest, state: 'running', stage: 'part_generation' })
        .mockResolvedValueOnce(trackFailed).mockResolvedValueOnce(trackFailed).mockResolvedValueOnce(trackFailed).mockResolvedValueOnce(partFailureRefund);
    for (const [delay, state] of [[1500, 'queued'], [2250, 'running'], [3375, 'failed'], [5000, 'failed'], [5000, 'failed'], [5000, 'refunded']] as const) {
        const count = reads().length; await jest.advanceTimersByTimeAsync(delay - 1); expect(reads()).toHaveLength(count);
        await jest.advanceTimersByTimeAsync(1); expect(reads()).toHaveLength(count + 1); expect(flow.snapshot().poll?.value?.state).toBe(state);
    }
    expect(flow.snapshot().poll?.state).toBe('done'); const count = reads().length;
    await jest.advanceTimersByTimeAsync(300000); expect(reads()).toHaveLength(count);
});
test('failed settlement stops automatically at five minutes and manual refresh can observe refund', async () => {
    await flow.review(); await flow.confirm(); request.mockResolvedValue(trackFailed); await jest.advanceTimersByTimeAsync(300000);
    expect(flow.snapshot().poll).toEqual({ state: 'waiting', value: trackFailed });
    const count = reads().length; expect(count).toBeLessThanOrEqual(63); await jest.advanceTimersByTimeAsync(300000); expect(reads()).toHaveLength(count);
    request.mockResolvedValueOnce(partFailureRefund); await flow.refresh(); expect(reads()).toHaveLength(count + 1);
    expect(flow.snapshot().poll).toEqual({ state: 'done', value: partFailureRefund });
});
test('transient status failures are bounded and never manufacture failure', async () => {
    await flow.review(); await flow.confirm(); request.mockRejectedValue(new ApiError(503, 'temporarily_unavailable'));
    await jest.advanceTimersByTimeAsync(300000); expect(flow.snapshot().poll).toEqual({ state: 'waiting', value: null });
    const count = reads().length; await jest.advanceTimersByTimeAsync(10000); expect(reads()).toHaveLength(count);
});
test.each(['dispose', 'account'] as const)('%s cancels settlement and ignores in-flight status', async reason => {
    await flow.review(); await flow.confirm(); request.mockResolvedValueOnce(trackFailed); await flow.refresh();
    const wait = deferred<TrackAddRequest>(); request.mockImplementationOnce(() => wait.promise); const refreshing = flow.refresh();
    if (reason === 'dispose') flow.dispose(); else await bindCacheUser('other-user');
    wait.resolve(partFailureRefund); await refreshing; const count = request.mock.calls.length;
    await jest.advanceTimersByTimeAsync(300000); expect(request).toHaveBeenCalledTimes(count);
    expect(flow.snapshot()).toMatchObject({ result: null, poll: null }); expect(flow.isLive()).toBe(false);
});
test.each(['quote', 'confirm'] as const)('account change ignores late %s', async step => {
    const wait = deferred<unknown>();
    if (step === 'quote') request.mockResolvedValueOnce(trackSong).mockImplementationOnce(() => wait.promise);
    else { await flow.review(); request.mockImplementationOnce(() => wait.promise); }
    const pending = step === 'quote' ? flow.review() : flow.confirm();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await bindCacheUser('other-user'); wait.resolve(step === 'quote' ? trackQuote : trackStart); await pending;
    expect(flow.snapshot()).toMatchObject({ result: null, poll: null }); expect(flow.attempts.snapshot()).toBeNull();
});
test.each(['quote', 'confirm', 'status'])('call-time off at %s hides the feature', async step => {
    const off = new ApiError(404, 'music_track_add_unavailable');
    if (step === 'quote') request.mockResolvedValueOnce(trackSong).mockRejectedValueOnce(off);
    await flow.review(); if (step === 'confirm') request.mockRejectedValueOnce(off);
    if (step !== 'quote') await flow.confirm();
    if (step === 'status') { request.mockRejectedValueOnce(off); await flow.refresh(); }
    expect(flow.snapshot().status).toBe('off'); expect(flow.attempts.snapshot()).toBeNull();
});
