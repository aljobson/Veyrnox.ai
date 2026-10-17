import { ApiError, createApiClient } from '../src/lib/api';

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
});
