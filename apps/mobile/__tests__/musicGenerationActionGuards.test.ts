import { createApiClient } from '../src/lib/api';
import { aiConsent } from '../src/lib/aiConsentStore';
import { sendsContent } from '../src/lib/aiConsent';
import { isPaidAction, setHardPaywallLocked } from '../src/lib/hardPaywall';
import { guardedBeforeSend } from '../src/lib/guardedBeforeSend';
import { markOffline, resetNetworkState } from '../src/lib/network';
import { createSongActionFlow } from '../src/lib/music/actionFlow';
import { generationAction } from '../src/lib/music/generationAction';
import { resetCacheUser } from '../src/lib/appCache';
import type { GenerationActionStart } from '../src/lib/music/generationActionTypes';
import { createExtendQuote, createCoverQuote, cropSong } from '../src/lib/music/client';
import { cropResult, SONG_ID, VERSION_ID } from './fixtures/musicActions';
import { generationSong as actionSong, extendQuote, coverQuote, generationStart as stemStart, generationReplay as stemReplay, generationView as stemRequest } from './fixtures/musicGenerationActions';
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({ getItemAsync: async (k: string) => mockStore.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { mockStore.set(k, v); }, deleteItemAsync: async (k: string) => { mockStore.delete(k); } }));
for (const kind of ['extend', 'cover'] as const) describe(kind, () => {
const actionQuote = kind === 'extend' ? extendQuote : coverQuote;
let fetchMock: jest.Mock, flow: ReturnType<typeof createSongActionFlow<GenerationActionStart, typeof stemRequest>>;
const originalFetch = global.fetch;
const api = () => createApiClient({ baseUrl: 'https://mock.test', getAccessToken: async () => 'token', onSessionLost: jest.fn(), beforeSend: guardedBeforeSend });
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => body });
beforeEach(async () => {
    resetNetworkState(); mockStore.clear(); aiConsent.setUser('stems-user'); aiConsent.setPrompter(async () => false); setHardPaywallLocked(false);
    fetchMock = jest.fn(async (url: string) => response(url.endsWith(`/${kind}-quotes`) ? actionQuote : url.endsWith(`/${kind}s`) ? stemStart
        : url.endsWith('/crop') ? cropResult : actionSong)); global.fetch = fetchMock;
    flow = createSongActionFlow(api(), generationAction(kind, SONG_ID), SONG_ID, { poll: { initialAppState: 'inactive', subscribeAppState: () => () => {} } });
    await flow.load(); flow.edit({ rights_confirmed: true, parameters: { prompt: 'piano', source_influence: 50 } });
});
afterEach(() => { flow.dispose(); resetCacheUser(); setHardPaywallLocked(false); aiConsent.setPrompter(null); resetNetworkState(); global.fetch = originalFetch; });
test.each(['crop', `${kind}-quotes`])('%s is never paid or content-sending', path => {
    for (const suffix of ['', '?test=1', '/']) {
        expect(isPaidAction(`/api/v1/music/songs/${SONG_ID}/${path}${suffix}`, 'POST')).toBe(false);
        expect(sendsContent(`/api/v1/music/songs/${SONG_ID}/${path}${suffix}`, 'POST')).toBe(false);
    }
});
test('stems POST is registered in both central guards, reads are not', () => {
    for (const suffix of ['', '?test=1']) {
        const path = `/api/v1/music/songs/${SONG_ID}/${kind}s${suffix}`;
        expect(isPaidAction(path, 'POST')).toBe(true); expect(sendsContent(path, 'POST')).toBe(true);
        expect(isPaidAction(path, 'GET')).toBe(false); expect(sendsContent(path, 'GET')).toBe(false);
    }
});
test('declining consent sends nothing and preserves the same unsubmitted key for acceptance', async () => {
    await flow.review(); const before = flow.attempts.snapshot(); fetchMock.mockClear(); await flow.confirm();
    expect(fetchMock).not.toHaveBeenCalled(); expect(flow.snapshot().error).toBe('consent_declined'); expect(flow.attempts.snapshot()).toEqual(before);
    aiConsent.setPrompter(async () => true); await flow.confirm(); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).idempotency_key).toBe(before?.key);
});
test('locked paywall blocks submit before consent or transport, while quotes and crop stay free', async () => {
    const prompt = jest.fn(async () => false); aiConsent.setPrompter(prompt); setHardPaywallLocked(true);
    expect(await (kind === 'extend' ? createExtendQuote(api(), SONG_ID, VERSION_ID, 'piano') : createCoverQuote(api(), SONG_ID, VERSION_ID, 'piano', 50))).toEqual(actionQuote);
    expect(await cropSong(api(), SONG_ID, { version_id: VERSION_ID, start_seconds: 0, end_seconds: 2 }, 'crop.test-1234')).toEqual(cropResult);
    await flow.review(); const before = flow.attempts.snapshot(); fetchMock.mockClear(); await flow.confirm();
    expect(fetchMock).not.toHaveBeenCalled(); expect(prompt).not.toHaveBeenCalled();
    expect(flow.snapshot().error).toBe('subscription_required'); expect(flow.attempts.snapshot()).toEqual(before);
});
test.each(['consent', 'paywall'])('%s during recovery cannot reveal a lost acknowledgement or mint a new key', async guard => {
    aiConsent.setPrompter(async () => true); await flow.review();
    fetchMock.mockResolvedValueOnce(response({ error: 'pair_acceptance_unknown' }, 503)); await flow.confirm();
    const pending = flow.attempts.snapshot()!; expect(pending.phase).toBe('AMBIGUOUS');
    if (guard === 'consent') { mockStore.clear(); aiConsent.setPrompter(async () => false); } else setHardPaywallLocked(true);
    fetchMock.mockClear(); await flow.confirm(); expect(fetchMock).not.toHaveBeenCalled();
    expect(flow.attempts.snapshot()).toEqual(pending); expect(flow.snapshot().result).toBeNull();
    setHardPaywallLocked(false); aiConsent.setPrompter(async () => true); fetchMock.mockResolvedValueOnce(response(stemReplay)); await flow.confirm();
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(JSON.parse(fetchMock.mock.calls[0][1].body).idempotency_key).toBe(pending.key);
    expect(flow.snapshot().balance).toBeNull();
});
test.each(['consent', 'paywall'])('offline %s refusal also prevents the connectivity HEAD probe', async guard => {
    await flow.review(); markOffline(); if (guard === 'paywall') setHardPaywallLocked(true);
    const pending = flow.attempts.snapshot(); fetchMock.mockClear(); await flow.confirm();
    expect(fetchMock).not.toHaveBeenCalled(); expect(flow.attempts.snapshot()).toEqual(pending);
    expect(flow.snapshot().error).toBe(guard === 'paywall' ? 'subscription_required' : 'consent_declined');
});
test('unreachable connectivity probe never submits or queues a paid action', async () => {
    aiConsent.setPrompter(async () => true); await flow.review(); const pending = flow.attempts.snapshot();
    markOffline(); fetchMock.mockClear(); fetchMock.mockRejectedValue(new Error('offline')); await flow.confirm();
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0][1].method).toBe('HEAD');
    expect(flow.attempts.snapshot()).toEqual(pending); expect(flow.snapshot().result).toBeNull();
});
test('double confirm through the real guarded client sends exactly once', async () => {
    aiConsent.setPrompter(async () => true); await flow.review(); fetchMock.mockClear();
    await Promise.all([flow.confirm(), flow.confirm()]); expect(fetchMock).toHaveBeenCalledTimes(1);
});

test.each([`${kind}s-more`, `${kind}s/nested`, `${kind}-quotes`])('anchored guards do not match %s', name => {
    const path = `/api/v1/music/songs/${SONG_ID}/${name}`;
    expect(isPaidAction(path, 'POST')).toBe(false); expect(sendsContent(path, 'POST')).toBe(false);
});

});
