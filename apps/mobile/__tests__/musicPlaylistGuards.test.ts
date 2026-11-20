import { createApiClient } from '../src/lib/api';
import { createPlaylist, setPlaylistPinned } from '../src/lib/music/playlistsClient';
import { createMusicCreateFlow } from '../src/lib/music/createFlow';
import { createGenerationTracker } from '../src/lib/music/queue';
import { buildSamplePrompt, DISCOVER_SEEDS } from '../src/lib/music/discoverSeeds';
import { guardedBeforeSend } from '../src/lib/guardedBeforeSend';
import { aiConsent } from '../src/lib/aiConsentStore';
import { setHardPaywallLocked } from '../src/lib/hardPaywall';
import { resetNetworkState } from '../src/lib/network';
import { created, playlistId } from './fixtures/musicPlaylists';
import { entitlements, quote } from './fixtures/musicCreate';
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({ getItemAsync: async (k: string) => mockStore.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { mockStore.set(k, v); }, deleteItemAsync: async (k: string) => { mockStore.delete(k); } }));
const original = global.fetch;
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => body });
const fetchMock = jest.fn(), prompt = jest.fn(async () => false);
const api = () => createApiClient({ baseUrl: 'https://mock.test', getAccessToken: async () => 'token', onSessionLost: jest.fn(), beforeSend: guardedBeforeSend });
beforeEach(() => { resetNetworkState(); mockStore.clear(); fetchMock.mockReset(); prompt.mockClear(); global.fetch = fetchMock; aiConsent.setUser('p4-user'); aiConsent.setPrompter(prompt); setHardPaywallLocked(true); });
afterEach(() => { global.fetch = original; aiConsent.setPrompter(null); aiConsent.setUser(null); setHardPaywallLocked(false); resetNetworkState(); });
test.each([200, 201])('create %i replay/new and PATCH go through real guards without consent or paywall block', async status => {
    fetchMock.mockResolvedValueOnce(response({ playlist: created }, status)).mockResolvedValueOnce(response({ revision: 1, idempotent: true }));
    await expect(createPlaylist(api(), 'Evening', 'playlist.test-12345')).resolves.toEqual(created);
    await expect(setPlaylistPinned(api(), playlistId, 0, true, 'playlist.test-67890')).resolves.toEqual({ revision: 1, idempotent: true });
    expect(prompt).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(2);
});
test.each(['consent', 'paywall'])('Discover prefill still reaches Create generation %s guard', async guard => {
    setHardPaywallLocked(guard === 'paywall');
    fetchMock.mockImplementation(async (url: string) => response(url.endsWith('/entitlements') ? entitlements : quote, url.endsWith('/generation-quotes') ? 201 : 200));
    const client = api(), tracker = createGenerationTracker({ api: client, subscribeAppState: () => () => {}, setTimer: () => () => {} });
    const flow = createMusicCreateFlow(client, tracker); await flow.load();
    flow.edit({ prompt: buildSamplePrompt(DISCOVER_SEEDS[0]), title: DISCOVER_SEEDS[0].title }); await flow.review(); fetchMock.mockClear(); await flow.confirm();
    expect(fetchMock).not.toHaveBeenCalled(); expect(flow.snapshot().error).toBe(guard === 'paywall' ? 'subscription_required' : 'consent_declined');
    expect(prompt).toHaveBeenCalledTimes(guard === 'paywall' ? 0 : 1); flow.dispose(); tracker.dispose();
});
