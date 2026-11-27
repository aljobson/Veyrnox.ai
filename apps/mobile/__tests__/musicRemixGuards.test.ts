import { createApiClient } from '../src/lib/api';
import { aiConsent } from '../src/lib/aiConsentStore';
import { sendsContent } from '../src/lib/aiConsent';
import { guardedBeforeSend } from '../src/lib/guardedBeforeSend';
import { isPaidAction, setHardPaywallLocked } from '../src/lib/hardPaywall';
import { startRemix } from '../src/lib/music/client';
import { generation } from './fixtures/musicCreate';
import { SONG_ID } from './fixtures/musicActions';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
    getItemAsync: async (key: string) => mockStore.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { mockStore.set(key, value); },
    deleteItemAsync: async (key: string) => { mockStore.delete(key); },
}));

const originalFetch = global.fetch;
const fetchMock = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(generation), {
    status: 200, headers: { 'Content-Type': 'application/json' },
}));
const api = () => createApiClient({
    baseUrl: 'https://mock.test', getAccessToken: async () => 'token',
    onSessionLost: jest.fn(), beforeSend: guardedBeforeSend,
});
const confirmPath = `/api/v1/music/songs/${SONG_ID}?phase=confirm`;

beforeEach(() => {
    mockStore.clear(); fetchMock.mockClear(); global.fetch = fetchMock;
    aiConsent.setUser('remix-user'); aiConsent.setPrompter(async () => false);
    setHardPaywallLocked(false);
});
afterEach(() => {
    aiConsent.setPrompter(null); aiConsent.setUser(null); setHardPaywallLocked(false);
    global.fetch = originalFetch;
});

test('only Remix confirmation is registered as content-sending and paid', () => {
    expect(sendsContent(confirmPath, 'POST')).toBe(true);
    expect(isPaidAction(confirmPath, 'POST')).toBe(true);
    expect(sendsContent(`${confirmPath}&extra=1`, 'POST')).toBe(true);
    expect(isPaidAction(`${confirmPath}&extra=1`, 'POST')).toBe(true);
    for (const path of [`/api/v1/music/songs/${SONG_ID}`, `${confirmPath}-later`,
        `/api/v1/music/songs/${SONG_ID}?phase=quote`, `/api/v1/music/songs/${SONG_ID}?x=1&phase=confirm`]) {
        expect(sendsContent(path, 'POST')).toBe(false);
        expect(isPaidAction(path, 'POST')).toBe(false);
    }
    expect(sendsContent(confirmPath, 'GET')).toBe(false);
    expect(isPaidAction(confirmPath, 'GET')).toBe(false);
});

test('declining consent prevents the Remix confirmation POST', async () => {
    await expect(startRemix(api(), SONG_ID, 'quote-1234', 'remix-submit-1234'))
        .rejects.toMatchObject({ code: 'consent_declined' });
    expect(fetchMock).not.toHaveBeenCalled();
});

test('accepted consent sends the confirmation marker and exact request', async () => {
    aiConsent.setPrompter(async () => true);
    await expect(startRemix(api(), SONG_ID, 'quote-1234', 'remix-submit-1234')).resolves.toEqual(generation);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://mock.test${confirmPath}`);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
        phase: 'confirm', quote_id: 'quote-1234', idempotency_key: 'remix-submit-1234',
    });
});
