import { createApiClient } from '../src/lib/api';
import { createExportQuote, startExport, getExport } from '../src/lib/music/exportClient';
import { guardedBeforeSend } from '../src/lib/guardedBeforeSend';
import { aiConsent } from '../src/lib/aiConsentStore';
import { setHardPaywallLocked, onLockedAttempt } from '../src/lib/hardPaywall';
import { resetNetworkState } from '../src/lib/network';
import { quote, start, file, exportSong } from './fixtures/musicExport';
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({ getItemAsync: async (k: string) => mockStore.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { mockStore.set(k, v); }, deleteItemAsync: async (k: string) => { mockStore.delete(k); } }));
const original = global.fetch, prompt = jest.fn(async () => false), fetchMock = jest.fn(), paywall = jest.fn();
let unsubscribe: () => void;
const api = () => createApiClient({ baseUrl: 'https://mock.test', getAccessToken: async () => 'token', onSessionLost: jest.fn(), beforeSend: guardedBeforeSend });
beforeEach(() => {
    resetNetworkState(); mockStore.clear(); jest.clearAllMocks(); fetchMock.mockReset(); global.fetch = fetchMock;
    aiConsent.setUser('export-user'); aiConsent.setPrompter(prompt); setHardPaywallLocked(true); unsubscribe = onLockedAttempt(paywall);
});
afterEach(() => { global.fetch = original; aiConsent.setPrompter(null); aiConsent.setUser(null); setHardPaywallLocked(false); unsubscribe(); resetNetworkState(); });
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => body });
test('free allowance review, confirm and read pass real guards with consent refused and paywall locked', async () => {
    fetchMock.mockResolvedValueOnce(reply({ quote }, 201)).mockResolvedValueOnce(reply(start, 201)).mockResolvedValueOnce(reply({ export: file }));
    const client = api(); await createExportQuote(client, exportSong.id, exportSong.version_id, 'mp3');
    await startExport(client, exportSong.id, quote.id, 'export.test-key'); await getExport(client, file.id, 'mp3');
    expect(fetchMock).toHaveBeenCalledTimes(3); expect(prompt).not.toHaveBeenCalled(); expect(paywall).not.toHaveBeenCalled();
});
test.each(['quote', 'start'])('real client preserves allowance 402 at %s without a purchase flow', async stage => {
    fetchMock.mockResolvedValue(reply({ error: 'download_allowance_exhausted' }, 402));
    await expect(stage === 'quote' ? createExportQuote(api(), exportSong.id, exportSong.version_id, 'mp3')
        : startExport(api(), exportSong.id, quote.id, 'export.test-key')).rejects.toMatchObject({ status: 402, code: 'download_allowance_exhausted' });
    expect(prompt).not.toHaveBeenCalled(); expect(paywall).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(1);
});
