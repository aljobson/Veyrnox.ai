// The app has no pages router, so nothing legitimate asks for a Next data
// file. worker.js answers that prefix itself, before the rate limiter and the
// framework, so the prefix can never stand in for another path (ADR-0078).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(s, c, next) {
    if (s.endsWith('/.open-next/worker.js')) return {
      url: 'data:text/javascript,' + encodeURIComponent('export default {fetch: (...args) => globalThis.__nextDataTestApp(...args)};'), shortCircuit: true
    };
    return next(s, c);
  }
`));
const worker = (await import('../worker.js')).default;
const BUILD = 'aBcD1234-build';
const allow = { ADMIN_EDGE_RATE_LIMITER: { limit: async () => ({ success: true }) } };
const neverLimited = { ADMIN_EDGE_RATE_LIMITER: { limit: async () => assert.fail('the rate limiter was consulted') } };

test('a data-file path is answered 404 before the rate limiter and the app', async () => {
    const paths = [
        '/_next/data', '/_next/data/', `/_next/data/${BUILD}/index.json`,
        `/_next/data/${BUILD}/api/v1/admin/metrics.json`, `/_next/data/${BUILD}/api/admin/reap-assets.json`,
        `/_next/data/${BUILD}/app/admin.json?x=1`, '/_next/data/anything/at/all',
        // Spellings a later layer might fold onto the same prefix.
        '/_NEXT/DATA/x.json', '/_next//data/x.json', '/_next/%64ata/x.json', '/_next%2Fdata/x.json',
        '/x/%2e%2e/_next/data/x.json', '/_next\\data/x.json',
        // The raw prefix still counts when decoding would move the path elsewhere.
        `/_next/data/${BUILD}/%2e%2e%2f%2e%2e%2f%2e%2e%2fapi/v1/admin/metrics.json`,
        // A decoded tab or newline is dropped by the URL parser, wherever it sits.
        '/%09/_next/data/x.json', '/%0A/%0D/_next/data', '/_next/%0A/data/x.json', '/_next%09/data/x.json',
        `/%09/_next/data/${BUILD}/api/v1/admin/metrics.json`, '/%09%5C_next/data/x.json',
    ];
    globalThis.__nextDataTestApp = () => assert.fail('a data-file request reached the app');
    const realError = console.error;
    console.error = () => {};
    try { for (const path of paths) for (const method of ['GET', 'HEAD', 'POST']) {
        const req = new Request(`https://veyrnox.test${path}`, {
            method, headers: { authorization: 'Bearer anything', 'x-nextjs-data': '1' },
            ...(method === 'POST' ? { body: 'unread' } : {}),
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
});

test('a refusal that names an API route is logged, without the path; the rest are not', async () => {
    const said = [];
    const realError = console.error;
    console.error = (...a) => said.push(a.join(' '));
    try {
        for (const path of [`/_next/data/${BUILD}/index.json`, '/_next/data/', `/_next/data/${BUILD}/app/admin.json`, `/_next/data/${BUILD}/apiary.json`]) {
            await worker.fetch(new Request(`https://veyrnox.test${path}`), neverLimited, {});
        }
        assert.deepEqual(said, []);
        for (const path of [`/_next/data/${BUILD}/api/v1/admin/metrics.json`, `/_next/data/${BUILD}/API/admin/reap-assets.json`, `/_next/data/${BUILD}/%2e%2e%2fapi/v1/balance.json`]) {
            await worker.fetch(new Request(`https://veyrnox.test${path}`), neverLimited, {});
        }
    } finally { console.error = realError; }
    assert.deepEqual(said, Array(3).fill('[next-data] refused a data path naming an API route'));
});

test('a path that decodes to something the URL parser refuses is not thrown on', async () => {
    for (const path of ['/%09/%5B', '/%0a/%5B', '/%0D/%5B', '/%09%5C%5B', '/%09/x:99999/_next/data', '/%09/%25']) {
        const expected = new Response('no such page', { status: 404 });
        let seen;
        globalThis.__nextDataTestApp = async (r) => { seen = r.url; return expected; };
        assert.equal(await worker.fetch(new Request(`https://veyrnox.test${path}`), neverLimited, {}), expected, path);
        assert.equal(seen, `https://veyrnox.test${path}`);
    }
});

test('a path that cannot be normalised at all is answered 404, before the rate limiter and the app', async () => {
    const req = new Request('https://veyrnox.test/somewhere', { method: 'POST', body: 'unread' });
    globalThis.__nextDataTestApp = () => assert.fail('an unreadable path reached the app');
    const said = [];
    const realError = console.error;
    const RealURL = globalThis.URL;
    console.error = (...a) => said.push(a.join(' '));
    globalThis.URL = class extends RealURL {
        constructor(input, base) { if (base === 'https://path.invalid') throw new TypeError('Invalid URL'); super(input, base); }
    };
    try {
        const res = await worker.fetch(req, neverLimited, {});
        assert.equal(res.status, 404);
        assert.equal(req.bodyUsed, false);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await res.json(), { error: 'not_found' });
    } finally { globalThis.URL = RealURL; console.error = realError; }
    assert.deepEqual(said, ['[next-data] refused a path that could not be normalised']);
});

test('static assets, images and ordinary paths still reach the app unchanged', async () => {
    const paths = ['/', '/pricing', '/app/admin', '/_next/static/chunks/main.js', '/_next/image?url=%2Fa.png&w=64&q=75',
        '/_next/database', '/_next/data-sheet.json', '/api/v1/session/me', '/guides/_next/data'];
    for (const path of paths) {
        const expected = new Response('from the app');
        let seen;
        globalThis.__nextDataTestApp = async (r) => { seen = r.url; return expected; };
        const res = await worker.fetch(new Request(`https://veyrnox.test${path}`), allow, {});
        assert.equal(res, expected, path);
        assert.equal(seen, `https://veyrnox.test${path}`);
    }
});

test('the app really has no pages router to serve data files from', () => {
    for (const dir of ['pages', 'src/pages']) {
        assert.equal(existsSync(new URL(`../${dir}`, import.meta.url)), false, `${dir}/ exists: the 404 above would break it`);
    }
});
