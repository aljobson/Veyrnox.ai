// The framework's routing layer reads a few request headers as its own
// instructions: the pair its revalidation queue sends, and the geolocation it
// derives from Cloudflare. Nothing outside the Worker has a reason to send
// either, so worker.js removes them before the framework builds its event
// (ADR-0078, amendment 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(s, c, next) {
    if (s.endsWith('/.open-next/worker.js')) return {
      url: 'data:text/javascript,' + encodeURIComponent('export default {fetch: (...args) => globalThis.__internalHeadersTestApp(...args)};'), shortCircuit: true
    };
    return next(s, c);
  }
`));
const worker = (await import('../worker.js')).default;
const allow = { ADMIN_EDGE_RATE_LIMITER: { limit: async () => ({ success: true }) } };
const ORIGIN = 'https://veyrnox.test';
const LOGGED = '[internal-headers] dropped a revalidation header sent from outside';

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
};
const INTERNAL = { ...REVALIDATION, ...GEO };
const ORDINARY = {
    authorization: 'Bearer anything',
    accept: 'application/json',
    cookie: 'a=1; b=2',
    'content-type': 'application/json',
    'cf-connecting-ip': '203.0.113.7',
    'x-forwarded-for': '203.0.113.7',
    'idempotency-key': 'k-1',
    // Left for the middleware, which gives every identity header its own value.
    'x-veyrnox-auth-id': 'sent by the caller',
    // Names that only look like the internal ones are not this layer's business.
    'x-isr-status': 'keep', 'x-prerender': 'keep', 'x-open-next': 'keep', 'x-opennext-debug': 'keep',
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

test('a revalidation header from outside is logged once, without its value; geolocation is not', async () => {
    const secret = REVALIDATION['x-prerender-revalidate'];
    for (const [name, value] of Object.entries(REVALIDATION)) {
        const said = await quietly(() => throughWorker(new Request(`${ORIGIN}/api/v1/session/me`, { headers: { [name]: value } })));
        assert.deepEqual(said, [LOGGED], name);
    }
    const all = await quietly(() => throughWorker(new Request(`${ORIGIN}/api/v1/session/me?t=${secret}`, { headers: INTERNAL })));
    assert.deepEqual(all, [LOGGED]);
    assert.equal(all.join(' ').includes(secret), false);
    assert.deepEqual(await quietly(() => throughWorker(new Request(`${ORIGIN}/pricing`, { headers: GEO }))), []);
    assert.deepEqual(await quietly(() => throughWorker(new Request(`${ORIGIN}/pricing`, { headers: ORDINARY }))), []);
});
