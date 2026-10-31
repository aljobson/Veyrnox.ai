import { scrubBreadcrumb, scrubEvent, scrubUrl } from '../src/lib/scrub';

describe('crash report scrubbing', () => {
    test('drops the query and fragment from a URL', () => {
        expect(scrubUrl('ai.veyrnox.app://auth/callback?code=abc123&state=x')).toBe('ai.veyrnox.app://auth/callback');
        expect(scrubUrl('https://veyrnox.ai/api/v1/jobs?before=2026&before_id=1#frag')).toBe('https://veyrnox.ai/api/v1/jobs');
        expect(scrubUrl('https://veyrnox.ai/api/v1/balance')).toBe('https://veyrnox.ai/api/v1/balance');
    });

    test('removes the user, extras, message, logentry and request details from an event', () => {
        const event = scrubEvent({
            message: 'boom',
            logentry: { message: 'generate failed for %s', params: ['a@b.co'] },
            user: { id: 'u1', email: 'a@b.co' },
            extra: { token: 'secret' },
            request: { url: 'https://veyrnox.ai/x?code=1', headers: { authorization: 'Bearer t' }, data: 'body', cookies: 'c' },
        });
        expect(event).toEqual({ request: { url: 'https://veyrnox.ai/x' } });
        expect('message' in event).toBe(false);
        expect('logentry' in event).toBe(false);
    });

    test('replaces the exception value with a constant and strips frame source context', () => {
        const event = scrubEvent({
            exception: {
                values: [
                    {
                        type: 'Error',
                        value: 'generate image "a cat in a hat" failed for a@b.co',
                        stacktrace: {
                            frames: [
                                {
                                    filename: 'app.js',
                                    lineno: 5,
                                    context_line: 'const prompt = "a cat in a hat"',
                                    pre_context: ['before'],
                                    post_context: ['after'],
                                    vars: { prompt: 'a cat in a hat', email: 'a@b.co' },
                                },
                            ],
                        },
                    },
                ],
            },
        });
        expect(event).toEqual({
            exception: {
                values: [
                    {
                        type: 'Error',
                        value: 'Mobile request failed',
                        stacktrace: { frames: [{ filename: 'app.js', lineno: 5 }] },
                    },
                ],
            },
        });
    });

    test('keeps only the safe context sub-objects', () => {
        const event = scrubEvent({
            contexts: {
                trace: { trace_id: 't' },
                runtime: { name: 'hermes' },
                device: { model: 'iPhone' },
                app: { app_version: '1.0.0' },
                os: { name: 'iOS' },
                response: { headers: { authorization: 'Bearer t' } },
                state: { lastPrompt: 'a secret prompt' },
            },
        });
        expect(event).toEqual({
            contexts: {
                trace: { trace_id: 't' },
                runtime: { name: 'hermes' },
                device: { model: 'iPhone' },
                app: { app_version: '1.0.0' },
                os: { name: 'iOS' },
            },
        });
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

    test('collapses a console breadcrumb to category, level and timestamp only', () => {
        const crumb = scrubBreadcrumb({
            category: 'console',
            level: 'log',
            timestamp: 123,
            message: 'the user typed a secret prompt',
            data: { arguments: ['a secret prompt'] },
        });
        expect(crumb).toEqual({ category: 'console', level: 'log', timestamp: 123 });
    });

    test('drops a non-URL breadcrumb message and logged arguments', () => {
        const crumb = scrubBreadcrumb({
            category: 'ui.click',
            message: 'tapped Generate with "a cat in a hat"',
            data: { from: 'https://veyrnox.ai/app?x=1', arguments: ['a cat in a hat'] },
        });
        expect(crumb).toEqual({ category: 'ui.click', message: undefined, data: { from: 'https://veyrnox.ai/app' } });
        expect(crumb.message).toBeUndefined();
        expect('arguments' in (crumb.data as object)).toBe(false);
    });

    test('does not change the input', () => {
        const crumb = { data: { url: 'https://x.test/?a=1' } };
        scrubBreadcrumb(crumb);
        expect(crumb.data.url).toBe('https://x.test/?a=1');
    });
});

describe('bearer path redaction', () => {
    test.each(['/api/social/team/', '/social/team/invite/', '/api/social/approvals/', '/social/review/', '/media/social/'])('redacts one segment of %s on any host or a bare path', (prefix) => {
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
