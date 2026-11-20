import { ApiError, type ApiClient } from '../src/lib/api';
import { resetCacheUser } from '../src/lib/appCache';
import { resetNetworkState } from '../src/lib/network';
import { createSongActionFlow } from '../src/lib/music/actionFlow';
import { createActionAttempts } from '../src/lib/music/actionAttempts';
import { stemsAction, STEM_REJECTIONS } from '../src/lib/music/stemsAction';
import { actionSong, actionQuote, stemStart, stemReplay, stemRequest, actionInput, SONG_ID, NEXT_VERSION_ID, deferred } from './fixtures/musicActions';
let request: jest.Mock, flow: ReturnType<typeof createSongActionFlow<typeof stemStart, typeof stemRequest>>;
const posts = () => request.mock.calls.filter(([p]) => p.endsWith('/stems'));
beforeEach(async () => {
    jest.useFakeTimers(); resetNetworkState();
    request = jest.fn(async (path: string) => path.endsWith('/stem-quotes') ? actionQuote : path.endsWith('/stems') ? stemStart
        : path.includes('/stem-requests/') ? stemRequest : actionSong);
    flow = createSongActionFlow({ request } as unknown as ApiClient, stemsAction(SONG_ID), SONG_ID,
        { mintKey: () => 'fixed-12345678', poll: { initialAppState: 'active', subscribeAppState: () => () => {} } });
    await flow.load(); flow.edit({ rights_confirmed: true });
});
afterEach(() => { flow.dispose(); jest.useRealTimers(); resetNetworkState(); });
test('review is free, requires rights, and uses a fresh source version', async () => {
    flow.edit({ rights_confirmed: false }); await flow.review(); expect(flow.snapshot().error).toBe('source_rights_required');
    flow.edit({ rights_confirmed: true }); request.mockResolvedValueOnce({ ...actionSong, version_id: NEXT_VERSION_ID });
    await flow.review(); expect(posts()).toHaveLength(0);
    const call = request.mock.calls.find(([p]) => p.endsWith('/stem-quotes'))!;
    expect(JSON.parse(call[1].body)).toEqual({ version_id: NEXT_VERSION_ID, rights_confirmed: true });
    expect(flow.attempts.snapshot()).toMatchObject({ input: { version_id: NEXT_VERSION_ID }, phase: 'UNSUBMITTED' });
});
test('double confirm sends one request and updates balance from the server', async () => {
    await flow.review(); const wait = deferred<typeof stemStart>(); request.mockImplementationOnce(() => wait.promise);
    const first = flow.confirm(), second = flow.confirm(); await Promise.resolve(); await Promise.resolve();
    expect(posts()).toHaveLength(1); wait.resolve({ ...stemStart, balance_after: 91 }); await Promise.all([first, second]);
    expect(flow.snapshot().balance).toBe(91); expect(flow.attempts.snapshot()).toBeNull();
});
test.each([{ affordable: false }, { expires_at: '2000-01-01T00:00:00Z' }])('unsubmitted blocker %p never sends', async patch => {
    request.mockImplementation(async p => p.endsWith('/stem-quotes') ? { ...actionQuote, ...patch } : actionSong);
    await flow.review(); await flow.confirm(); expect(posts()).toHaveLength(0);
    expect(flow.attempts.snapshot()?.phase).toBe('UNSUBMITTED');
});
test('committed recovery after expiry reuses key, blocks review/edit, and accepts replay without balance', async () => {
    const expires = new Date(Date.now() + 1000).toISOString();
    request.mockImplementation(async p => p.endsWith('/stem-quotes') ? { ...actionQuote, expires_at: expires } : actionSong);
    await flow.review(); const pending = flow.attempts.snapshot()!;
    request.mockRejectedValueOnce(new ApiError(503, 'stem_acceptance_unknown')); await flow.confirm();
    expect(flow.attempts.snapshot()).toMatchObject({ key: pending.key, phase: 'AMBIGUOUS' });
    const count = request.mock.calls.length; await flow.review(); flow.edit({ rights_confirmed: false });
    expect(request).toHaveBeenCalledTimes(count); expect(flow.snapshot().input.rights_confirmed).toBe(true);
    jest.advanceTimersByTime(2000); request.mockResolvedValueOnce(stemReplay); await flow.confirm();
    expect(posts().map(([, init]) => JSON.parse(init.body))).toEqual([
        { quote_id: pending.quote.quote_id, idempotency_key: pending.key }, { quote_id: pending.quote.quote_id, idempotency_key: pending.key },
    ]);
    expect(flow.snapshot()).toMatchObject({ balance: actionQuote.balance_after, result: stemReplay });
});
test('uncommitted replay after expiry receives definitive quote_expired and clears attempt', async () => {
    await flow.review(); request.mockRejectedValueOnce(new ApiError(503, 'stem_acceptance_unknown')); await flow.confirm();
    jest.setSystemTime(new Date('2100-01-01')); request.mockRejectedValueOnce(new ApiError(409, 'quote_expired')); await flow.confirm();
    expect(posts()).toHaveLength(2); expect(flow.attempts.snapshot()).toBeNull(); expect(flow.snapshot().error).toBe('quote_expired');
});
test('ambiguous attempts ignore affordability while an unsubmitted attempt cannot', async () => {
    const attempts = createActionAttempts({ request } as unknown as ApiClient, stemsAction(SONG_ID), () => 'same-key-1234');
    const pending = attempts.prepare(actionQuote, actionInput);
    request.mockRejectedValueOnce(new ApiError(503, 'stem_acceptance_unknown'));
    await expect(attempts.confirm(actionQuote)).rejects.toMatchObject({ code: 'stem_acceptance_unknown' });
    request.mockResolvedValueOnce(stemReplay);
    await expect(attempts.confirm({ ...actionQuote, affordable: false, balance_after: -5, expires_at: '2000-01-01' })).resolves.toEqual(stemReplay);
    expect(posts().map(([, init]) => JSON.parse(init.body).idempotency_key)).toEqual([pending.key, pending.key]); attempts.reset();
});
test('editing invalidates an unsubmitted quote and ignores a stale review response', async () => {
    await flow.review(); flow.edit({ rights_confirmed: false }); expect(flow.attempts.snapshot()).toBeNull();
    flow.edit({ rights_confirmed: true }); const wait = deferred<typeof actionQuote>();
    request.mockImplementation(async p => p.endsWith('/stem-quotes') ? wait.promise : actionSong);
    const review = flow.review(); await Promise.resolve(); await Promise.resolve();
    flow.edit({ rights_confirmed: false }); wait.resolve(actionQuote); await review;
    expect(flow.attempts.snapshot()).toBeNull(); await flow.confirm(); expect(posts()).toHaveLength(0);
});
test.each([...STEM_REJECTIONS, 'quote_stale', 'insufficient_balance'])('definitive %s clears attempt', async code => {
    const status = ['format_unavailable', 'plan_unavailable', 'model_unavailable'].includes(code) ? 503 : code === 'insufficient_balance' ? 402 : 400;
    await flow.review(); request.mockRejectedValueOnce(new ApiError(status, code));
    await flow.confirm(); expect(flow.attempts.snapshot()).toBeNull();
});
test('concurrency rejection stays retryable with the same key', async () => {
    await flow.review(); const before = flow.attempts.snapshot()!;
    request.mockRejectedValueOnce(new ApiError(409, 'concurrency_limit')); await flow.confirm();
    expect(flow.attempts.snapshot()).toEqual(before); request.mockResolvedValueOnce(stemStart); await flow.confirm();
    expect(posts().every(([, init]) => JSON.parse(init.body).idempotency_key === before.key)).toBe(true);
});
test.each(['review', 'confirm', 'poll'] as const)('%s unavailable maps to off and stops polling', async stage => {
    if (stage !== 'review') await flow.review();
    if (stage === 'poll') await flow.confirm();
    if (stage === 'review') request.mockImplementation(p => p.endsWith('/stem-quotes')
        ? Promise.reject(new ApiError(404, 'music_stems_unavailable')) : actionSong);
    else request.mockRejectedValueOnce(new ApiError(404, 'music_stems_unavailable'));
    if (stage === 'review') await flow.review();
    else if (stage === 'confirm') await flow.confirm();
    else await jest.advanceTimersByTimeAsync(1500);
    expect(flow.snapshot().status).toBe('off'); expect(flow.attempts.snapshot()).toBeNull();
    const count = request.mock.calls.length; await jest.advanceTimersByTimeAsync(10000); expect(request).toHaveBeenCalledTimes(count);
});
test('status hook commits queued then terminal ready', async () => {
    await flow.review(); await flow.confirm(); await jest.advanceTimersByTimeAsync(1500);
    expect(flow.snapshot().poll?.value?.state).toBe('queued');
    request.mockResolvedValueOnce({ ...stemRequest, state: 'ready', archive_url: '/archive' });
    await jest.advanceTimersByTimeAsync(2250); expect(flow.snapshot().poll?.state).toBe('done');
});
test.each(['dispose', 'account'] as const)('%s clears data and ignores an in-flight acceptance', async reason => {
    await flow.review(); const wait = deferred<typeof stemStart>(); request.mockImplementationOnce(() => wait.promise);
    const confirm = flow.confirm(); await Promise.resolve(); await Promise.resolve();
    if (reason === 'dispose') flow.dispose(); else resetCacheUser();
    wait.resolve(stemStart); await confirm;
    expect(flow.attempts.snapshot()).toBeNull(); expect(flow.snapshot().song).toBeNull(); expect(flow.snapshot().result).toBeNull();
    const count = request.mock.calls.length; await jest.advanceTimersByTimeAsync(10000); expect(request).toHaveBeenCalledTimes(count);
});
test('prepare mints once per quote and refuses replacement while acceptance is ambiguous', async () => {
    const mint = jest.fn(() => 'one-key-1234');
    const attempts = createActionAttempts({ request } as unknown as ApiClient, stemsAction(SONG_ID), mint);
    const first = attempts.prepare(actionQuote, actionInput);
    expect(attempts.prepare(actionQuote, actionInput)).toBe(first); expect(mint).toHaveBeenCalledTimes(1);
    request.mockRejectedValueOnce(new ApiError(503, 'stem_acceptance_unknown'));
    await expect(attempts.confirm(actionQuote)).rejects.toMatchObject({ code: 'stem_acceptance_unknown' });
    expect(() => attempts.prepare({ ...actionQuote, quote_id: 'new-quote' }, actionInput)).toThrow('pending_result');
    attempts.invalidate(); expect(attempts.snapshot()?.key).toBe(first.key); attempts.reset();
});
test('account change during connectivity preflight cannot submit under the next account', async () => {
    flow.dispose(); const wait = deferred<void>();
    flow = createSongActionFlow({ request } as unknown as ApiClient, { ...stemsAction(SONG_ID), beforeConfirm: () => wait.promise }, SONG_ID);
    await flow.load(); flow.edit({ rights_confirmed: true }); await flow.review();
    const confirm = flow.confirm(); resetCacheUser(); wait.resolve(); await confirm;
    expect(posts()).toHaveLength(0); expect(flow.snapshot().result).toBeNull();
});
test('account change discards an in-flight quote and its source', async () => {
    const wait = deferred<typeof actionQuote>();
    request.mockImplementation(p => p.endsWith('/stem-quotes') ? wait.promise : actionSong);
    const review = flow.review(); await Promise.resolve(); await Promise.resolve(); resetCacheUser();
    wait.resolve(actionQuote); await review; expect(flow.attempts.snapshot()).toBeNull(); expect(flow.snapshot().song).toBeNull();
});
