import { createApiClient, ApiError } from '../src/lib/api';
import { aiConsent } from '../src/lib/aiConsentStore';
import { sendsContent } from '../src/lib/aiConsent';
import { isPaidAction, setHardPaywallLocked } from '../src/lib/hardPaywall';
import { guardedBeforeSend } from '../src/lib/guardedBeforeSend';
import { markOffline, resetNetworkState } from '../src/lib/network';
import { createSongActionFlow } from '../src/lib/music/actionFlow';
import { trackAddAction } from '../src/lib/music/trackAddAction';
import { resetCacheUser, bindCacheUser } from '../src/lib/appCache';
import { createTrackAddQuote, startTrackAdd, getTrackAddAudio } from '../src/lib/music/client';
import { isTrackAddUnavailable } from '../src/lib/music/trackAddAvailability';
import type { TrackAddStart, TrackAddRequest, MusicTrackAddQuote } from '../src/lib/music/trackAddTypes';
import { SONG_ID, VERSION_ID, deferred } from './fixtures/musicActions';
import { trackSong, trackQuote, trackStart, trackReplay, trackRequest, vocals } from './fixtures/musicTrackAdd';
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({ getItemAsync: async (k: string) => mockStore.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { mockStore.set(k, v); }, deleteItemAsync: async (k: string) => { mockStore.delete(k); } }));
let fetchMock: jest.Mock, flow: ReturnType<typeof createSongActionFlow<TrackAddStart, TrackAddRequest, MusicTrackAddQuote>>;
const originalFetch = global.fetch;
const api = () => createApiClient({ baseUrl: 'https://mock.test', getAccessToken: async () => 'token', onSessionLost: jest.fn(), beforeSend: guardedBeforeSend });
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => body });
const route = `/api/v1/music/songs/${SONG_ID}/track-adds`, quoteRoute = `/api/v1/music/songs/${SONG_ID}/track-add-quotes`;
beforeEach(async () => {
    resetNetworkState(); resetCacheUser(); await bindCacheUser('track-guard-user'); mockStore.clear();
    aiConsent.setUser('track-guard-user'); aiConsent.setPrompter(async () => true); setHardPaywallLocked(false);
    fetchMock = jest.fn(async (url: string) => response(url.endsWith('/track-add-quotes') ? trackQuote : url.endsWith('/track-adds') ? trackStart : trackSong));
    global.fetch = fetchMock;
    flow = createSongActionFlow(api(), trackAddAction(SONG_ID), SONG_ID, { poll: { initialAppState: 'inactive', subscribeAppState: () => () => {} } });
    await flow.load(); flow.edit({ rights_confirmed: true, parameters: vocals });
});
afterEach(() => { flow.dispose(); resetCacheUser(); setHardPaywallLocked(false); aiConsent.setPrompter(null); resetNetworkState(); global.fetch = originalFetch; });
test('spending and quote patterns are isolated; quote is content-only', () => {
    for (const suffix of ['', '?test=1']) {
        expect(sendsContent(route + suffix, 'POST')).toBe(true); expect(isPaidAction(route + suffix, 'POST')).toBe(true);
        expect(sendsContent(quoteRoute + suffix, 'POST')).toBe(true); expect(isPaidAction(quoteRoute + suffix, 'POST')).toBe(false);
        for (const path of [route, quoteRoute]) for (const method of ['GET', 'HEAD', 'PATCH']) {
            expect(sendsContent(path + suffix, method)).toBe(false); expect(isPaidAction(path + suffix, method)).toBe(false);
        }
    }
    for (const path of [route, quoteRoute]) for (const suffix of ['/', '/nested', '-more']) {
        expect(sendsContent(path + suffix, 'POST')).toBe(false); expect(isPaidAction(path + suffix, 'POST')).toBe(false);
    }
    for (const path of ['/prefix' + route, `/api/v1/music/track-add-requests/${trackRequest.id}`, `${quoteRoute}/track-adds`]) {
        expect(sendsContent(path, 'POST')).toBe(false); expect(isPaidAction(path, 'POST')).toBe(false);
    }
});
test('quote consent refusal sends no user text through the real client', async () => {
    aiConsent.setPrompter(async () => false); fetchMock.mockClear();
    await expect(createTrackAddQuote(api(), SONG_ID, VERSION_ID, vocals, true)).rejects.toMatchObject({ code: 'consent_declined' });
    expect(fetchMock).not.toHaveBeenCalled();
});
test('confirmation consent refusal preserves the unsubmitted key', async () => {
    await flow.review(); const pending = flow.attempts.snapshot(); mockStore.clear(); aiConsent.setPrompter(async () => false);
    fetchMock.mockClear(); await flow.confirm(); expect(fetchMock).not.toHaveBeenCalled();
    expect(flow.snapshot().error).toBe('consent_declined'); expect(flow.attempts.snapshot()).toEqual(pending);
    aiConsent.setPrompter(async () => true); await flow.confirm(); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).idempotency_key).toBe(pending?.key);
});
test('quotes stay free while a locked paywall blocks confirmation before consent and transport', async () => {
    setHardPaywallLocked(true);
    await expect(createTrackAddQuote(api(), SONG_ID, VERSION_ID, vocals, true)).resolves.toEqual(trackQuote);
    await flow.review(); const pending = flow.attempts.snapshot(); mockStore.clear();
    const prompt = jest.fn(async () => false); aiConsent.setPrompter(prompt); fetchMock.mockClear(); await flow.confirm();
    expect(fetchMock).not.toHaveBeenCalled(); expect(prompt).not.toHaveBeenCalled();
    expect(flow.snapshot().error).toBe('subscription_required'); expect(flow.attempts.snapshot()).toEqual(pending);
});
test('direct spending client cannot bypass either guard', async () => {
    aiConsent.setPrompter(async () => false); fetchMock.mockClear();
    await expect(startTrackAdd(api(), SONG_ID, trackQuote.quote_id, 'trackadd.fixed')).rejects.toMatchObject({ code: 'consent_declined' });
    setHardPaywallLocked(true);
    await expect(startTrackAdd(api(), SONG_ID, trackQuote.quote_id, 'trackadd.fixed')).rejects.toMatchObject({ code: 'subscription_required' });
    expect(fetchMock).not.toHaveBeenCalled();
});
test.each(['consent', 'paywall'])('%s recovery guard preserves the ambiguous key', async guard => {
    await flow.review(); fetchMock.mockResolvedValueOnce(response({ error: 'track_add_acceptance_unknown' }, 503)); await flow.confirm();
    const pending = flow.attempts.snapshot()!; expect(pending.phase).toBe('AMBIGUOUS');
    if (guard === 'consent') { mockStore.clear(); aiConsent.setPrompter(async () => false); } else setHardPaywallLocked(true);
    fetchMock.mockClear(); await flow.confirm(); expect(fetchMock).not.toHaveBeenCalled();
    expect(flow.attempts.snapshot()).toEqual(pending); expect(flow.snapshot().result).toBeNull();
    setHardPaywallLocked(false); aiConsent.setPrompter(async () => true); fetchMock.mockResolvedValueOnce(response(trackReplay)); await flow.confirm();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).idempotency_key).toBe(pending.key); expect(flow.snapshot().balance).toBeNull();
});
test.each(['consent', 'paywall'])('offline %s refusal prevents even a HEAD probe', async guard => {
    await flow.review(); markOffline(); mockStore.clear(); aiConsent.setPrompter(async () => false);
    if (guard === 'paywall') setHardPaywallLocked(true);
    const pending = flow.attempts.snapshot(); fetchMock.mockClear(); await flow.confirm();
    expect(fetchMock).not.toHaveBeenCalled(); expect(flow.attempts.snapshot()).toEqual(pending);
    expect(flow.snapshot().error).toBe(guard === 'paywall' ? 'subscription_required' : 'consent_declined');
});
test('unreachable connectivity never submits or queues a paid request', async () => {
    await flow.review(); const pending = flow.attempts.snapshot(); markOffline(); fetchMock.mockClear();
    fetchMock.mockRejectedValue(new Error('offline')); await flow.confirm();
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0][1].method).toBe('HEAD');
    expect(flow.attempts.snapshot()).toEqual(pending); expect(flow.snapshot().result).toBeNull();
});
test('double confirm with the real guarded client spends once', async () => {
    await flow.review(); fetchMock.mockClear(); await Promise.all([flow.confirm(), flow.confirm()]); expect(fetchMock).toHaveBeenCalledTimes(1);
});
test('call-time audio off hides entries, and account change resets availability', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'music_track_add_unavailable' }, 404));
    await expect(getTrackAddAudio(api(), trackRequest.id)).rejects.toMatchObject({ code: 'music_track_add_unavailable' });
    expect(isTrackAddUnavailable()).toBe(true); await bindCacheUser('other-user'); expect(isTrackAddUnavailable()).toBe(false);
});
test('an old account off response cannot disable the new account', async () => {
    const wait = deferred<never>();
    const pending = getTrackAddAudio({ request: () => wait.promise } as unknown as ReturnType<typeof api>, trackRequest.id);
    await bindCacheUser('other-user'); wait.reject(new ApiError(404, 'music_track_add_unavailable'));
    await expect(pending).rejects.toMatchObject({ code: 'music_track_add_unavailable' }); expect(isTrackAddUnavailable()).toBe(false);
});
