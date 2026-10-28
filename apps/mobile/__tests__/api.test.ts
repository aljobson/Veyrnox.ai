import { ApiError, createApiClient, isServiceUnavailable } from '../src/lib/api';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const status = (code: number, body: unknown = {}) => new Response(JSON.stringify(body), { status: code });

describe('api client', () => {
    const fetchMock = jest.fn();
    beforeEach(() => {
        fetchMock.mockReset();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });

    function client(getAccessToken: (force?: boolean) => Promise<string | null>) {
        const onSessionLost = jest.fn();
        return { onSessionLost, api: createApiClient({ baseUrl: 'https://x.test', getAccessToken, onSessionLost }) };
    }

    test('beforeSend runs first and can stop a call before anything leaves the phone', async () => {
        const getAccessToken = jest.fn(async () => 'tok');
        const beforeSend = jest.fn(async (path: string) => {
            if (path === '/api/v1/generations') throw new ApiError(400, 'consent_declined');
        });
        const api = createApiClient({ baseUrl: 'https://x.test', getAccessToken, onSessionLost: jest.fn(), beforeSend });
        await expect(api.request('/api/v1/generations', { method: 'POST' })).rejects.toMatchObject({ code: 'consent_declined' });
        await expect(api.stream('/api/v1/generations', { method: 'POST' })).rejects.toMatchObject({ code: 'consent_declined' });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(getAccessToken).not.toHaveBeenCalled();
        expect(beforeSend).toHaveBeenCalledWith('/api/v1/generations', 'POST');
    });

    test('sends the bearer token and parses the balance', async () => {
        fetchMock.mockResolvedValue(ok({ balance: 7, free_credits: 2, free_expires_at: null }));
        const { api } = client(async () => 'tok');
        await expect(api.getBalance()).resolves.toEqual({ balance: 7, free_credits: 2, free_expires_at: null });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://x.test/api/v1/balance');
        expect(init.headers.Authorization).toBe('Bearer tok');
    });

    test('retries once with a forced refresh after a 401', async () => {
        fetchMock.mockResolvedValueOnce(status(401)).mockResolvedValueOnce(ok({ balance: 1, free_credits: 0, free_expires_at: null }));
        const getAccessToken = jest.fn(async (force?: boolean) => (force ? 'fresh' : 'stale'));
        const { api, onSessionLost } = client(getAccessToken);
        await api.getBalance();
        expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh');
        expect(onSessionLost).not.toHaveBeenCalled();
    });

    test('reports a lost session when the retry is also rejected', async () => {
        fetchMock.mockResolvedValue(status(401));
        const { api, onSessionLost } = client(async (force) => (force ? 'fresh' : 'stale'));
        await expect(api.getBalance()).rejects.toMatchObject({ status: 401, code: 'not_authenticated' });
        expect(onSessionLost).toHaveBeenCalledTimes(1);
    });

    test('reports a lost session without calling the network when there is no token', async () => {
        const { api, onSessionLost } = client(async () => null);
        await expect(api.getBalance()).rejects.toBeInstanceOf(ApiError);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(onSessionLost).toHaveBeenCalledTimes(1);
    });

    test('surfaces the typed error code from the server', async () => {
        fetchMock.mockResolvedValue(status(429, { error: 'rate_limited' }));
        const { api } = client(async () => 'tok');
        await expect(api.getBalance()).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
    });

    test('maps a network failure to status 0', async () => {
        fetchMock.mockRejectedValue(new TypeError('offline'));
        const { api } = client(async () => 'tok');
        await expect(api.getBalance()).rejects.toMatchObject({ status: 0, code: 'network' });
    });
    test('a 503 service_unavailable is a retryable outage: the session is kept and Retry-After is passed on', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'service_unavailable', requestId: 'r1' }), {
            status: 503, headers: { 'retry-after': '10' },
        }));
        const { api, onSessionLost } = client(async () => 'tok');
        const err = await api.getBalance().catch((e: unknown) => e);
        expect(isServiceUnavailable(err)).toBe(true);
        expect((err as ApiError).retryAfterSeconds).toBe(10);
        expect(onSessionLost).not.toHaveBeenCalled();
        expect(isServiceUnavailable(new ApiError(500, 'internal'))).toBe(false);
    });
});

describe('session fence', () => {
    const jwt = (sub: string, n = 0) => `h.${btoa(JSON.stringify({ sub, n }))}.s`;
    const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
    const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    function setup() {
        const state = { gen: 7, user: 'A' };
        const beginSessionTask = jest.fn(() => {
            const { gen, user } = state;
            return { gen, user, current: () => state.gen === gen && state.user === user };
        });
        const getAccessToken = jest.fn<Promise<string | null>, [boolean?, number?]>(async force => jwt('A', force ? 1 : 0));
        const onSessionLost = jest.fn(), beforeSend = jest.fn(async () => {});
        const send = jest.fn<Promise<Response>, [any, any]>(async () => ok({ done: true }));
        globalThis.fetch = send;
        const api = createApiClient({ baseUrl: 'https://x.test', beginSessionTask, getAccessToken, onSessionLost, beforeSend, streamFetch: send });
        return { api, state, beginSessionTask, getAccessToken, onSessionLost, beforeSend, send };
    }
    test('same-user forced token is resent once and every token call carries the task generation', async () => {
        const x = setup(); x.send.mockResolvedValueOnce(status(401));
        await x.api.request('/post', { method: 'POST' });
        expect(x.getAccessToken.mock.calls).toEqual([[false, 7], [true, 7]]);
        expect(x.send).toHaveBeenCalledTimes(2);
        expect(x.send.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${jwt('A', 1)}`);
        expect(x.onSessionLost).not.toHaveBeenCalled();
    });
    test.each(['request', 'stream'] as const)('%s never resends a different user after 401', async method => {
        const x = setup(); x.send.mockResolvedValueOnce(status(401));
        x.getAccessToken.mockResolvedValueOnce(jwt('A')).mockResolvedValueOnce(jwt('B'));
        await expect(x.api[method]('/post')).rejects.toMatchObject({ status: 401, code: 'account_changed' });
        expect(x.send).toHaveBeenCalledTimes(1); expect(x.onSessionLost).not.toHaveBeenCalled();
        expect(JSON.stringify(x.send.mock.calls)).not.toContain(jwt('B'));
    });
    test.each(['request', 'stream'] as const)('%s waiting in beforeSend calls no token source after a switch', async method => {
        const x = setup(), gate = deferred<void>(); x.beforeSend.mockReturnValueOnce(gate.promise);
        const result = x.api[method]('/post').catch(e => e);
        x.state.gen++; x.state.user = 'B'; gate.resolve();
        expect(await result).toMatchObject({ status: 401, code: 'account_changed' });
        expect(x.getAccessToken).not.toHaveBeenCalled(); expect(x.send).not.toHaveBeenCalled(); expect(x.onSessionLost).not.toHaveBeenCalled();
    });
    test('generation bumped during first send prevents forced refresh and resend', async () => {
        const x = setup(), gate = deferred<Response>(); x.send.mockReturnValueOnce(gate.promise);
        const result = x.api.request('/post').catch(e => e); await tick(); x.state.gen++; gate.resolve(status(401));
        expect(await result).toMatchObject({ code: 'account_changed' });
        expect(x.getAccessToken.mock.calls).toEqual([[false, 7]]); expect(x.send).toHaveBeenCalledTimes(1);
    });
    test('generation bumped during retry prevents session loss', async () => {
        const x = setup(), gate = deferred<Response>(); x.send.mockResolvedValueOnce(status(401)).mockReturnValueOnce(gate.promise);
        const result = x.api.request('/post').catch(e => e); await tick(); x.state.gen++; gate.resolve(status(401));
        expect(await result).toMatchObject({ code: 'account_changed' }); expect(x.onSessionLost).not.toHaveBeenCalled();
    });
    test('null token resolving after a bump causes no session loss', async () => {
        const x = setup(), gate = deferred<string | null>(); x.getAccessToken.mockReturnValueOnce(gate.promise);
        const result = x.api.request('/post').catch(e => e); await tick(); x.state.gen++; gate.resolve(null);
        expect(await result).toMatchObject({ code: 'account_changed' }); expect(x.send).not.toHaveBeenCalled(); expect(x.onSessionLost).not.toHaveBeenCalled();
    });
    test('a token source throwing account_changed is normalized to ApiError without session loss', async () => {
        const x = setup();
        const { AuthError } = jest.requireActual('../src/lib/auth/supabaseAuth');
        x.getAccessToken.mockRejectedValueOnce(new AuthError(401, 'account_changed'));
        const error = await x.api.request('/post').catch(e => e);
        expect(error).toBeInstanceOf(ApiError); expect(error).toMatchObject({ status: 401, code: 'account_changed' });
        expect(x.onSessionLost).not.toHaveBeenCalled(); expect(x.send).not.toHaveBeenCalled();
    });
    test('a first token for another user is not sent', async () => {
        const x = setup(); x.getAccessToken.mockResolvedValueOnce(jwt('B'));
        await expect(x.api.request('/post')).rejects.toMatchObject({ code: 'account_changed' }); expect(x.send).not.toHaveBeenCalled();
    });
    test('a passed task replaces the factory task, including a stale multi-call task', async () => {
        const x = setup(), task = x.beginSessionTask(); x.beginSessionTask.mockClear();
        await x.api.request('/post', {}, { task }); x.state.gen++;
        await expect(x.api.stream('/post', {}, { task })).rejects.toMatchObject({ code: 'account_changed' });
        expect(x.beginSessionTask).not.toHaveBeenCalled(); expect(x.send).toHaveBeenCalledTimes(1);
    });
    test('without beginSessionTask the token source gets one argument', async () => {
        const x = setup(); x.send.mockResolvedValueOnce(status(401));
        const api = createApiClient({ baseUrl: 'https://x.test', getAccessToken: x.getAccessToken, onSessionLost: x.onSessionLost });
        await api.request('/post'); expect(x.getAccessToken.mock.calls).toEqual([[false], [true]]);
    });
    test('same-generation retry 401 reports loss exactly once with captured generation', async () => {
        const x = setup(); x.send.mockResolvedValue(status(401));
        await expect(x.api.request('/post')).rejects.toMatchObject({ code: 'not_authenticated' });
        expect(x.onSessionLost.mock.calls).toEqual([[7]]);
    });
    test('owner mismatch sends nothing and owner match is unchanged', async () => {
        const x = setup();
        await expect(x.api.request('/post', {}, { owner: 'B' })).rejects.toMatchObject({ code: 'account_changed' });
        expect(x.send).not.toHaveBeenCalled(); await x.api.request('/post', {}, { owner: 'A' }); expect(x.send).toHaveBeenCalledTimes(1);
    });
    test.each([403, 429, 503])('completed %s preserves its status, code and body across a switch', async code => {
        const x = setup(), gate = deferred<Response>(); x.send.mockReturnValueOnce(gate.promise);
        const result = x.api.request('/post').catch(e => e); await tick(); x.state.gen++;
        gate.resolve(status(code, { error: 'original', detail: 42 }));
        expect(await result).toMatchObject({ status: code, code: 'original', body: { error: 'original', detail: 42 } });
        expect(x.send).toHaveBeenCalledTimes(1); expect(x.onSessionLost).not.toHaveBeenCalled();
    });
    test('a completed success is returned even after switching accounts', async () => {
        const x = setup(), gate = deferred<Response>(); x.send.mockReturnValueOnce(gate.promise);
        const result = x.api.request('/post'); await tick(); x.state.gen++; gate.resolve(ok({ debit: 5 }));
        await expect(result).resolves.toEqual({ debit: 5 });
    });
});
