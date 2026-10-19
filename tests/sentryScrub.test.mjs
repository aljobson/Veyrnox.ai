import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubEvent, scrubBreadcrumb, scrubUrl } from '../lib/sentryScrub.js';
import { SENTRY_DSN, sentryOptions } from '../lib/sentryConfig.js';

test('urls lose their query and fragment', () => {
    assert.equal(scrubUrl('https://veyrnox.ai/auth/mobile?code=abc#token=x'), 'https://veyrnox.ai/auth/mobile');
    assert.equal(scrubUrl('https://veyrnox.ai/a'), 'https://veyrnox.ai/a');
});

test('an event keeps stack frames and drops everything a person could have typed', () => {
    const event = scrubEvent({
        message: 'user typed secret prompt',
        user: { id: 'u1', email: 'a@b.c' },
        extra: { prompt: 'secret' },
        server_name: 'host',
        request: {
            method: 'POST', url: 'https://veyrnox.ai/api/v1/chat?token=abc',
            headers: { authorization: 'Bearer x', cookie: 'c' }, data: '{"prompt":"secret"}', query_string: 'token=abc',
        },
        exception: { values: [{ type: 'TypeError', value: 'bad input: secret', stacktrace: { frames: [{ filename: 'a.js' }] } }] },
        breadcrumbs: [
            { category: 'console', message: 'secret log', data: { arguments: ['secret'] } },
            { category: 'fetch', data: { url: 'https://x.test/p?k=v', request_body: 'secret' } },
        ],
        contexts: { trace: { trace_id: 't' }, request: { headers: { cookie: 'c' } } },
    });
    assert.equal(event.user, undefined);
    assert.equal(event.extra, undefined);
    assert.equal(event.message, undefined);
    assert.deepEqual(event.request, { method: 'POST', url: 'https://veyrnox.ai/api/v1/chat' });
    assert.equal(event.exception.values[0].value, 'Server request failed');
    assert.equal(event.exception.values[0].type, 'TypeError');
    assert.equal(event.exception.values[0].stacktrace.frames[0].filename, 'a.js');
    assert.equal(event.breadcrumbs[0].message, undefined);
    assert.equal(event.breadcrumbs[0].data, undefined);
    assert.deepEqual(event.breadcrumbs[1].data, { url: 'https://x.test/p' });
    assert.deepEqual(Object.keys(event.contexts), ['trace']);
});

test('a breadcrumb message that is not a url is dropped', () => {
    assert.equal(scrubBreadcrumb({ category: 'x', message: 'hello person' }).message, undefined);
    assert.equal(scrubBreadcrumb({ category: 'x', message: 'https://a.test/p?q=1' }).message, 'https://a.test/p');
});

test('with no DSN committed nothing is sent, errors only, no default PII', () => {
    assert.equal(SENTRY_DSN, '');
    const options = sentryOptions({ APP_ENV: 'staging' });
    assert.equal(options.dsn, undefined);
    assert.equal(options.environment, 'staging');
    assert.equal(options.sendDefaultPii, false);
    assert.equal(options.tracesSampleRate, 0);
});
