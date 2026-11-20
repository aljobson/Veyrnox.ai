import { createApiClient } from '../src/lib/api';
import { publishSong, unpublishSong } from '../src/lib/music/publicationClient';
import { guardedBeforeSend } from '../src/lib/guardedBeforeSend';
import { aiConsent } from '../src/lib/aiConsentStore';
import { setHardPaywallLocked } from '../src/lib/hardPaywall';
import { resetNetworkState } from '../src/lib/network';
import { songId, input, receipt } from './fixtures/musicPublication';
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({ getItemAsync: async (k: string) => mockStore.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { mockStore.set(k, v); }, deleteItemAsync: async (k: string) => { mockStore.delete(k); } }));
const original = global.fetch, prompt = jest.fn(async () => false), fetchMock = jest.fn();
beforeEach(() => { resetNetworkState(); mockStore.clear(); fetchMock.mockReset(); prompt.mockClear(); global.fetch = fetchMock; aiConsent.setUser('p4c-user'); aiConsent.setPrompter(prompt); setHardPaywallLocked(true); });
afterEach(() => { global.fetch = original; aiConsent.setPrompter(null); aiConsent.setUser(null); setHardPaywallLocked(false); resetNetworkState(); });
test('publication POST and DELETE pass the real client guard with consent refused and hard paywall locked', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => ({ ok: true, status: 200, headers: new Headers(),
        json: async () => init.method === 'POST' ? receipt : { ok: true, idempotent: false } }));
    const api = createApiClient({ baseUrl: 'https://mock.test', getAccessToken: async () => 'token', onSessionLost: jest.fn(), beforeSend: guardedBeforeSend });
    await publishSong(api, songId, input, 'publish.test-12345'); await unpublishSong(api, songId, 'unpublish.test-12345');
    expect(prompt).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'DELETE']);
});
