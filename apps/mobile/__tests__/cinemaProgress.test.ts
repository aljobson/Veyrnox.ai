import { createProgressClient, createProgressIdentity, createProgressList } from '../src/lib/cinemaProgress';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, headers: { get: () => status === 429 ? '60' : null } }) as unknown as Response;
const saved = (recorded = true, completed = false) => response({ content_id: A, recorded, completed, position_seconds: 20, duration_seconds: 100 });
const page = (ids = [A], next: string | null = null) => response({ items: ids.map((id) => ({ content_id: id, title: 'Film', display_name: 'Creator', username: 'creator', position_seconds: 20, duration_seconds: 100 })), next });
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function harness() {
    const identity = createProgressIdentity(); identity.setUser('alice');
    const fetcher = jest.fn<Promise<Response>, [string, RequestInit]>().mockResolvedValue(saved());
    const getAccessToken = jest.fn(async (_force?: boolean) => `token-${identity.getUserId()}`);
    const client = createProgressClient({ identity, getAccessToken, fetch: fetcher as unknown as typeof fetch, baseUrl: 'https://example.invalid' });
    return { identity, fetcher, getAccessToken, client };
}

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(0); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('periodic saves throttle to 15 seconds; floor responses are dropped', async () => {
    const h = harness(); h.fetcher.mockResolvedValue(saved(false));
    await h.client.save(A, 12.9);
    await h.client.save(A, 14);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(h.fetcher.mock.calls[0][1].body)).position_seconds).toBe(12);
    await jest.advanceTimersByTimeAsync(15_000);
    await h.client.save(A, 27);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
});

test('final floor response retries the captured final position once after ten seconds', async () => {
    const h = harness(); h.fetcher.mockResolvedValue(saved(false));
    await h.client.save(A, 39, true);
    await jest.advanceTimersByTimeAsync(9999); expect(h.fetcher).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1); expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(h.fetcher.mock.calls[1][1].body)).position_seconds).toBe(39);
    await jest.advanceTimersByTimeAsync(30_000); expect(h.fetcher).toHaveBeenCalledTimes(2);
});

test.each(['switch', 'signout', 'dismiss', 'newer'] as const)('%s cancels a pending final retry', async (action) => {
    const h = harness(); h.fetcher.mockResolvedValueOnce(saved(false));
    await h.client.save(A, 39, true);
    if (action === 'switch') h.identity.setUser('bob');
    if (action === 'signout') h.identity.setUser(null);
    if (action === 'dismiss') { h.fetcher.mockResolvedValueOnce(response({ removed: true })); await h.client.dismiss(A); }
    if (action === 'newer') await h.client.save(A, 40, true);
    const count = h.fetcher.mock.calls.length;
    await jest.advanceTimersByTimeAsync(20_000);
    expect(h.fetcher).toHaveBeenCalledTimes(count);
    expect(jest.getTimerCount()).toBe(0);
});

test.each(['bob', null])('account becomes %s during PUT: abort and do not replay its 401', async (user) => {
    const h = harness(); const pending = deferred<Response>(); h.fetcher.mockReturnValueOnce(pending.promise);
    const saving = h.client.save(A, 30, true); await settle();
    const signal = h.fetcher.mock.calls[0][1].signal!;
    h.identity.setUser(user);
    expect(signal.aborted).toBe(true);
    pending.resolve(response({ error: 'not_authenticated' }, 401)); await saving;
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(h.getAccessToken).toHaveBeenCalledTimes(1);
});

test('account changes during forced refresh: no replay with the new account token', async () => {
    const h = harness(); const refresh = deferred<string>();
    h.fetcher.mockResolvedValueOnce(response({ error: 'not_authenticated' }, 401));
    h.getAccessToken.mockImplementationOnce(async () => 'old').mockImplementationOnce(() => refresh.promise);
    const saving = h.client.save(A, 30, true); await settle();
    h.identity.setUser('bob'); refresh.resolve('bob-token'); await saving;
    expect(h.fetcher).toHaveBeenCalledTimes(1);
});

test('same owner can refresh and replay a 401', async () => {
    const h = harness(); h.fetcher.mockResolvedValueOnce(response({ error: 'not_authenticated' }, 401));
    h.getAccessToken.mockResolvedValueOnce('old').mockResolvedValueOnce('fresh');
    await h.client.save(A, 30, true);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.fetcher.mock.calls[1][1].headers).toMatchObject({ Authorization: 'Bearer fresh' });
});

test('dismiss waits for in-flight PUT, invalidates queued saves and suppresses later saves', async () => {
    const h = harness(); const pending = deferred<Response>(); h.fetcher.mockReturnValueOnce(pending.promise);
    const saving = h.client.save(A, 30, true); await settle();
    const queued = h.client.save(A, 31, true);
    const removing = h.client.dismiss(A); await settle();
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    pending.resolve(saved(false)); await saving; await queued; await removing;
    expect(h.fetcher.mock.calls.map(([, init]) => init.method)).toEqual(['PUT', 'DELETE']);
    await h.client.save(A, 40, true); await jest.advanceTimersByTimeAsync(20_000);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
});

test('429 backs off for Retry-After and defers a final save', async () => {
    const h = harness(); h.fetcher.mockResolvedValueOnce(response({ error: 'rate_limited' }, 429));
    await h.client.save(A, 15);
    await h.client.save(A, 20, true);
    await jest.advanceTimersByTimeAsync(59_999); expect(h.fetcher).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1); expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(h.fetcher.mock.calls[1][1].body)).position_seconds).toBe(20);
});

test('only exact flag-off closes the session, hides lists, and stops all progress calls', async () => {
    const h = harness(); h.fetcher.mockResolvedValueOnce(page());
    const list = createProgressList(h.client, jest.fn()); await list.reload();
    h.fetcher.mockResolvedValueOnce(response({ error: 'watch_progress_not_open' }, 503));
    await h.client.save(A, 20, true);
    expect(list.getSnapshot()).toMatchObject({ status: 'closed', items: [] });
    await h.client.save(B, 22, true); await h.client.dismiss(A); await list.reload();
    const remount = createProgressList(h.client, jest.fn()); await remount.reload();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    list.dispose(); remount.dispose();
});

test.each([[503, 'temporarily_unavailable'], [403, 'watch_progress_not_open']])('unrelated error %s %s does not close progress', async (status, code) => {
    const h = harness(); h.fetcher.mockResolvedValueOnce(response({ error: code }, status as number)).mockResolvedValueOnce(page());
    const list = createProgressList(h.client, jest.fn()); await list.reload(); await list.reload();
    expect(list.getSnapshot().items).toHaveLength(1); list.dispose();
});

test('signed-out identity or missing token sends no request', async () => {
    for (const missing of ['identity', 'token']) {
        const h = harness();
        if (missing === 'identity') h.identity.setUser(null); else h.getAccessToken.mockResolvedValue(null as unknown as string);
        const list = createProgressList(h.client, jest.fn()); await list.reload();
        await h.client.save(A, 20, true);
        if (missing === 'token') await expect(h.client.dismiss(A)).rejects.toMatchObject({ code: 'not_authenticated' });
        else await h.client.dismiss(A);
        expect(h.fetcher).not.toHaveBeenCalled(); list.dispose();
    }
});

test('pagination failures preserve rows and cursor; invalid cursor recovers only once', async () => {
    const h = harness(); h.fetcher.mockResolvedValueOnce(page([A], A)).mockRejectedValueOnce(new Error('offline'));
    const list = createProgressList(h.client, jest.fn()); await list.reload(); await list.loadMore();
    expect(list.getSnapshot()).toMatchObject({ items: [{ contentId: A }], next: A });
    h.fetcher.mockResolvedValueOnce(response({ error: 'invalid_cursor' }, 400)).mockResolvedValueOnce(response({ error: 'invalid_cursor' }, 400));
    await list.loadMore(); await list.loadMore();
    expect(h.fetcher).toHaveBeenCalledTimes(4);
    expect(list.getSnapshot()).toMatchObject({ items: [{ contentId: A }], next: null }); list.dispose();
});

test.each(['completed', 'dismiss'] as const)('%s removes immediately; stale lists cannot re-add it or blank other rows', async (action) => {
    const h = harness(); h.fetcher.mockResolvedValueOnce(page([A, B], B));
    const list = createProgressList(h.client, jest.fn()); await list.reload();
    const stale = deferred<Response>(); const fresh = deferred<Response>();
    h.fetcher.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(action === 'completed' ? saved(true, true) : response({ removed: true })).mockReturnValueOnce(fresh.promise);
    const loading = list.reload(); await settle();
    if (action === 'completed') await h.client.save(A, 99, true); else await h.client.dismiss(A);
    expect(list.getSnapshot().items.map((x) => x.contentId)).toEqual([B]);
    stale.resolve(page([A, B])); await settle();
    expect(list.getSnapshot().items.map((x) => x.contentId)).toEqual([B]);
    fresh.resolve(page([B])); await loading; await settle();
    expect(list.getSnapshot().items.map((x) => x.contentId)).toEqual([B]); list.dispose();
});


test('a recorder from the previous account cannot save its teardown position for the new account', async () => {
    const h = harness(); const record = h.client.recorder(A);
    h.identity.setUser('bob'); await record(40, true);
    h.identity.setUser('alice'); await record(40, true);
    expect(h.fetcher).not.toHaveBeenCalled();
});

test('completed in-flight PUT cannot cancel the queued DELETE', async () => {
    const h = harness(); const pending = deferred<Response>(); h.fetcher.mockReturnValueOnce(pending.promise);
    const saving = h.client.save(A, 99, true); await settle();
    const dismissing = h.client.dismiss(A);
    pending.resolve(saved(true, true)); await saving; await dismissing;
    expect(h.fetcher.mock.calls.map(([, init]) => init.method)).toEqual(['PUT', 'DELETE']);
});

test('closure cancels an already scheduled retry and survives identity changes', async () => {
    const h = harness(); h.fetcher.mockResolvedValueOnce(saved(false)).mockResolvedValueOnce(response({ error: 'watch_progress_not_open' }, 503));
    await h.client.save(A, 35, true); await h.client.save(B, 15, true);
    h.identity.setUser('bob'); await jest.advanceTimersByTimeAsync(20_000);
    await h.client.save(A, 20, true);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
});

test('opening another player without a newer save does not discard the final retry', async () => {
    const h = harness(); h.fetcher.mockResolvedValueOnce(saved(false));
    await h.client.save(A, 35, true);
    h.client.recorder(A); // Its play grant may fail; there is no newer saved position yet.
    await jest.advanceTimersByTimeAsync(10_000);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(h.fetcher.mock.calls[1][1].body)).position_seconds).toBe(35);
});

test('backoff extended by another request delays rather than discards a scheduled final retry', async () => {
    const h = harness(); h.fetcher.mockResolvedValueOnce(saved(false)).mockResolvedValueOnce(response({ error: 'rate_limited' }, 429));
    await h.client.save(A, 35, true);
    await jest.advanceTimersByTimeAsync(5000);
    await expect(h.client.list()).rejects.toMatchObject({ status: 429 });
    await jest.advanceTimersByTimeAsync(5000);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(55_000);
    expect(h.fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(h.fetcher.mock.calls[2][1].body)).position_seconds).toBe(35);
});

for (const code of ['profile_required', 'account_not_active']) {
    test.each(['GET', 'PUT', 'DELETE'])(`${code} from %s hides the row and suppresses progress until identity changes`, async (method) => {
        const h = harness(); h.fetcher.mockResolvedValueOnce(page());
        const list = createProgressList(h.client, jest.fn()); await list.reload();
        h.fetcher.mockResolvedValueOnce(response({ error: code }, 403));
        if (method === 'GET') await list.reload();
        else if (method === 'PUT') await h.client.save(A, 30, true);
        else await h.client.dismiss(A);
        await settle();
        expect(list.getSnapshot()).toEqual({ items: [], next: null, status: 'ready', error: null });
        expect(h.client.isClosed()).toBe(false);
        const count = h.fetcher.mock.calls.length;
        const remounted = createProgressList(h.client, jest.fn());
        await remounted.reload(); await list.reload(); await list.loadMore();
        await expect(h.client.list()).resolves.toEqual({ items: [], next: null });
        await h.client.save(B, 30, true); await h.client.dismiss(B);
        await jest.advanceTimersByTimeAsync(30_000); await h.client.save(B, 45);
        expect(h.fetcher).toHaveBeenCalledTimes(count);
        expect(remounted.getSnapshot()).toEqual({ items: [], next: null, status: 'ready', error: null });
        list.dispose(); remounted.dispose();
        h.identity.setUser(null); h.identity.setUser('bob');
        h.fetcher.mockResolvedValueOnce(page([B]));
        await expect(h.client.list()).resolves.toMatchObject({ items: [{ contentId: B }] });
        expect(h.fetcher).toHaveBeenCalledTimes(count + 1);
    });
}

test('ineligibility cancels scheduled final retries and aborts other in-flight progress work', async () => {
    const h = harness(); const pending = deferred<Response>();
    h.fetcher.mockResolvedValueOnce(saved(false)).mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce(response({ error: 'profile_required' }, 403));
    await h.client.save(A, 30, true);
    const writing = h.client.save(B, 20, true); await settle();
    const signal = h.fetcher.mock.calls[1][1].signal!;
    await expect(h.client.list()).resolves.toEqual({ items: [], next: null });
    expect(signal.aborted).toBe(true);
    pending.resolve(saved()); await writing;
    await jest.advanceTimersByTimeAsync(30_000);
    expect(h.fetcher).toHaveBeenCalledTimes(3);
    expect(jest.getTimerCount()).toBe(0);
});

test.each([[503, 'profile_required'], [400, 'account_not_active'], [403, 'locked']])('unrelated response %s %s does not suppress future progress', async (status, code) => {
    const h = harness(); h.fetcher.mockResolvedValueOnce(response({ error: code }, status as number)).mockResolvedValueOnce(page());
    const list = createProgressList(h.client, jest.fn()); await list.reload();
    expect(list.getSnapshot().status).toBe('error');
    await list.reload(); expect(list.getSnapshot().items).toHaveLength(1);
    expect(h.fetcher).toHaveBeenCalledTimes(2); list.dispose();
});
