import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){ return next(s==='next/server'?'next/server.js':s,c); }`));
const { NextRequest } = await import('next/server.js');

test('the ingest path is closed when the PostHog project is not configured', async () => {
    const before = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    try {
        const { middleware } = await import(`../middleware.js?posthog-disabled=${Date.now()}`);
        const response = await middleware(new NextRequest('https://veyrnox.ai/ingest/e/?ip=1'));
        assert.equal(response.status, 404);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('x-middleware-rewrite'), null);
    } finally {
        if (before === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
        else process.env.NEXT_PUBLIC_POSTHOG_KEY = before;
    }
});

test('the configured ingest proxy rewrites only to PostHog Cloud EU', async () => {
    const before = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_public_token';
    try {
        const { middleware } = await import(`../middleware.js?posthog-enabled=${Date.now()}`);
        const request = new NextRequest('https://veyrnox.ai/ingest/e/?ip=1', { headers: {
            cookie: '__Host-veyrnox_refresh=private-refresh', authorization: 'Bearer secret', 'cf-connecting-ip': '192.0.2.1',
            'x-veyrnox-auth-id': 'private-account', 'content-type': 'application/json',
        } });
        const response = await middleware(request);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('x-middleware-rewrite'), 'https://eu.i.posthog.com/e/?ip=1');
        assert.equal(response.headers.get('set-cookie'), null, 'proxying does not seed an analytics identity cookie');
        const forwarded = response.headers.get('x-middleware-override-headers')?.split(',').map((name) => name.trim()) || [];
        assert.ok(forwarded.includes('content-type'), 'safe payload headers still cross the proxy');
        // Production OpenNext uses {...inbound, ...middlewareSet}, including
        // external rewrites. Excluded headers survive unless explicitly blanked.
        const outbound = new Headers(request.headers);
        response.headers.forEach((value, key) => {
            if (key.startsWith('x-middleware-request-')) outbound.set(key.slice('x-middleware-request-'.length), value);
        });
        for (const name of ['cookie', 'authorization', 'cf-connecting-ip', 'x-veyrnox-auth-id']) {
            assert.ok(forwarded.includes(name), `${name} has an explicit override`);
            assert.equal(response.headers.get(`x-middleware-request-${name}`), '', `${name} is blanked at the proxy boundary`);
            assert.equal(outbound.get(name), '', `${name} remains blank under OpenNext's overlay`);
        }
        assert.equal(outbound.get('content-type'), 'application/json');
    } finally {
        if (before === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
        else process.env.NEXT_PUBLIC_POSTHOG_KEY = before;
    }
});
