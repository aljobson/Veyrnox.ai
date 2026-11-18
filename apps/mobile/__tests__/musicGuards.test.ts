// The Music confirm step must pass through the same guards as every other paid generation:
// the hard paywall (before any request leaves) and first-use AI sharing consent.
// The guard under test is the real guardedBeforeSend wired into a real API client.
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
    getItemAsync: async (k: string) => mockStore.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { mockStore.set(k, v); },
    deleteItemAsync: async (k: string) => { mockStore.delete(k); },
}));

import { createApiClient } from '../src/lib/api';
import { aiConsent } from '../src/lib/aiConsentStore';
import { sendsContent } from '../src/lib/aiConsent';
import { isPaidAction, setHardPaywallLocked } from '../src/lib/hardPaywall';
import { guardedBeforeSend } from '../src/lib/guardedBeforeSend';
import { createQuote, startGeneration } from '../src/lib/music';

const UUID = '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b';
const KEY = 'music-key-12345678';
const generation = { generation_id: UUID, state: 'queued', candidates: [{ ordinal: 1, label: 'A', job_id: 'j1', state: 'queued' }], balance_after: 1 };
const quote = { quote_id: UUID, mode: 'simple', model_id: 'ace-step', output_count: 2, credits_per_candidate: 5, total_credits: 10, balance: 40, balance_after: 30, affordable: true, expires_at: 'x', policy_version: 'v' };

let fetchMock: jest.Mock;
const makeApi = () => createApiClient({ baseUrl: 'https://x.test', getAccessToken: async () => 'tok', onSessionLost: jest.fn(), beforeSend: guardedBeforeSend });
beforeEach(() => {
    mockStore.clear(); setHardPaywallLocked(false);
    fetchMock = jest.fn(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => generation }));
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    aiConsent.setUser('user-1');
});
afterEach(() => { setHardPaywallLocked(false); aiConsent.setPrompter(null); });

test('matchers: the confirm step is consent-gated and paid; quotes and reads are neither', () => {
    expect(sendsContent('/api/v1/music/generations', 'POST')).toBe(true);
    expect(isPaidAction('/api/v1/music/generations', 'POST')).toBe(true);
    expect(isPaidAction('/api/v1/music/generations?x=1', 'POST')).toBe(true);
    for (const path of ['/api/v1/music/generation-quotes', '/api/v1/music/entitlements', '/api/v1/music/songs']) {
        expect(sendsContent(path, 'POST')).toBe(false);
        expect(isPaidAction(path, 'POST')).toBe(false);
    }
    expect(isPaidAction('/api/v1/music/generations', 'GET')).toBe(false);
});

test('declined consent blocks submission before any request leaves', async () => {
    aiConsent.setPrompter(async () => false);
    await expect(startGeneration(makeApi(), UUID, KEY)).rejects.toMatchObject({ code: 'consent_declined' });
    expect(fetchMock).not.toHaveBeenCalled();
});

test('existing agreement lets submission through without asking again', async () => {
    const ask = jest.fn(async () => true);
    aiConsent.setPrompter(ask);
    await startGeneration(makeApi(), UUID, KEY);
    await startGeneration(makeApi(), UUID, KEY);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('a locked account is blocked before any request leaves; quotes stay open', async () => {
    aiConsent.setPrompter(async () => true);
    setHardPaywallLocked(true);
    await expect(startGeneration(makeApi(), UUID, KEY)).rejects.toMatchObject({ status: 402, code: 'subscription_required' });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue({ ok: true, status: 201, headers: new Headers(), json: async () => quote });
    await createQuote(makeApi(), { prompt: 'lofi' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
});
