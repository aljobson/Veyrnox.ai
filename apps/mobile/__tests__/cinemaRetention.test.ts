import { ApiError, createApiClient } from '../src/lib/api';
import { createRetentionLifecycle, createRetentionList, fetchRetentionList, fetchRetentionState, observeRetentionState, setRetention } from '../src/lib/cinemaSocial';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const K = '33333333-3333-4333-8333-333333333333';
const row = (id: string) => ({ target_id: id, content_id: id, title: id === A ? 'First' : 'Second' });
const page = (ids: string[], next: string | null = null) => ({ items: ids.map(row), next });
const closed = () => new ApiError(503, 'retention_not_open');
const fake = () => ({ request: jest.fn<Promise<any>, [string, RequestInit?]>() });
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

// These exercise the same lifecycle objects used by SavedList and SaveFollow, with no network or native renderer.
describe('retention recovery', () => {
    test.each(['saved', 'creator', 'series'] as const)('removing the cursor entry reloads %s and reaches the remaining entries', async (kind) => {
        const api = fake();
        api.request.mockResolvedValueOnce(page([A], A)).mockResolvedValueOnce({ active: false })
            .mockResolvedValueOnce(page([B]));
        const list = createRetentionList(api, kind, jest.fn());
        await list.reload();
        await setRetention(api, kind, A, false, K);
        await settle();
        expect(list.getSnapshot()).toMatchObject({ status: 'ready', items: [{ targetId: B }], next: null });
        expect(api.request.mock.calls.map(([path]) => path)).toEqual([
            `/api/v1/cinema/retention?kind=${kind}&limit=20`, '/api/v1/cinema/retention',
            `/api/v1/cinema/retention?kind=${kind}&limit=20`,
        ]);
        list.dispose();
    });
    test('a cursor removed on another device resets and replaces the first page', async () => {
        const api = fake();
        api.request.mockResolvedValueOnce(page([A], A)).mockRejectedValueOnce(new ApiError(400, 'invalid_cursor'))
            .mockResolvedValueOnce(page([B]));
        const list = createRetentionList(api, 'saved', jest.fn());
        await list.reload();
        await list.loadMore();
        expect(list.getSnapshot()).toMatchObject({ items: [{ targetId: B }], next: null, status: 'ready' });
        expect(api.request.mock.calls[1][0]).toContain(`before_id=${A}`);
        expect(api.request.mock.calls[2][0]).not.toContain('before_id');
        list.dispose();
    });
    test('recovery retries only once; repeated end events cannot replay a dead cursor', async () => {
        const api = fake();
        api.request.mockResolvedValueOnce(page([A], A)).mockRejectedValue(new ApiError(400, 'invalid_cursor'));
        const list = createRetentionList(api, 'saved', jest.fn());
        await list.reload();
        await list.loadMore();
        await list.loadMore();
        await list.loadMore();
        expect(api.request).toHaveBeenCalledTimes(3);
        expect(list.getSnapshot()).toMatchObject({ next: null, status: 'ready', items: [{ targetId: A }], error: 'common.error' });
        list.dispose();
    });
    test('a mutation during pagination discards the old page and queues a first-page reload', async () => {
        const api = fake();
        let finish!: (value: unknown) => void;
        api.request.mockResolvedValueOnce(page([A], A)).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
            .mockResolvedValueOnce({ active: false }).mockResolvedValueOnce(page([B]));
        const list = createRetentionList(api, 'saved', jest.fn());
        await list.reload();
        const pending = list.loadMore();
        await setRetention(api, 'saved', A, false, K);
        finish(page([A]));
        await pending;
        await settle();
        expect(list.getSnapshot()).toMatchObject({ items: [{ targetId: B }], next: null });
        expect(api.request).toHaveBeenCalledTimes(4);
        list.dispose();
    });
});

describe('terminal retention closure', () => {
    test.each(['initial', 'pagination', 'write'] as const)('%s closure stops every read and write for this client session', async (where) => {
        const api = fake();
        if (where !== 'initial') api.request.mockResolvedValueOnce(page([A], A));
        api.request.mockRejectedValueOnce(closed()).mockResolvedValue(page([B]));
        const list = createRetentionList(api, 'saved', jest.fn());
        await list.reload();
        if (where === 'pagination') await list.loadMore();
        if (where === 'write') await expect(setRetention(api, 'saved', A, false, K)).rejects.toMatchObject({ code: 'retention_not_open' });
        const count = api.request.mock.calls.length;
        expect(list.getSnapshot()).toMatchObject({ status: 'closed', next: null });
        await list.loadMore();
        await list.reload();
        await expect(fetchRetentionList(api, 'creator')).rejects.toMatchObject({ code: 'retention_not_open' });
        await expect(fetchRetentionState(api, B)).rejects.toMatchObject({ code: 'retention_not_open' });
        await expect(setRetention(api, 'series', B, true, K)).rejects.toMatchObject({ code: 'retention_not_open' });
        const remounted = createRetentionList(api, 'series', jest.fn());
        await remounted.reload();
        expect(remounted.getSnapshot().status).toBe('closed');
        expect(api.request).toHaveBeenCalledTimes(count);
        list.dispose();
        remounted.dispose();
    });
    test('a successful in-flight read cannot reopen closed controls', async () => {
        const api = fake();
        let finish!: (value: unknown) => void;
        api.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockRejectedValueOnce(closed());
        const seen = jest.fn();
        const off = observeRetentionState(api, A, seen);
        await expect(setRetention(api, 'saved', A, true, K)).rejects.toMatchObject({ code: 'retention_not_open' });
        finish({ saved: true, creator_id: B });
        await settle();
        expect(seen).toHaveBeenLastCalledWith({ kind: 'closed' });
        expect(seen.mock.calls.some(([r]) => r.kind === 'ok')).toBe(false);
        off();
    });
    test('transient 503 and a wrong-status not-open response remain retryable', async () => {
        for (const error of [new ApiError(503, 'temporarily_unavailable'), new ApiError(403, 'retention_not_open')]) {
            const api = fake();
            api.request.mockRejectedValueOnce(error).mockResolvedValueOnce(page([A]));
            const list = createRetentionList(api, 'saved', jest.fn());
            await list.reload();
            expect(list.getSnapshot().status).toBe('error');
            await list.reload();
            expect(list.getSnapshot().status).toBe('ready');
            list.dispose();
        }
    });
    test('a fresh app client can read again', async () => {
        const previous = fake();
        previous.request.mockRejectedValue(closed());
        await expect(fetchRetentionState(previous, A)).rejects.toThrow();
        const nextSession = fake();
        nextSession.request.mockResolvedValue({ saved: true });
        expect(await fetchRetentionState(nextSession, A)).toMatchObject({ saved: true });
    });
});

describe('mutation refresh and authentication', () => {
    test.each(['saved', 'creator', 'series'] as const)('%s mutations refresh matching mounted lists and title controls only', async (kind) => {
        const api = fake();
        let active = false;
        api.request.mockImplementation(async (path, init) => {
            if (init?.method === 'POST') { active = JSON.parse(String(init.body)).active; return { active }; }
            if (path.includes('content_id')) return { saved: active, following_creator: active, following_series: active, creator_id: B, series_id: A };
            return page(active ? [A] : []);
        });
        const list = createRetentionList(api, kind, jest.fn());
        const otherKind = kind === 'saved' ? 'series' : 'saved';
        const other = createRetentionList(api, otherKind, jest.fn());
        await list.reload();
        await other.reload();
        const seen = jest.fn();
        const off = observeRetentionState(api, A, seen);
        await settle();
        for (const value of [true, false]) {
            await setRetention(api, kind, kind === 'creator' ? B : A, value, K);
            await settle();
            expect(list.getSnapshot().items).toHaveLength(value ? 1 : 0);
            expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'ok', value: expect.objectContaining({ saved: value }) }));
        }
        expect(api.request.mock.calls.filter(([path]) => path.includes(`kind=${otherKind}`))).toHaveLength(1);
        list.dispose(); other.dispose(); off();
        const count = api.request.mock.calls.length;
        await setRetention(api, kind, A, true, K);
        await settle();
        expect(api.request).toHaveBeenCalledTimes(count + 1);
    });
    test('signed-out client sends no private retention request', async () => {
        const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('Must not fetch'); });
        try {
            const api = createApiClient({ baseUrl: 'https://example.invalid', getAccessToken: async () => null, onSessionLost: jest.fn() });
            await expect(fetchRetentionState(api, A)).rejects.toMatchObject({ code: 'not_authenticated' });
            await expect(fetchRetentionList(api, 'saved')).rejects.toMatchObject({ code: 'not_authenticated' });
            await expect(setRetention(api, 'saved', A, true, K)).rejects.toMatchObject({ code: 'not_authenticated' });
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally { fetchSpy.mockRestore(); }
    });
});


describe('inspection regressions', () => {
    test('pagination failure keeps rows and cursor, and a later end event retries', async () => {
        const api = fake();
        api.request.mockResolvedValueOnce(page([A], A)).mockRejectedValueOnce(new ApiError(0, 'network')).mockResolvedValueOnce(page([B]));
        const list = createRetentionList(api, 'saved', jest.fn());
        await list.reload();
        await list.loadMore();
        expect(list.getSnapshot()).toMatchObject({ status: 'ready', items: [{ targetId: A }], next: A, error: 'cinemaSocial.err.network' });
        await list.loadMore();
        expect(list.getSnapshot()).toMatchObject({ status: 'ready', items: [{ targetId: A }, { targetId: B }], error: null });
        expect(api.request.mock.calls[2][0]).toContain(`before_id=${A}`);
        list.dispose();
    });
    test.each(['mutation', 'invalid_cursor'] as const)('%s reload keeps visible rows until replacement arrives', async (reason) => {
        const api = fake();
        let finish!: (value: unknown) => void;
        api.request.mockResolvedValueOnce(page([A], A));
        if (reason === 'mutation') api.request.mockResolvedValueOnce({ active: false });
        else api.request.mockRejectedValueOnce(new ApiError(400, 'invalid_cursor'));
        api.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const list = createRetentionList(api, 'saved', jest.fn());
        await list.reload();
        const pending = reason === 'mutation' ? setRetention(api, 'saved', A, false, K) : list.loadMore();
        await settle();
        expect(list.getSnapshot()).toMatchObject({ status: 'ready', items: [{ targetId: A }], next: null });
        finish(page([B]));
        await pending;
        await settle();
        expect(list.getSnapshot()).toMatchObject({ status: 'ready', items: [{ targetId: B }] });
        list.dispose();
    });
    test('a successful write finishing after closure returns its result and still notifies', async () => {
        const api = fake();
        let finish!: (value: unknown) => void;
        api.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockRejectedValueOnce(closed());
        const changed = jest.fn();
        const list = createRetentionList(api, 'saved', changed);
        const write = setRetention(api, 'saved', A, true, K);
        await expect(fetchRetentionState(api, A)).rejects.toMatchObject({ code: 'retention_not_open' });
        changed.mockClear();
        finish({ active: true });
        await expect(write).resolves.toBe(true);
        expect(changed).toHaveBeenCalledWith(expect.objectContaining({ status: 'closed' }));
        expect(api.request).toHaveBeenCalledTimes(2);
        list.dispose();
    });
    test.each(['read', 'write'] as const)('an in-flight %s preserves an unrelated error after closure', async (operation) => {
        const api = fake();
        let reject!: (reason: unknown) => void;
        api.request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockRejectedValueOnce(closed());
        const pending = operation === 'write' ? setRetention(api, 'saved', A, true, K) : fetchRetentionState(api, A);
        const error = new ApiError(503, 'temporarily_unavailable');
        const result = expect(pending).rejects.toBe(error);
        await expect(fetchRetentionList(api, 'saved')).rejects.toMatchObject({ code: 'retention_not_open' });
        reject(error);
        await result;
    });
    test('a retained onEndReached callback sends nothing after closure or disposal', async () => {
        const api = fake();
        api.request.mockResolvedValueOnce(page([A], A)).mockRejectedValueOnce(closed());
        const list = createRetentionList(api, 'saved', jest.fn());
        await list.reload();
        const onEndReached = list.loadMore;
        await expect(fetchRetentionState(api, A)).rejects.toThrow();
        await onEndReached();
        list.dispose();
        await onEndReached();
        expect(api.request).toHaveBeenCalledTimes(2);
    });
    test.each(['signedOut', 'loading'])('%s lifecycle never starts control reads or writes', async (status) => {
        const api = fake();
        const lifecycle = createRetentionLifecycle(api, status);
        const busy = jest.fn();
        lifecycle.start(() => observeRetentionState(api, A, jest.fn()));
        await lifecycle.write(() => setRetention(api, 'saved', A, true, K), { busy, success: jest.fn(), error: jest.fn() });
        await settle();
        expect(api.request).not.toHaveBeenCalled();
        expect(busy).not.toHaveBeenCalled();
        lifecycle.dispose();
    });
    test('the shared write guard suppresses duplicate taps and writes after closure', async () => {
        const api = fake();
        let finish!: (value: unknown) => void;
        api.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockRejectedValueOnce(closed());
        const lifecycle = createRetentionLifecycle(api, 'signedIn');
        const callbacks = { busy: jest.fn(), success: jest.fn(), error: jest.fn() };
        const run = () => setRetention(api, 'saved', A, true, K);
        const pending = lifecycle.write(run, callbacks);
        await lifecycle.write(run, callbacks);
        expect(api.request).toHaveBeenCalledTimes(1);
        await expect(fetchRetentionState(api, A)).rejects.toThrow();
        finish({ active: true });
        await pending;
        await lifecycle.write(run, callbacks);
        expect(api.request).toHaveBeenCalledTimes(2);
        expect(callbacks.busy.mock.calls).toEqual([[true], [false]]);
        expect(callbacks.success).toHaveBeenCalledWith(true);
        expect(callbacks.error).not.toHaveBeenCalled();
        lifecycle.dispose();
    });
    test.each(['success', 'error'] as const)('unmount resets writes/removals and suppresses late %s callbacks', async (outcome) => {
        const api = fake();
        const old = createRetentionLifecycle(api, 'signedIn');
        const current = createRetentionLifecycle(api, 'signedIn');
        let finish!: (value: boolean) => void;
        let fail!: (reason: unknown) => void;
        const callbacks = { busy: jest.fn(), success: jest.fn(), error: jest.fn() };
        const pending = old.write(() => new Promise<boolean>((resolve, reject) => { finish = resolve; fail = reject; }), callbacks);
        expect(old.isWriting()).toBe(true);
        old.dispose();
        expect(old.isWriting()).toBe(false);
        const run = jest.fn(async () => true);
        await old.write(run, callbacks);
        old.start(run);
        expect(run).not.toHaveBeenCalled();
        await current.write(run, { busy: jest.fn(), success: jest.fn(), error: jest.fn() });
        expect(run).toHaveBeenCalledTimes(1);
        if (outcome === 'success') finish(true); else fail(new Error('offline'));
        await pending;
        expect(callbacks.busy.mock.calls).toEqual([[true]]);
        expect(callbacks.success).not.toHaveBeenCalled();
        expect(callbacks.error).not.toHaveBeenCalled();
        expect(current.isWriting()).toBe(false);
        current.dispose();
    });
});
