import { ApiError, createApiClient } from '../src/lib/api';
import { AI_CONSENT_TEXT, CONSENT_DECLINED_MESSAGE, ConsentDeclinedError, createConsentGate, sendsContent, type ConsentStorage } from '../src/lib/aiConsent';

const memory = (): ConsentStorage & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => void map.set(k, v), remove: async (k) => void map.delete(k) };
};

describe('which calls carry content', () => {
    test('POSTs that reach a provider', () => {
        expect(sendsContent('/api/v1/generations', 'POST')).toBe(true);
        expect(sendsContent('/api/v1/uploads', 'post')).toBe(true);
        expect(sendsContent('/api/v1/montage/plan', 'POST')).toBe(true);
        expect(sendsContent('/api/v1/chat/threads/abc-123/messages', 'POST')).toBe(true);
    });
    test('reads and account calls do not', () => {
        expect(sendsContent('/api/v1/generations', 'GET')).toBe(false);
        expect(sendsContent('/api/v1/balance', 'GET')).toBe(false);
        expect(sendsContent('/api/v1/chat/threads', 'POST')).toBe(false);
        expect(sendsContent('/api/v1/jobs/1', 'DELETE')).toBe(false);
        expect(sendsContent('/api/v1/reports', 'POST')).toBe(false);
        expect(sendsContent('/api/v1/chat/threads/a/messages-evil', 'POST')).toBe(false);
    });
});

describe('the gate', () => {
    test('asks once, stores the answer per account, and lets the call through', async () => {
        const storage = memory();
        const gate = createConsentGate(storage);
        const ask = jest.fn(async () => true);
        gate.setUser('user-1');
        gate.setPrompter(ask);
        await gate.ensure('/api/v1/generations', 'POST');
        await gate.ensure('/api/v1/uploads', 'POST');
        expect(ask).toHaveBeenCalledTimes(1);
        expect([...storage.map.keys()].some((k) => k.endsWith('.user-1'))).toBe(true);
        expect(await gate.hasAgreed()).toBe(true);
        gate.setUser('user-2');
        expect(await gate.hasAgreed()).toBe(false);
        await gate.ensure('/api/v1/generations', 'POST');
        expect(ask).toHaveBeenCalledTimes(2);
    });

    test('Not now stops the call and is asked again next time', async () => {
        const gate = createConsentGate(memory());
        const ask = jest.fn(async () => false);
        gate.setUser('u');
        gate.setPrompter(ask);
        await expect(gate.ensure('/api/v1/generations', 'POST')).rejects.toMatchObject({ code: 'consent_declined' });
        await expect(gate.ensure('/api/v1/generations', 'POST')).rejects.toBeInstanceOf(ApiError);
        expect(ask).toHaveBeenCalledTimes(2);
    });

    test('calls that carry no content never ask', async () => {
        const gate = createConsentGate(memory());
        const ask = jest.fn(async () => true);
        gate.setUser('u');
        gate.setPrompter(ask);
        await gate.ensure('/api/v1/balance', 'GET');
        expect(ask).not.toHaveBeenCalled();
    });

    test('two sends at once share one question', async () => {
        const gate = createConsentGate(memory());
        let answer: (v: boolean) => void = () => undefined;
        const ask = jest.fn(() => new Promise<boolean>((r) => (answer = r)));
        gate.setUser('u');
        gate.setPrompter(ask);
        const a = gate.ensure('/api/v1/generations', 'POST');
        const b = gate.ensure('/api/v1/uploads', 'POST');
        for (let i = 0; i < 20 && ask.mock.calls.length === 0; i++) await Promise.resolve();
        answer(true);
        await Promise.all([a, b]);
        expect(ask).toHaveBeenCalledTimes(1);
    });

    test('with no account or no screen to ask on, it refuses rather than sends', async () => {
        const gate = createConsentGate(memory());
        await expect(gate.ensure('/api/v1/generations', 'POST')).rejects.toMatchObject({ code: 'consent_declined' });
        gate.setUser('u');
        await expect(gate.ensure('/api/v1/generations', 'POST')).rejects.toMatchObject({ code: 'consent_declined' });
    });

    test('a storage failure re-asks instead of sending silently', async () => {
        const gate = createConsentGate({ get: async () => { throw new Error('x'); }, set: async () => { throw new Error('x'); }, remove: async () => { throw new Error('x'); } });
        const ask = jest.fn(async () => true);
        gate.setUser('u');
        gate.setPrompter(ask);
        await gate.ensure('/api/v1/generations', 'POST');
        await gate.ensure('/api/v1/generations', 'POST');
        expect(ask).toHaveBeenCalledTimes(2);
    });
});

test('the wording names third-party AI providers and offers Not now', () => {
    expect(AI_CONSENT_TEXT.body).toMatch(/third-party AI providers/);
    expect(AI_CONSENT_TEXT.decline).toBe('Not now');
});

test('declining throws the typed error with the specific message', async () => {
    const gate = createConsentGate(memory());
    gate.setUser('u');
    gate.setPrompter(async () => false);
    const err = await gate.ensure('/api/v1/generations', 'POST').catch((e) => e);
    expect(err).toBeInstanceOf(ConsentDeclinedError);
    expect(err).toBeInstanceOf(ApiError);
    expect(CONSENT_DECLINED_MESSAGE).toMatch(/You need to accept to use AI features/);
});

test('sign-out forgets the agreement: the same account is asked again next time', async () => {
    const storage = memory();
    const gate = createConsentGate(storage);
    const ask = jest.fn(async () => true);
    gate.setUser('u');
    gate.setPrompter(ask);
    await gate.ensure('/api/v1/generations', 'POST');
    expect(storage.map.size).toBe(1);
    await gate.forget();
    expect(storage.map.size).toBe(0);
    expect(await gate.hasAgreed()).toBe(false);
    gate.setUser('u');
    await gate.ensure('/api/v1/generations', 'POST');
    expect(ask).toHaveBeenCalledTimes(2);
});

describe('every AI POST goes through the gate in the real client', () => {
    const fetchMock = jest.fn();
    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });

    const post = { method: 'POST' };
    const calls: [string, (api: ReturnType<typeof createApiClient>, p: string) => Promise<unknown>][] = [
        ['/api/v1/generations', (api, p) => api.request(p, post)],
        ['/api/v1/uploads', (api, p) => api.request(p, post)],
        ['/api/v1/montage/plan', (api, p) => api.request(p, post)],
        ['/api/v1/chat/threads/11111111-1111-4111-8111-111111111111/messages', (api, p) => api.stream(p, post)],
    ];

    test.each(calls)('%s is blocked until the person agrees, then goes through', async (path, send) => {
        const gate = createConsentGate(memory());
        gate.setUser('u');
        let answer = false;
        gate.setPrompter(async () => answer);
        const api = createApiClient({ baseUrl: 'https://x.test', getAccessToken: async () => 'tok', onSessionLost: jest.fn(), beforeSend: gate.ensure });
        await expect(send(api, path)).rejects.toBeInstanceOf(ConsentDeclinedError);
        expect(fetchMock).not.toHaveBeenCalled();
        answer = true;
        await send(api, path);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('reads are never gated', async () => {
        const gate = createConsentGate(memory());
        const ask = jest.fn(async () => false);
        gate.setUser('u');
        gate.setPrompter(ask);
        const api = createApiClient({ baseUrl: 'https://x.test', getAccessToken: async () => 'tok', onSessionLost: jest.fn(), beforeSend: gate.ensure });
        await api.request('/api/v1/balance');
        await api.request('/api/v1/chat/threads');
        expect(ask).not.toHaveBeenCalled();
    });
});
