import { createApiClient } from '../src/lib/api';
import { aiConsent } from '../src/lib/aiConsentStore';
import { setHardPaywallLocked } from '../src/lib/hardPaywall';
import { guardedBeforeSend } from '../src/lib/guardedBeforeSend';
import { createMusicCreateFlow } from '../src/lib/music/createFlow';
import { createGenerationTracker } from '../src/lib/music/queue';
import { getGeneration } from '../src/lib/music/client';
import { entitlements, generation, input, quote, view } from './fixtures/musicCreate';
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({ getItemAsync: async (k: string) => mockStore.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { mockStore.set(k, v); }, deleteItemAsync: async (k: string) => { mockStore.delete(k); } }));
let fetchMock: jest.Mock, flow: ReturnType<typeof createMusicCreateFlow>;
const api = () => createApiClient({ baseUrl: 'https://mock.test', getAccessToken: async () => 'token', onSessionLost: jest.fn(), beforeSend: guardedBeforeSend });
beforeEach(async () => {
    mockStore.clear(); aiConsent.setUser('create-user'); setHardPaywallLocked(false);
    fetchMock = jest.fn(async (url: string) => ({ ok: true, status: 200, headers: new Headers(), json: async () => url.endsWith('/entitlements') ? entitlements
        : url.endsWith('/generation-quotes') ? quote : url.endsWith('/generations') ? generation : view }));
    global.fetch = fetchMock; const client = api();
    flow = createMusicCreateFlow(client, createGenerationTracker({ api: client, subscribeAppState: () => () => {}, setTimer: () => () => {} }));
    await flow.load(); flow.edit(input);
});
afterEach(() => { flow.dispose(); aiConsent.setPrompter(null); setHardPaywallLocked(false); });
test('screen confirm path passes real consent guard before fetch', async () => {
    aiConsent.setPrompter(async () => false); await flow.review(); fetchMock.mockClear(); await flow.confirm();
    expect(fetchMock).not.toHaveBeenCalled(); expect(flow.snapshot().error).toBe('consent_declined');
    expect(flow.attempts.snapshot()?.phase).toBe('UNSUBMITTED');
});
test('screen confirm path passes real hard paywall; quote and generation GET remain open', async () => {
    setHardPaywallLocked(true); aiConsent.setPrompter(async () => false);
    await flow.review(); expect(flow.attempts.snapshot()).not.toBeNull(); fetchMock.mockClear();
    await flow.confirm(); expect(fetchMock).not.toHaveBeenCalled(); expect(flow.snapshot().error).toBe('subscription_required');
    expect(await getGeneration(api(), view.id)).toEqual(view); expect(fetchMock).toHaveBeenCalledTimes(1);
});
test('double confirm through real guarded client sends and charges once', async () => {
    aiConsent.setPrompter(async () => true); await flow.review(); fetchMock.mockClear();
    await Promise.all([flow.confirm(), flow.confirm()]);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(flow.tracker.snapshot().entries).toHaveLength(1);
});

test('hard-paywall rejection during recovery preserves the ambiguous key', async () => {
    aiConsent.setPrompter(async () => true); await flow.review();
    fetchMock.mockRejectedValueOnce(new Error('lost acknowledgement')); await flow.confirm();
    const pending = flow.attempts.snapshot()!; expect(pending.phase).toBe('AMBIGUOUS');
    setHardPaywallLocked(true); fetchMock.mockClear(); await flow.confirm();
    expect(fetchMock).not.toHaveBeenCalled(); expect(flow.attempts.snapshot()).toEqual(pending);
    setHardPaywallLocked(false); await flow.confirm();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).idempotency_key).toBe(pending.key);
});

test('F2 a client-synthesised 401 preserves the attempt until authentication recovers', async () => {
    let authenticated = false;
    const client = createApiClient({ baseUrl: 'https://mock.test', getAccessToken: async () => authenticated ? 'token' : null,
        onSessionLost: jest.fn(), beforeSend: guardedBeforeSend });
    flow.dispose();
    flow = createMusicCreateFlow(client, createGenerationTracker({ api: client, subscribeAppState: () => () => {}, setTimer: () => () => {} }));
    authenticated = true; aiConsent.setPrompter(async () => true); await flow.load(); flow.edit(input); await flow.review();
    const pending = flow.attempts.snapshot()!; authenticated = false; fetchMock.mockClear(); await flow.confirm();
    expect(fetchMock).not.toHaveBeenCalled(); expect(flow.snapshot().error).toBe('not_authenticated');
    expect(flow.attempts.snapshot()).toMatchObject({ key: pending.key, phase: 'AMBIGUOUS' });
    authenticated = true; await flow.confirm();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).idempotency_key).toBe(pending.key);
});
