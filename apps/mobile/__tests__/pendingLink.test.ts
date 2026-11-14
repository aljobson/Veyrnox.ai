import { isAppLinkRoute, mapAppLink } from '../src/lib/appLinks';
import {
    forgetPendingLink, PENDING_LINK_TTL_MS, pendingLinkRoute, recallPendingLink, rememberPendingLink, takePendingLink, type PendingLinkStore,
} from '../src/lib/pendingLink';

const memory = (initial: string | null = null) => {
    let value = initial;
    const store: PendingLinkStore = { get: () => value, set: (v) => { value = v; }, remove: () => { value = null; } };
    return { store, peek: () => value };
};
const ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'abc_DEF-123.sig_456'; // gitleaks:allow -- synthetic team-invite token fixture
const NOW = 1_800_000_000_000;

describe('isAppLinkRoute: only what the link mapper produces', () => {
    test.each([
        'https://veyrnox.ai/app/library', 'https://veyrnox.ai/app/chat', 'https://veyrnox.ai/app/create', 'https://veyrnox.ai/app/credits',
        'https://veyrnox.ai/app/account', 'https://veyrnox.ai/app/publish', 'https://veyrnox.ai/app/video-agent', 'https://veyrnox.ai/app/publish/team',
        `https://veyrnox.ai/app/library/${ID}`, `https://veyrnox.ai/app/chat/${ID}`, 'https://veyrnox.ai/app/create/kling-2.6',
        'https://veyrnox.ai/app/create?preset=paper-bird', 'https://veyrnox.ai/app/create?model=video&recipe=faceless-reel',
        `https://veyrnox.ai/social-cinema/title/${ID}`, `https://veyrnox.ai/social-cinema/watch/${ID}`, 'https://veyrnox.ai/social-cinema/series/night-shift',
        'https://veyrnox.ai/social-cinema/pass', 'https://veyrnox.ai/oauth/consent?authorization_id=abcdefgh12345678',
        `https://veyrnox.ai/social/team/invite/${TOKEN}`, `https://veyrnox.ai/social/review/${TOKEN}`,
    ])('accepts the route for %s', (link) => {
        const route = mapAppLink(link);
        expect(route).not.toBe('/');
        expect(isAppLinkRoute(route)).toBe(true);
    });
    test('accepts a template hand-off with an encoded query', () => {
        expect(isAppLinkRoute('/create/video?prompt=Fold+a+paper+bird&tid=paper&duration=5&recipe=faceless-reel')).toBe(true);
        expect(isAppLinkRoute('/create/presets?unavailable=paper')).toBe(true);
    });
    test.each([
        '/', '', '//evil.test/library', '/\\evil.test', 'https://veyrnox.ai/app/library', 'ai.veyrnox.app://library', 'javascript:alert(1)', 'library',
        '/library/../account', '/create/..', '/create/.', '/account/security', '/delete-account', '/dev-s1-editor', '/cinema/probe?code=a&token=b',
        '/team-invite', '/team-invite?token=', '/team-invite?token=a b', `/team-invite?token=${TOKEN}&next=//evil.test`, '/oauth-consent?authorization_id=x',
        '/library#//evil.test', '/library?x=y', '/create/video?prompt=<script>', `/job/${ID}/extra`, '/cinema?section=other', ' /library',
    ])('refuses %p', (route) => {
        expect(isAppLinkRoute(route)).toBe(false);
    });
    test('refuses an over-long route', () => {
        expect(isAppLinkRoute(`/create/video?prompt=${'a'.repeat(2000)}`)).toBe(false);
    });
});

describe('pendingLinkRoute', () => {
    test('keeps a mapped route that needs a signed-in session', () => {
        expect(pendingLinkRoute(`/team-invite?token=${TOKEN}`)).toBe(`/team-invite?token=${TOKEN}`);
        expect(pendingLinkRoute(`/cinema/${ID}`)).toBe(`/cinema/${ID}`);
    });
    test('skips Home, the public review screen and anything that is not a string or a mapped route', () => {
        expect(pendingLinkRoute('/')).toBeNull();
        expect(pendingLinkRoute(`/review?token=${TOKEN}`)).toBeNull();
        expect(pendingLinkRoute('//evil.test')).toBeNull();
        expect(pendingLinkRoute('ai.veyrnox.app://auth/callback?code=abc')).toBeNull();
        expect(pendingLinkRoute(null)).toBeNull();
        expect(pendingLinkRoute(42)).toBeNull();
    });
});

describe('remember, recall, take and forget', () => {
    test('keeps one destination and hands it back once', () => {
        const { store, peek } = memory();
        expect(rememberPendingLink(`/job/${ID}`, store, NOW)).toBe(true);
        expect(recallPendingLink(store, NOW + 1000)).toBe(`/job/${ID}`);
        expect(peek()).not.toBeNull();
        expect(takePendingLink(store, NOW + 2000)).toBe(`/job/${ID}`);
        expect(peek()).toBeNull();
        expect(takePendingLink(store, NOW + 3000)).toBeNull();
    });
    test('one slot: a newer link replaces the older one, and a refused link leaves the slot alone', () => {
        const { store } = memory();
        rememberPendingLink('/library', store, NOW);
        rememberPendingLink('/credits', store, NOW + 1);
        expect(rememberPendingLink('//evil.test', store, NOW + 2)).toBe(false);
        expect(rememberPendingLink('/', store, NOW + 2)).toBe(false);
        expect(takePendingLink(store, NOW + 3)).toBe('/credits');
    });
    test('expires after fifteen minutes and is removed', () => {
        expect(PENDING_LINK_TTL_MS).toBe(15 * 60 * 1000);
        const { store, peek } = memory();
        rememberPendingLink('/library', store, NOW);
        expect(recallPendingLink(store, NOW + PENDING_LINK_TTL_MS)).toBe('/library');
        expect(recallPendingLink(store, NOW + PENDING_LINK_TTL_MS + 1)).toBeNull();
        expect(peek()).toBeNull();
    });
    test('a record from the future, a broken record and a tampered route are removed, never followed', () => {
        for (const raw of [
            JSON.stringify({ route: '/library', at: NOW + PENDING_LINK_TTL_MS + 1 }), 'not json', '{}', 'null', JSON.stringify({ route: '/library' }),
            JSON.stringify({ route: '//evil.test/x', at: NOW }), JSON.stringify({ route: 'https://evil.test', at: NOW }), JSON.stringify({ route: '/delete-account', at: NOW }),
        ]) {
            const { store, peek } = memory(raw);
            expect(recallPendingLink(store, NOW)).toBeNull();
            expect(peek()).toBeNull();
        }
    });
    test('forget clears the slot, and a store that throws never throws out', () => {
        const { store, peek } = memory();
        rememberPendingLink('/library', store, NOW);
        forgetPendingLink(store);
        expect(peek()).toBeNull();
        const broken: PendingLinkStore = { get: () => { throw new Error('x'); }, set: () => { throw new Error('x'); }, remove: () => { throw new Error('x'); } };
        expect(rememberPendingLink('/library', broken, NOW)).toBe(false);
        expect(recallPendingLink(broken, NOW)).toBeNull();
        expect(takePendingLink(broken, NOW)).toBeNull();
        expect(() => forgetPendingLink(broken)).not.toThrow();
    });
});
