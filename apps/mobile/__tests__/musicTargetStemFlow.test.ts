import { ApiError, type ApiClient } from '../src/lib/api';
import { resetNetworkState } from '../src/lib/network';
import { createSongActionFlow } from '../src/lib/music/actionFlow';
import { createActionAttempts } from '../src/lib/music/actionAttempts';
import { targetStemsAction, TARGET_STEM_REJECTIONS } from '../src/lib/music/targetStemsAction';
import { targetSong, targetQuote, targetStart, targetReplay, targetRequest } from './fixtures/musicTargetStems';
import { SONG_ID, NEXT_VERSION_ID, deferred } from './fixtures/musicActions';
let request: jest.Mock, flow: ReturnType<typeof createSongActionFlow<typeof targetStart, typeof targetRequest>>;
const posts = () => request.mock.calls.filter(([p]) => p.endsWith('/target-stems'));
const input = { song_id: SONG_ID, version_id: targetSong.version_id, rights_confirmed: true, parameters: { instrument: 'guitar' } };
beforeEach(async () => {
    jest.useFakeTimers(); resetNetworkState();
    request = jest.fn(async (p: string) => p.endsWith('/target-stem-quotes') ? targetQuote : p.endsWith('/target-stems') ? targetStart
        : p.includes('/target-stem-requests/') ? targetRequest : targetSong);
    flow = createSongActionFlow({ request } as unknown as ApiClient, targetStemsAction(SONG_ID), SONG_ID,
        { mintKey: () => 'fixed-12345678', poll: { initialAppState: 'active', subscribeAppState: () => () => {} } });
    await flow.load(); flow.edit({ rights_confirmed: true, parameters: input.parameters });
});
afterEach(() => { flow.dispose(); jest.useRealTimers(); resetNetworkState(); });
test('review refreshes source, requires rights and never spends; editing instrument invalidates prepared quote', async () => {
    flow.edit({ rights_confirmed: false }); await flow.review(); expect(flow.snapshot().error).toBe('source_rights_required');
    flow.edit({ rights_confirmed: true }); request.mockResolvedValueOnce({ ...targetSong, version_id: NEXT_VERSION_ID });
    await flow.review(); expect(posts()).toHaveLength(0);
    expect(JSON.parse(request.mock.calls.find(([p]) => p.endsWith('/target-stem-quotes'))![1].body))
        .toEqual({ version_id: NEXT_VERSION_ID, instrument: 'guitar', rights_confirmed: true });
    flow.edit({ parameters: { instrument: 'piano' } }); expect(flow.attempts.snapshot()).toBeNull();
    await flow.confirm(); expect(posts()).toHaveLength(0);
});
test('late quote for prior instrument cannot become prepared', async () => {
    const wait = deferred<typeof targetQuote>(); request.mockImplementationOnce(async () => targetSong).mockImplementationOnce(() => wait.promise);
    const review = flow.review(); await Promise.resolve(); flow.edit({ parameters: { instrument: 'piano' } });
    wait.resolve(targetQuote); await review; expect(flow.attempts.snapshot()).toBeNull();
});
test('double confirm sends one request and displays actual 76 rather than quoted 96', async () => {
    await flow.review(); const wait = deferred<typeof targetStart>(); request.mockImplementationOnce(() => wait.promise);
    const first = flow.confirm(), second = flow.confirm(); await Promise.resolve(); await Promise.resolve();
    expect(posts()).toHaveLength(1); wait.resolve({ ...targetStart, balance_after: 76 }); await Promise.all([first, second]);
    expect(flow.snapshot().balance).toBe(76); expect(flow.attempts.snapshot()).toBeNull();
});
test.each([{ affordable: false }, { expires_at: '2000-01-01T00:00:00Z' }])('unsubmitted %p never spends', async patch => {
    request.mockImplementation(async p => p.endsWith('/target-stem-quotes') ? { ...targetQuote, ...patch } : targetSong);
    await flow.review(); await flow.confirm(); expect(posts()).toHaveLength(0); expect(flow.attempts.snapshot()?.phase).toBe('UNSUBMITTED');
});
test('ambiguous same-key replay after expiry blocks edits/new quotes and omits stale balance', async () => {
    request.mockImplementation(async p => p.endsWith('/target-stem-quotes') ? { ...targetQuote, expires_at: new Date(Date.now() + 1000).toISOString() } : targetSong);
    await flow.review(); const pending = flow.attempts.snapshot()!;
    request.mockRejectedValueOnce(new ApiError(503, 'target_stem_acceptance_unknown')); await flow.confirm();
    expect(flow.attempts.snapshot()).toMatchObject({ phase: 'AMBIGUOUS', key: pending.key });
    const count = request.mock.calls.length; flow.edit({ parameters: { instrument: 'piano' } }); await flow.review();
    expect(request).toHaveBeenCalledTimes(count); expect(flow.snapshot().input.parameters).toEqual(input.parameters);
    jest.advanceTimersByTime(2000); request.mockResolvedValueOnce(targetReplay); await flow.confirm();
    expect(posts().map(([, init]) => JSON.parse(init.body))).toEqual(Array(2).fill({ quote_id: targetQuote.quote_id, idempotency_key: pending.key }));
    expect(flow.snapshot()).toMatchObject({ result: targetReplay, balance: null });
});
test('ambiguous attempts bypass lower balance and expiry in the attempt layer', async () => {
    const attempts = createActionAttempts({ request } as unknown as ApiClient, targetStemsAction(SONG_ID), () => 'fixed-12345678');
    attempts.prepare(targetQuote, input); request.mockRejectedValueOnce(new ApiError(503, 'target_stem_acceptance_unknown'));
    await expect(attempts.confirm(targetQuote)).rejects.toMatchObject({ code: 'target_stem_acceptance_unknown' });
    const key = attempts.snapshot()!.key; request.mockResolvedValueOnce(targetReplay);
    await expect(attempts.confirm({ ...targetQuote, affordable: false, balance: 0, expires_at: '2000-01-01T00:00:00Z' })).resolves.toEqual(targetReplay);
    expect(posts().map(([, init]) => JSON.parse(init.body).idempotency_key)).toEqual([key, key]);
});
test.each([...TARGET_STEM_REJECTIONS, 'quote_expired'])('%s is definitive and clears recovery', async code => {
    await flow.review(); request.mockRejectedValueOnce(new ApiError(503, 'target_stem_acceptance_unknown')); await flow.confirm();
    request.mockRejectedValueOnce(new ApiError(409, code)); await flow.confirm();
    expect(flow.attempts.snapshot()).toBeNull(); expect(flow.snapshot().result).toBeNull(); expect(flow.snapshot().balance).toBeNull();
});
test('hold introduced after quote clears attempt with no accepted job or spent balance', async () => {
    await flow.review(); request.mockRejectedValueOnce(new ApiError(409, 'source_held')); await flow.confirm();
    expect(posts()).toHaveLength(1); expect(flow.attempts.snapshot()).toBeNull();
    expect(flow.snapshot()).toMatchObject({ error: 'source_held', result: null, balance: null, poll: null });
});
test('unreadable/overlong source cannot prepare or spend', async () => {
    request.mockImplementation(async p => { if (p.endsWith('/target-stem-quotes')) throw new ApiError(400, 'source_duration_unavailable'); return targetSong; });
    await flow.review(); await flow.confirm(); expect(flow.snapshot().error).toBe('source_duration_unavailable');
    expect(flow.attempts.snapshot()).toBeNull(); expect(posts()).toHaveLength(0);
});
test.each(['queued', 'running', 'ready', 'failed', 'refunded'] as const)('poll handles %s', async state => {
    await flow.review(); await flow.confirm();
    request.mockResolvedValue({ ...targetRequest, state, outputs: state === 'ready' ? ['target', 'residual'] : [] });
    await jest.advanceTimersByTimeAsync(1500);
    expect(flow.snapshot().poll).toMatchObject({ state: ['ready', 'failed', 'refunded'].includes(state) ? 'done' : 'polling', value: { state } });
});
test('call-time unavailable removes pending controls', async () => {
    await flow.review(); request.mockRejectedValueOnce(new ApiError(404, 'music_target_stems_unavailable')); await flow.confirm();
    expect(flow.snapshot().status).toBe('off'); expect(flow.attempts.snapshot()).toBeNull();
});
