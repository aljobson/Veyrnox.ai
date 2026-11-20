import { mapAppLink, isAppLinkRoute } from '../src/lib/appLinks';
import { resolveAppLink } from '../src/lib/resolveAppLink';
import { redirectSystemPath } from '../src/app/+native-intent';
import { recallPendingLink, takePendingLink, rememberPendingLink } from '../src/lib/pendingLink';
import { slug, token } from './fixtures/musicPublication';
const mockStore = new Map<string, string>(), mockWrite = jest.fn();
jest.mock('expo-secure-store', () => ({
    getItem: (key: string) => mockStore.get(key) ?? null,
    setItem: (key: string, value: string) => { mockWrite(key, value); mockStore.set(key, value); },
    deleteItemAsync: async (key: string) => { mockStore.delete(key); },
}));
beforeEach(() => { mockStore.clear(); mockWrite.mockClear(); });
const routes = [[`/music/tracks/${slug}`, `/music/track/${slug}`], ['/music/creators/artist_one', '/music/creator/artist_one'], [`/listen/${token}`, `/music/listen/${token}`]];
test.each(routes)('%s maps strictly to %s for web and native relative URLs', async (path, route) => {
    for (const prefix of ['', 'https://veyrnox.ai', 'https://www.veyrnox.ai']) {
        expect(mapAppLink(prefix + path)).toBe(route); expect(await resolveAppLink(prefix + path)).toBe(route);
    }
    expect(mapAppLink(route)).toBe(route); expect(isAppLinkRoute(route)).toBe(true);
});
const malformed = [
    '/music/tracks/../..', '/music/tracks/%2e%2e/%2e%2e', '/music/tracks/../../app/account', '/listen/../app/account',
    `/music/tracks/${slug.toUpperCase()}`, `/music/tracks/${slug.slice(1)}`, `/music/tracks/${slug}a`, '/music/tracks/',
    '/music/creators/Artist_one', '/music/creators/ab', '/music/creators/1abc', `/music/creators/${'a'.repeat(31)}`,
    '/music/creators/../..', '/music/creators/artist%5fone', `/listen/${token.slice(1)}`, `/listen/${token}a`, '/listen/',
    ...routes.flatMap(([path]) => [`${path}/extra`, `${path}/`, `${path}?x=1`, `${path}?`, `${path}#fragment`, `${path}#`, `${path}/../x`, `${path}%2fextra`]),
];
test.each(malformed)('rejects malformed Music link %s before router normalization', async path => {
    for (const prefix of ['', 'https://veyrnox.ai']) {
        expect(mapAppLink(prefix + path)).toBe('/'); expect(await resolveAppLink(prefix + path)).toBe('/');
    }
});
test.each(routes.slice(0, 2))('signed-out %s is retained once for sign-in continuation', async (path, route) => {
    expect(await redirectSystemPath({ path: `https://veyrnox.ai${path}`, initial: true })).toBe(route);
    expect(recallPendingLink()).toBe(route); expect(takePendingLink()).toBe(route); expect(takePendingLink()).toBeNull();
});
test('native intent never persists listen tokens, either initial or warm', async () => {
    for (const initial of [true, false]) {
        expect(await redirectSystemPath({ path: `https://veyrnox.ai/listen/${token}`, initial })).toBe(`/music/listen/${token}`);
        for (const path of [`/listen/${token}`, `/music/listen/${token}`]) expect(rememberPendingLink(path)).toBe(false);
    }
    expect(recallPendingLink()).toBeNull(); expect(mockWrite).not.toHaveBeenCalled();
});
test.each([['/app/library', '/library'], ['/app/chat', '/chat'], ['/app/create', '/create'], ['/app/account', '/account'],
    ['/app/credits', '/credits'], ['/app/publish/team', '/publish/team'], ['/social-cinema/pass', '/cinema?section=profile'],
    ['/oauth/consent?authorization_id=abcdefgh', '/oauth-consent?authorization_id=abcdefgh'],
    ['/social/review/abc.def', '/review?token=abc.def'], ['/social/team/invite/abc.def', '/team-invite?token=abc.def']])('existing link %s stays %s', (path, route) => expect(mapAppLink(`https://veyrnox.ai${path}`)).toBe(route));
