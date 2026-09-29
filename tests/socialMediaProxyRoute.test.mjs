import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { GET } = await import('../app/media/social/[token]/route.js');
const { createMediaProxyToken } = await import('../lib/social/mediaProxyToken.js');

const secret = 'proxy-secret-value';
function setConfigured() {
    Object.assign(process.env, {
        SOCIAL_MEDIA_PROXY_SECRET: secret,
        R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'bucket',
    });
}
const request = (token) => new Request(`https://veyrnox.ai/media/social/${token}`);

test('serves an object for a valid, unexpired token — no auth header exists on this path', async () => {
    setConfigured();
    const token = await createMediaProxyToken({ r2Key: 'assets/a.jpg' }, secret);
    const real = globalThis.fetch;
    globalThis.fetch = async () => new Response('bytes', { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '5' } });
    try {
        const res = await GET(request(token), { params: Promise.resolve({ token }) });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'image/jpeg');
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.equal(await res.text(), 'bytes');
    } finally {
        globalThis.fetch = real;
    }
});

test('a forged or expired token is refused as not found, never leaking which it was', async () => {
    setConfigured();
    for (const token of ['not-a-real-token', 'a.b', '']) {
        const res = await GET(request(token), { params: Promise.resolve({ token }) });
        assert.equal(res.status, 404);
        assert.deepEqual(await res.json(), { error: 'invalid_or_expired_token' });
    }
});

test('a missing R2 object behind a valid token answers not_found rather than a raw upstream error', async () => {
    setConfigured();
    const token = await createMediaProxyToken({ r2Key: 'assets/gone.jpg' }, secret);
    const real = globalThis.fetch;
    globalThis.fetch = async () => new Response('nope', { status: 404 });
    try {
        const res = await GET(request(token), { params: Promise.resolve({ token }) });
        assert.equal(res.status, 404);
        assert.deepEqual(await res.json(), { error: 'not_found' });
    } finally {
        globalThis.fetch = real;
    }
});

test('degrades to a clean 503 when the proxy secret or R2 is not configured', async () => {
    setConfigured();
    delete process.env.SOCIAL_MEDIA_PROXY_SECRET;
    const token = await createMediaProxyToken({ r2Key: 'assets/a.jpg' }, secret);
    const res = await GET(request(token), { params: Promise.resolve({ token }) });
    assert.equal(res.status, 503);
    setConfigured();
});
