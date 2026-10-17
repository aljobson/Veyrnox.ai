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
