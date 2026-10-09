// Cloudflare's network keeps /cdn-cgi/ for its own endpoints and the app has
// nothing there. worker.js answers the prefix itself, before the rate limiter
// and the framework, so the answer is the same whatever the edge passes on
// (ADR-0078 amendment 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(s, c, next) {
    if (s.endsWith('/.open-next/worker.js')) return {
      url: 'data:text/javascript,' + encodeURIComponent('export default {fetch: (...args) => globalThis.__cdnCgiTestApp(...args)};'), shortCircuit: true
    };
    return next(s, c);
  }
`));
const worker = (await import('../worker.js')).default;
const allow = { ADMIN_EDGE_RATE_LIMITER: { limit: async () => ({ success: true }) } };
const consulted = { limit: async () => assert.fail('the rate limiter was consulted') };
const neverLimited = { ADMIN_EDGE_RATE_LIMITER: consulted, TURNSTILE_REPORT_RATE_LIMITER: consulted };

test('a path under /cdn-cgi/ is answered 404 before the rate limiter and the app, for every method, and nothing is logged', async () => {
    const paths = [
        '/cdn-cgi', '/cdn-cgi/', '/cdn-cgi/trace', '/cdn-cgi/image/width=64/photo.png', '/cdn-cgi/image/width=64/photo.png?x=1',
        '/cdn-cgi/image/width=64//photo.png', '/cdn-cgi/access/logout', '/cdn-cgi/anything/at/all',
        // Spellings a later layer might fold onto the same prefix.
        '/CDN-CGI/trace', '/Cdn-Cgi/Image/photo.png', '//cdn-cgi/trace', '/cdn-cgi//image/photo.png', '/%63dn-cgi/trace',
        '/cdn%2Dcgi/trace', '/cdn-cgi%2Fimage/photo.png', '/x/%2e%2e/cdn-cgi/trace', '/cdn-cgi\\image/photo.png', '/\\cdn-cgi/trace',
        // The raw prefix still counts when decoding would move the path elsewhere.
        '/cdn-cgi/%2e%2e%2fpricing', '/cdn-cgi/%2e%2e%2fapi/v1/session/me', '/cdn-cgi/%2e%2e%2fapi/v1/admin/metrics',
        '/cdn-cgi/%2e%2e%2fapi/turnstile-failure',
        // A decoded tab or newline is dropped by the URL parser, wherever it sits.
        '/%09/cdn-cgi/trace', '/%0A/%0D/cdn-cgi', '/cdn-cgi%09/image/photo.png', '/cdn%0A-cgi/trace', '/%09%5Ccdn-cgi/trace',
    ];
    globalThis.__cdnCgiTestApp = () => assert.fail('a request under /cdn-cgi/ reached the app');
    const said = [];
    const realError = console.error;
    console.error = (...a) => said.push(a.join(' '));
    try { for (const path of paths) for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const hasBody = !['GET', 'HEAD'].includes(method);
        const req = new Request(`https://veyrnox.test${path}`, {
            method, headers: { authorization: 'Bearer anything' }, ...(hasBody ? { body: 'unread' } : {}),
        });
        const res = await worker.fetch(req, neverLimited, {});
        assert.equal(res.status, 404, `${method} ${path}`);
        assert.equal(req.bodyUsed, false);
        assert.equal(res.headers.get('content-type'), 'application/json');
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
        assert.match(res.headers.get('strict-transport-security'), /max-age=63072000; includeSubDomains; preload/);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(res.headers.get('x-frame-options'), 'DENY');
        assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
        assert.equal(res.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
        assert.deepEqual(await res.json(), { error: 'not_found' });
    } } finally { console.error = realError; }
    assert.deepEqual(said, []);
});

test('a path that cannot be normalised at all is answered 404 by this guard too', async () => {
    const { refuseCdnCgi } = await import('../lib/cdnCgiGuard.js');
    const RealURL = globalThis.URL;
    globalThis.URL = class extends RealURL {
        constructor(input, base) { if (base === 'https://path.invalid') throw new TypeError('Invalid URL'); super(input, base); }
    };
    let res;
    try { res = refuseCdnCgi(new Request('https://veyrnox.test/somewhere')); } finally { globalThis.URL = RealURL; }
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not_found' });
    assert.equal(refuseCdnCgi(new Request('https://veyrnox.test/somewhere')), null);
});

test('paths that only resemble the prefix still reach the app unchanged', async () => {
    const paths = ['/', '/pricing', '/pricing?next=/cdn-cgi/trace', '/cdn', '/cdn/cgi/trace', '/cdn-cgis', '/cdn-cgi-bin/trace',
        '/cdn-cgi.txt', '/guides/cdn-cgi/trace', '/api/v1/session/me', '/_next/static/chunks/main.js', '/_next/image?url=%2Fa.png&w=64&q=75'];
    for (const path of paths) {
        const expected = new Response('from the app');
        let seen;
        globalThis.__cdnCgiTestApp = async (r) => { seen = r.url; return expected; };
        const res = await worker.fetch(new Request(`https://veyrnox.test${path}`), allow, {});
        assert.equal(res, expected, path);
        assert.equal(seen, `https://veyrnox.test${path}`);
    }
});

test('nothing in the app serves or asks for a path under the prefix on its own origin', () => {
    for (const dir of ['app/cdn-cgi', 'public/cdn-cgi']) {
        assert.equal(existsSync(new URL(`../${dir}`, import.meta.url)), false, `${dir}/ exists: the 404 above would break it`);
    }
    const naming = ['next.config.mjs', 'middleware.js'];
    for (const root of ['app', 'components', 'lib']) {
        for (const entry of readdirSync(new URL(`../${root}`, import.meta.url), { recursive: true, withFileTypes: true })) {
            if (entry.isFile() && /\.(?:[cm]?[jt]sx?|css)$/.test(entry.name)) naming.push(`${entry.parentPath}/${entry.name}`);
        }
    }
    const repo = new URL('..', import.meta.url).pathname;
    const found = naming.map((file) => (file.startsWith('/') ? file : repo + file))
        .filter((file) => /cdn-cgi/i.test(readFileSync(file, 'utf8')))
        .map((file) => file.slice(repo.length)).sort();
    // The guard itself, and the Access key set, which is fetched from the Access
    // team domain and not from this site. Anything else (an image loader that
    // builds /cdn-cgi/image/ addresses, say) would get the 404 above wherever
    // the Worker is what answers, local preview included.
    assert.deepEqual(found, ['lib/accessJwt.js', 'lib/cdnCgiGuard.js'], `files naming the prefix: ${found.join(', ')}`);
});
