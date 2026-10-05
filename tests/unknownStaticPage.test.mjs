import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { isUnknownStaticPage } = await import('../lib/unknownStaticPage.js');
const { middleware } = await import('../middleware.js');

test('only an unknown guide or template address is refused', () => {
    for (const p of ['/guides/nope', '/presets/nope', '/veyrnox/guides/nope', '/guides/credits%2F..', '/guides/%E0%A4%A', '/presets/CCTV-NIGHT']) {
        assert.equal(isUnknownStaticPage(p), true, p);
    }
    for (const p of ['/guides', '/guides/credits', '/guides/credits/', '/presets/cctv-night', '/veyrnox/presets/cctv-night',
        '/models/nope', '/', '/pricing', '/guides/credits/extra', '/app/library', undefined]) {
        assert.equal(isUnknownStaticPage(p), false, String(p));
    }
});

test('the middleware rewrites an unknown guide to a routeless path and keeps the CSP', async () => {
    const res = await middleware(new Request('https://veyrnox.test/guides/nope'));
    assert.match(res.headers.get('x-middleware-rewrite') || '', /\/_unknown-page$/);
    assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.equal(res.headers.get('cache-control'), 'private, no-store, max-age=0');
    const ok = await middleware(new Request('https://veyrnox.test/guides/credits'));
    assert.equal(ok.headers.get('x-middleware-rewrite'), null);
    assert.match(ok.headers.get('content-security-policy') || '', /default-src 'self'/);
});
