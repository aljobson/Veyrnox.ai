import { scrubBreadcrumb, scrubEvent, scrubUrl } from '../src/lib/scrub';

describe('crash report scrubbing', () => {
    test('drops the query and fragment from a URL', () => {
        expect(scrubUrl('ai.veyrnox.app://auth/callback?code=abc123&state=x')).toBe('ai.veyrnox.app://auth/callback');
        expect(scrubUrl('https://veyrnox.ai/api/v1/jobs?before=2026&before_id=1#frag')).toBe('https://veyrnox.ai/api/v1/jobs');
        expect(scrubUrl('https://veyrnox.ai/api/v1/balance')).toBe('https://veyrnox.ai/api/v1/balance');
    });

    test('removes the user, extras and request details from an event', () => {
        const event = scrubEvent({
            message: 'boom',
            user: { id: 'u1', email: 'a@b.co' },
            extra: { token: 'secret' },
            request: { url: 'https://veyrnox.ai/x?code=1', headers: { authorization: 'Bearer t' }, data: 'body', cookies: 'c' },
        });
        expect(event).toEqual({ message: 'boom', request: { url: 'https://veyrnox.ai/x' } });
    });

    test('cleans every breadcrumb', () => {
        const event = scrubEvent({
            breadcrumbs: [
                { category: 'navigation', data: { from: '/a?x=1', to: '/b?y=2' } },
                { category: 'http', data: { url: 'https://veyrnox.ai/api/v1/jobs?before=1', request_body: '{"text":"hi"}', status_code: 200 } },
            ],
        });
        expect(event.breadcrumbs).toEqual([
            { category: 'navigation', data: { from: '/a', to: '/b' } },
            { category: 'http', data: { url: 'https://veyrnox.ai/api/v1/jobs', status_code: 200 } },
        ]);
    });

    test('does not change the input', () => {
        const crumb = { data: { url: 'https://x.test/?a=1' } };
        scrubBreadcrumb(crumb);
        expect(crumb.data.url).toBe('https://x.test/?a=1');
    });
});

describe('bearer path redaction', () => {
    test.each(['/api/social/team/', '/social/team/invite/', '/api/social/approvals/', '/social/review/'])('redacts one segment of %s on any host or a bare path', (prefix) => {
        for (const origin of ['', 'https://other.example.test']) {
            expect(scrubUrl(`${origin}${prefix}a.b/after?secret=1#fragment`)).toBe(`${origin}${prefix}:token/after`);
        }
    });
    test('redacts HTTP and navigation breadcrumbs, URL messages and event requests', () => {
        const url = 'https://veyrnox.ai/api/social/team/a.b';
        const clean = 'https://veyrnox.ai/api/social/team/:token';
        expect(scrubBreadcrumb({ category: 'http', data: { url } })).toEqual({ category: 'http', data: { url: clean } });
        expect(scrubBreadcrumb({ data: { from: url, to: url }, message: url })).toEqual({ data: { from: clean, to: clean }, message: clean });
        expect(scrubEvent({ request: { url } })).toEqual({ request: { url: clean } });
    });
    test.each(['/api/v1/social/team/accept', '/api/v1/social/approvals', '/other/api/social/team/a.b'])('does not redact unrelated path %s', (path) => {
        expect(scrubUrl(path)).toBe(path);
        expect(scrubUrl(`https://veyrnox.ai${path}`)).toBe(`https://veyrnox.ai${path}`);
    });
});
