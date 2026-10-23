import { mapAppLink } from '../src/lib/appLinks';

const ID = '123e4567-e89b-42d3-a456-426614174000';

describe('mapAppLink', () => {
    test('maps each web section to its app screen', () => {
        for (const [web, app] of [
            ['/app/library', '/library'],
            ['/app/chat', '/chat'],
            ['/app/create', '/create'],
            ['/app/credits', '/credits'],
            ['/app/account', '/account'],
            ['/app/publish', '/publish'],
            ['/app/video-agent', '/create/agent'],
        ]) {
            expect(mapAppLink(`https://veyrnox.ai${web}`)).toBe(app);
        }
    });
    test('opens a library item as a creation and a chat as its thread', () => {
        expect(mapAppLink(`https://veyrnox.ai/app/library/${ID}`)).toBe(`/job/${ID}`);
        expect(mapAppLink(`https://veyrnox.ai/app/chat/${ID}`)).toBe(`/chat/${ID}`);
    });
    test('opens a model id in the create form and refuses odd ids', () => {
        expect(mapAppLink('https://veyrnox.ai/app/create/flux-1.1_pro')).toBe('/create/flux-1.1_pro');
        expect(mapAppLink('https://veyrnox.ai/app/create/..%2Fadmin')).toBe('/create');
        expect(mapAppLink('https://veyrnox.ai/app/library/not-a-uuid')).toBe('/library');
        expect(mapAppLink('https://veyrnox.ai/app/chat/new')).toBe('/chat');
    });
    test('keeps known Publish destinations instead of collapsing them to the dashboard', () => {
        for (const section of ['accounts', 'posts', 'analytics', 'calendar', 'best-time', 'drafts', 'approvals', 'brands', 'commerce', 'ads', 'reports', 'inbox', 'workflows', 'smartlink', 'contacts', 'queues', 'autolists', 'team', 'activity', 'developer']) {
            expect(mapAppLink(`https://veyrnox.ai/app/publish/${section}`)).toBe(`/publish/${section}`);
        }
        expect(mapAppLink('https://veyrnox.ai/app/publish/admin')).toBe('/publish');
        expect(mapAppLink('https://veyrnox.ai/app/publish/posts/extra')).toBe('/publish');
    });
    test('ignores the query string and fragment, and accepts www', () => {
        expect(mapAppLink('https://www.veyrnox.ai/app/credits?utm=x#top')).toBe('/credits');
    });
    test('an unknown section or a path outside /app goes Home', () => {
        expect(mapAppLink('https://veyrnox.ai/app/admin')).toBe('/');
        expect(mapAppLink('https://veyrnox.ai/pricing')).toBe('/');
        expect(mapAppLink('https://veyrnox.ai/')).toBe('/');
    });
    test('leaves the app scheme, in-app paths and other hosts untouched', () => {
        expect(mapAppLink('ai.veyrnox.app://auth/callback?code=abc123')).toBe('ai.veyrnox.app://auth/callback?code=abc123');
        expect(mapAppLink('/library')).toBe('/library');
        expect(mapAppLink('https://evil.test/app/library')).toBe('https://evil.test/app/library');
        expect(mapAppLink('http://veyrnox.ai/app/library')).toBe('http://veyrnox.ai/app/library');
        expect(mapAppLink('')).toBe('');
    });
});

describe('shared Cinema links (ADR-0164)', () => {
    test('a title opens its page and an episode link opens the player', () => {
        expect(mapAppLink(`https://veyrnox.ai/social-cinema/title/${ID}`)).toBe(`/cinema/${ID}`);
        expect(mapAppLink(`https://veyrnox.ai/social-cinema/watch/${ID.toUpperCase()}`)).toBe(`/cinema/watch/${ID}`);
    });
    test('anything else under social-cinema goes home', () => {
        expect(mapAppLink('https://veyrnox.ai/social-cinema/title/not-a-uuid')).toBe('/');
        expect(mapAppLink(`https://veyrnox.ai/social-cinema/creator/${ID}`)).toBe('/');
        expect(mapAppLink('https://veyrnox.ai/social-cinema')).toBe('/');
    });
});
