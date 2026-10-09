// The framework's routing layer reads a few request headers as its own
// instructions: the pair its revalidation queue sends, and the geolocation it
// derives from Cloudflare. Nothing outside the Worker has a reason to send
// either, so worker.js removes them before the framework builds its event
// (ADR-0078, amendment 3). The identity headers go the same way, so a handler
// only ever sees one the middleware set (amendment 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(s, c, next) {
    if (s.endsWith('/.open-next/worker.js')) return {
      url: 'data:text/javascript,' + encodeURIComponent('export default {fetch: (...args) => globalThis.__internalHeadersTestApp(...args)};'), shortCircuit: true
    };
    return next(s === 'next/server' ? 'next/server.js' : s, c);
  }
`));
const worker = (await import('../worker.js')).default;
const allow = { ADMIN_EDGE_RATE_LIMITER: { limit: async () => ({ success: true }) } };
const ORIGIN = 'https://veyrnox.test';
const logged = (...kinds) => `[internal-headers] dropped from an outside request: ${kinds.join(', ')}`;
const FORGED_ID = '99999999-9999-4999-8999-999999999999';

const REVALIDATION = {
    'x-isr': '1',
    'x-prerender-revalidate': 'ab'.repeat(16),
    'x-prerender-revalidate-if-generated': '1',
};
const GEO = {
    'x-open-next-city': '%E0%A4%A',
    'x-open-next-country': 'ZZ',
    'x-open-next-region': 'ZZ',
    'x-open-next-latitude': '0',
    'x-open-next-longitude': '0',
    'x-vercel-ip-city': 'Nowhere',
    'x-vercel-ip-country': 'ZZ',
    'x-vercel-ip-country-region': 'ZZ',
};
// Only the middleware may say who the caller is.
const IDENTITY = {
    'x-veyrnox-auth-id': FORGED_ID,
    'x-veyrnox-auth-email': 'forged@example.test',
    'x-veyrnox-auth-role': 'service_role',
    'x-veyrnox-auth-aal': 'aal2',
    'x-veyrnox-auth-mfa-at': '1790000000',
    'x-veyrnox-auth-not-invented-yet': 'x',
};
// What the framework's routing half hands its rendering half. The first prefix
// is taken off there, leaving the rest of the name as a request header.
const FRAMEWORK = {
    'x-middleware-response-x-veyrnox-auth-id': FORGED_ID,
    'x-middleware-response-cache-control': 'public, max-age=31536000',
    'x-opennext-initial-url': 'https://veyrnox.test/api/v1/session/me',
    'x-opennext-resolved-routes': '[]',
};
const INTERNAL = { ...REVALIDATION, ...GEO, ...IDENTITY, ...FRAMEWORK };
const ORDINARY = {
    authorization: 'Bearer anything',
    accept: 'application/json',
    cookie: 'a=1; b=2',
    'content-type': 'application/json',
    'cf-connecting-ip': '203.0.113.7',
    'x-forwarded-for': '203.0.113.7',
    'idempotency-key': 'k-1',
    // The cron caller's own credential, on a route the middleware never runs on.
    'x-veyrnox-admin-token': 'keep',
    // Names that only look like the internal ones are not this layer's business.
    'x-isr-status': 'keep', 'x-prerender': 'keep', 'x-open-next': 'keep', 'x-opennext': 'keep', 'x-vercel-id': 'keep',
    'x-veyrnox-auth': 'keep', 'x-veyrnox-authority': 'keep', 'x-middleware-prefetch': 'keep',
};

/** Send one request through the Worker and return what the app was handed. */
async function throughWorker(request, env = allow) {
    const expected = new Response('from the app');
    let seen;
    globalThis.__internalHeadersTestApp = async (r) => { seen = r; return expected; };
    const res = await worker.fetch(request, env, {});
    assert.equal(res, expected, 'the app\'s response is returned as it is');
    return seen;
}

async function quietly(fn) {
    const said = [];
    const realError = console.error;
    console.error = (...a) => said.push(a.join(' '));
    try { await fn(); } finally { console.error = realError; }
    return said;
}

test('the internal headers never reach the app; the rest of the request does', async () => {
    const cases = [
        ['GET', '/api/v1/session/me?a=1&b=%2F'], ['HEAD', '/pricing'], ['GET', '/'], ['DELETE', '/api/v1/projects/p1'],
        ['POST', '/api/v1/generations', '{"prompt":"a cat"}'], ['PUT', '/api/v1/projects/p1/document', '{"v":2}'],
        ['POST', '/api/webhook/stripe', 'raw=bytes&kept=exactly'],
    ];
    await quietly(async () => { for (const [method, path, body] of cases) {
        const seen = await throughWorker(new Request(ORIGIN + path, {
            method, headers: { ...ORDINARY, ...INTERNAL }, ...(body ? { body } : {}),
        }));
        for (const name of Object.keys(INTERNAL)) assert.equal(seen.headers.has(name), false, `${method} ${path}: ${name}`);
        assert.deepEqual(Object.fromEntries(seen.headers), ORDINARY, `${method} ${path}`);
        assert.equal(seen.method, method);
        assert.equal(seen.url, ORIGIN + path);
        if (body) assert.equal(await seen.text(), body);
        else assert.equal(seen.body, null);
    } });
});

test('each one is dropped on its own, however its name is spelt', async () => {
    await quietly(async () => { for (const [name, value] of Object.entries(INTERNAL)) {
        for (const spelt of [name, name.toUpperCase(), name.replace(/(^|-)[a-z]/g, (m) => m.toUpperCase())]) {
            const seen = await throughWorker(new Request(`${ORIGIN}/api/v1/session/me`, { headers: { ...ORDINARY, [spelt]: value } }));
            assert.equal(seen.headers.has(name), false, spelt);
            assert.deepEqual(Object.fromEntries(seen.headers), ORDINARY, spelt);
        }
        // Taking the framework's prefix off must not uncover a name that is then trusted.
        const seen = await throughWorker(new Request(`${ORIGIN}/api/v1/session/me`, { headers: FRAMEWORK }));
        assert.equal([...seen.headers.keys()].some((name) => name.endsWith('x-veyrnox-auth-id')), false);
    } });
});

test('redirect mode and the abort signal follow the request', async () => {
    const stop = new AbortController();
    const seen = await throughWorker(new Request(`${ORIGIN}/api/v1/chat/turn`, {
        method: 'POST', headers: { ...ORDINARY, ...GEO }, body: '{}', redirect: 'manual', signal: stop.signal,
    }));
    assert.equal(seen.headers.has('x-open-next-city'), false);
    assert.equal(seen.redirect, 'manual');
    assert.equal(seen.signal.aborted, false);
    stop.abort();
    assert.equal(seen.signal.aborted, true);
});

test('a request carrying none of them reaches the app as the same object', async () => {
    const said = await quietly(async () => {
        for (const method of ['GET', 'HEAD']) for (const path of ['/', '/pricing', '/api/v1/session/me', '/_next/static/chunks/main.js']) {
            const req = new Request(ORIGIN + path, { method, headers: ORDINARY });
            assert.equal(await throughWorker(req), req, `${method} ${path}`);
        }
        // A body is read by the size limit, which hands on its own copy: same content.
        const seen = await throughWorker(new Request(`${ORIGIN}/api/v1/generations`, { method: 'POST', headers: ORDINARY, body: '{"prompt":"a cat"}' }));
        assert.deepEqual(Object.fromEntries(seen.headers), ORDINARY);
        assert.equal(await seen.text(), '{"prompt":"a cat"}');
    });
    assert.deepEqual(said, []);
});

test('the earlier refusals still come first', async () => {
    globalThis.__internalHeadersTestApp = () => assert.fail('a refused request reached the app');
    const neverLimited = { ADMIN_EDGE_RATE_LIMITER: { limit: async () => assert.fail('the rate limiter was consulted') } };
    const refusing = { ADMIN_EDGE_RATE_LIMITER: { limit: async () => ({ success: false }) } };
    const said = await quietly(async () => {
        const data = await worker.fetch(new Request(`${ORIGIN}/_next/data/build/index.json`, { headers: INTERNAL }), neverLimited, {});
        assert.equal(data.status, 404);
        const admin = await worker.fetch(new Request(`${ORIGIN}/api/v1/admin/metrics`, { headers: INTERNAL }), refusing, {});
        assert.equal(admin.status, 429);
        const big = await worker.fetch(new Request(`${ORIGIN}/api/v1/generations`, {
            method: 'POST', headers: { ...INTERNAL, 'content-length': '70000' }, body: 'x',
        }), allow, {});
        assert.equal(big.status, 413);
    });
    assert.deepEqual(said, [], 'a request refused earlier is not reported here as well');
});

test('what was dropped is logged in one line, by kind and never by value; geolocation is not', async () => {
    const secret = REVALIDATION['x-prerender-revalidate'];
    for (const [kind, group] of [['revalidation', REVALIDATION], ['identity', IDENTITY], ['framework', FRAMEWORK]]) {
        for (const [name, value] of Object.entries(group)) {
            const said = await quietly(() => throughWorker(new Request(`${ORIGIN}/api/v1/session/me`, { headers: { [name]: value } })));
            assert.deepEqual(said, [logged(kind)], name);
        }
    }
    const all = await quietly(() => throughWorker(new Request(`${ORIGIN}/api/v1/session/me?t=${secret}`, { headers: INTERNAL })));
    assert.deepEqual(all, [logged('revalidation', 'identity', 'framework')]);
    for (const value of [secret, FORGED_ID, 'forged@example.test']) assert.equal(all.join(' ').includes(value), false);
    assert.deepEqual(await quietly(() => throughWorker(new Request(`${ORIGIN}/pricing`, { headers: GEO }))), []);
    assert.deepEqual(await quietly(() => throughWorker(new Request(`${ORIGIN}/pricing`, { headers: ORDINARY }))), []);
});

// If the framework ever hands a request on without running the middleware,
// the handler gets the Worker's request as it stands. With no identity header
// left on it, the handler has no one to act for.
test('a request the middleware never saw reaches a handler with no identity, and is refused', async () => {
    const middlewareSrc = readFileSync(new URL('../middleware.js', import.meta.url), 'utf8');
    const list = middlewareSrc.slice(middlewareSrc.indexOf('const IDENTITY_HEADERS'), middlewareSrc.indexOf('];', middlewareSrc.indexOf('const IDENTITY_HEADERS')));
    const set = [...list.matchAll(/'(x-veyrnox-[a-z0-9-]+)'/g)].map((m) => m[1]);
    assert.ok(set.length >= 5, 'middleware.js no longer lists its identity headers where this test reads them');
    const forged = Object.fromEntries(set.map((name) => [name, name.endsWith('-id') ? FORGED_ID : 'aal2']));

    const { GET: me } = await import('../app/api/v1/session/me/route.js');
    const unguarded = await me(new Request(`${ORIGIN}/api/v1/session/me`, { headers: forged }));
    assert.equal((await unguarded.json()).authId, FORGED_ID, 'the handler trusts the header, which is why the Worker must own it');

    let seen;
    await quietly(async () => { seen = await throughWorker(new Request(`${ORIGIN}/api/v1/session/me`, { headers: { ...ORDINARY, ...forged } })); });
    for (const name of set) assert.equal(seen.headers.has(name), false, `${name} is set by the middleware but a caller's copy reaches the app`);
    const res = await me(seen);
    assert.deepEqual([res.status, await res.json()], [401, { error: 'not_authenticated' }]);
});

// The list in lib/internalRequestHeaders.js was written against one version of
// the framework, and dependency updates can merge on green checks. These pin
// what it relied on, so an update that changes any of it fails here first.
test('the installed framework still reads request headers the way the list assumes', () => {
    const read = (path) => readFileSync(new URL(`../node_modules/@opennextjs/aws/dist/${path}`, import.meta.url), 'utf8');
    const changed = 'the framework changed: re-read lib/internalRequestHeaders.js and ADR-0078 amendment 3 against the new code, then update this test';

    const names = read('utils/cacheHeaders.js');
    assert.match(names, /ISR_HEADER = "x-isr";/, changed);
    assert.match(names, /PRERENDER_REVALIDATE_HEADER = "x-prerender-revalidate";/, changed);

    // Before it looks for a matching middleware, the routing layer hands a
    // request on for one reason only, and reads only these two headers to decide.
    const routing = read('core/routing/middleware.js');
    const start = routing.indexOf('export async function handleMiddleware');
    const end = routing.indexOf('localizePath(internalEvent)');
    assert.ok(start > 0 && end > start, changed);
    const head = routing.slice(start, end);
    assert.equal(head.match(/\breturn\b/g)?.length, 1, changed);
    assert.deepEqual([...head.matchAll(/headers\[([^\]]+)\]/g)].map((m) => m[1]).sort(), ['ISR_HEADER', 'PRERENDER_REVALIDATE_HEADER'], changed);

    // The names it removes from a client's request by itself, and the geolocation names it sets.
    const handler = read('core/routingHandler.js');
    for (const name of ['x-middleware-rewrite', 'x-middleware-redirect', 'x-middleware-set-cookie', 'x-middleware-skip',
        'x-middleware-override-headers', 'x-middleware-next', 'x-now-route-matches', 'x-matched-path', 'x-nextjs-data']) {
        assert.ok(handler.includes(`"${name}",`), `${name}: ${changed}`);
    }
    assert.match(handler, /INTERNAL_HEADER_PREFIX = "x-opennext-";/, changed);
    assert.match(handler, /MIDDLEWARE_HEADER_PREFIX = "x-middleware-response-";/, changed);
    const geo = handler.slice(handler.indexOf('const geoHeaderToNextHeader = {'), handler.indexOf('};', handler.indexOf('const geoHeaderToNextHeader = {')));
    const pairs = [...geo.matchAll(/"([^"]+)": "([^"]+)"/g)];
    assert.ok(pairs.length >= 5, changed);
    for (const [, from, to] of pairs) assert.ok(from.startsWith('x-open-next-') && to.startsWith('x-vercel-ip-'), `${from} -> ${to}: ${changed}`);

    // Next honours x-matched-path and next-resume only in minimal mode, which OpenNext does not ask for.
    assert.equal(/minimalMode/.test(read('core/util.js')), false, changed);
});
