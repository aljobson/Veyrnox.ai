import { createApiClient } from '../src/lib/api';
import { writePublic, countPlay } from '../src/lib/music/publicClient';
import { guardedBeforeSend } from '../src/lib/guardedBeforeSend';
import { aiConsent } from '../src/lib/aiConsentStore';
import { setHardPaywallLocked } from '../src/lib/hardPaywall';
import { resetNetworkState } from '../src/lib/network';
import { commentId, slug, social } from './fixtures/musicPublic';
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({ getItemAsync: async (k: string) => mockStore.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { mockStore.set(k, v); }, deleteItemAsync: async (k: string) => { mockStore.delete(k); } }));
const original = global.fetch, prompt = jest.fn(async () => false), fetchMock = jest.fn();
beforeEach(() => { resetNetworkState(); mockStore.clear(); fetchMock.mockReset(); prompt.mockClear(); global.fetch = fetchMock; aiConsent.setUser('p4b-user'); aiConsent.setPrompter(prompt); setHardPaywallLocked(true); });
afterEach(() => { global.fetch = original; aiConsent.setPrompter(null); aiConsent.setUser(null); setHardPaywallLocked(false); resetNetworkState(); });
test('real guard path allows comments, reports, follows, reactions and plays with no AI consent or paywall', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        const receipt = body.action === 'count_play' ? { counted: true } : body.action === 'submit'
            ? { id: commentId, status: 'pending', idempotent: false } : body.action === 'report_song' ? { status: 'reported' } : { social, idempotent: false };
        return { ok: true, status: 200, headers: new Headers(), json: async () => receipt };
    });
    const api = createApiClient({ baseUrl: 'https://mock.test', getAccessToken: async () => 'token', onSessionLost: jest.fn(), beforeSend: guardedBeforeSend });
    await writePublic(api, { kind: 'submit', slug, body: 'Human discussion for moderation, not an AI prompt' }, 'comment.test-12345');
    await writePublic(api, { kind: 'reaction', slug, reaction: 'fire' }, 'reaction.test-12345');
    await writePublic(api, { kind: 'follow', handle: 'creator_one', following: true }, 'follow.test-12345');
    await writePublic(api, { kind: 'report_song', slug, category: 'other', details: 'Moderation request' }, 'report.test-12345');
    await countPlay(api, slug);
    expect(prompt).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(5);
});
