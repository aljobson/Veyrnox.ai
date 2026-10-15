import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ANALYTICS_PREFERENCE_KEY,
    normaliseGatewayPath,
    pathOnlyUrl,
    readAnalyticsPreference,
    replayAllowedOnPath,
    sanitisePostHogEvent,
    writeAnalyticsPreference,
} from '../app/lib/analyticsPrivacy.js';

test('analytics URLs never retain a query string or fragment', () => {
    assert.equal(pathOnlyUrl('https://veyrnox.ai/auth/callback?code=secret#token'), 'https://veyrnox.ai/auth/callback');
    assert.equal(pathOnlyUrl('/pricing?ref=private', 'https://veyrnox.ai'), 'https://veyrnox.ai/pricing');

    const event = sanitisePostHogEvent({
        event: '$autocapture',
        properties: {
            $current_url: 'https://veyrnox.ai/app/create?prompt=private#draft',
            $referrer: 'https://example.test/path?email=person@example.test',
            $elements: [{ tag_name: 'a', attr__href: '/checkout?session=secret', attr__src: 'private' }],
        },
    });
    assert.equal(event.properties.$current_url, 'https://veyrnox.ai/app/create');
    assert.equal(event.properties.$referrer, 'https://example.test/path');
    assert.deepEqual(event.properties.$elements, [{ tag_name: 'a' }]);
});

test('browser errors keep source-map locations without messages or source context', () => {
    const event = sanitisePostHogEvent({
        event: '$exception',
        properties: {
            $exception_message: 'Prompt contained private words',
            $exception_values: ['Prompt contained private words'],
            $exception_list: [{
                type: 'TypeError',
                value: 'Prompt contained private words',
                stacktrace: { type: 'raw', frames: [{
                    filename: 'https://veyrnox.ai/_next/app.js?token=secret#frame',
                    abs_path: 'webpack:///app/page.js?private=true',
                    function: 'submitPrompt',
                    lineno: 42,
                    colno: 7,
                    context_line: 'throw new Error(prompt)',
                    pre_context: ['const prompt = privateValue'],
                    post_context: ['console.log(privateValue)'],
                    vars: { prompt: 'private words' },
                }] },
            }],
        },
    });

    assert.equal(event.properties.$exception_message, 'Browser error');
    assert.deepEqual(event.properties.$exception_values, ['Browser error']);
    assert.deepEqual(event.properties.$exception_list, [{
        type: 'TypeError',
        value: 'Browser error',
        stacktrace: { type: 'raw', frames: [{
            filename: 'https://veyrnox.ai/_next/app.js',
            abs_path: 'webpack:///app/page.js',
            function: 'submitPrompt',
            lineno: 42,
            colno: 7,
        }] },
    }]);
});

test('replay stays off on authentication, account, admin and payment routes', () => {
    for (const path of ['/auth', '/auth/callback', '/app/account', '/app/account/security', '/app/admin', '/app/credits', '/social/connect/callback/youtube']) {
        assert.equal(replayAllowedOnPath(path), false, path);
    }
    for (const path of ['/', '/pricing', '/app', '/app/create', '/app/chat', '/social-cinema/watch/title']) {
        assert.equal(replayAllowedOnPath(path), true, path);
    }
});

test('replay consent can never be true without analytics consent', () => {
    const values = new Map();
    const storage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    };
    const written = writeAnalyticsPreference(storage, { analytics: false, replay: true });
    assert.deepEqual(written, { version: 1, analytics: false, replay: false });
    assert.deepEqual(readAnalyticsPreference(storage), { analytics: false, replay: false });
    assert.ok(values.has(ANALYTICS_PREFERENCE_KEY));

    values.set(ANALYTICS_PREFERENCE_KEY, '{broken');
    assert.equal(readAnalyticsPreference(storage), null);
});

test('gateway diagnostics collapse ids and discard query values', () => {
    assert.equal(normaliseGatewayPath('/jobs/57?token=secret'), '/jobs/:id');
    assert.equal(normaliseGatewayPath('/jobs/123e4567-e89b-12d3-a456-426614174000/result'), '/jobs/:id/result');
    assert.equal(normaliseGatewayPath('/catalog/models'), '/catalog/models');
});
