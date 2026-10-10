// Identity headers reach a handler only with the value middleware.js gave
// them (ADR-0078).
//
// Next's own router applies a middleware's header deletions. OpenNext, which
// production runs on, does not: it lays the headers the middleware SET over
// the client's own, `{ ...inbound, ...set }`. So the middleware must set every
// identity header to an explicit value on every request, and these tests read
// the result the way OpenNext builds it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { middleware } = await import('../middleware.js');
const { _resetJwksCache } = await import('../lib/supabaseJwt.js');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const middlewareSrc = readFileSync(join(ROOT, 'middleware.js'), 'utf8');
const IDENTITY_HEADERS = [...middlewareSrc
    .slice(middlewareSrc.indexOf('const IDENTITY_HEADERS'), middlewareSrc.indexOf('];', middlewareSrc.indexOf('const IDENTITY_HEADERS')))
    .matchAll(/'(x-veyrnox-[a-z-]+)'/g)].map((m) => m[1]);

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUB = '33333333-3333-4333-8333-333333333333';
const now = () => Math.floor(Date.now() / 1000);
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
const realFetch = globalThis.fetch;
const realError = console.error;
test.before(() => {
    process.env.SUPABASE_URL = SUPABASE_URL;
    console.error = () => {};
    globalThis.fetch = async () => Response.json({ keys: [{ ...jwk, kid: 'test' }] });
});
test.after(() => { globalThis.fetch = realFetch; console.error = realError; });
test.beforeEach(() => _resetJwksCache());

async function token(claims) {
    const h = encode({ alg: 'ES256', kid: 'test' });
    const p = encode({ sub: SUB, iss: `${SUPABASE_URL}/auth/v1`, aud: 'authenticated', exp: now() + 300, ...claims });
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`;
}

/**
 * What a handler receives on OpenNext: @opennextjs/aws core/routing/middleware.js
 * collects the `x-middleware-request-*` response headers into `reqHeaders` and
 * forwards `{ ...internalEvent.headers, ...reqHeaders }`. Deletions are not applied.
 */
function openNextForwarded(request, response) {
    const set = {};
    response.headers.forEach((value, key) => {
        if (key.startsWith('x-middleware-request-')) set[key.substring('x-middleware-request-'.length)] = value;
    });
    return new Headers({ ...Object.fromEntries(request.headers), ...set });
}
async function forwarded(path, headers) {
    const request = new Request(`http://localhost:3000${path}`, { headers });
    const response = await middleware(request);
    assert.ok(response.headers.get('x-middleware-next') || response.headers.get('x-middleware-rewrite'), `middleware answered ${response.status} itself`);
    return openNextForwarded(request, response);
}

// Everything a client might send to pass for someone else.
const FORGED = {
    'x-veyrnox-auth-id': '99999999-9999-4999-8999-999999999999',
    'x-veyrnox-auth-email': 'forged@example.test',
    'x-veyrnox-auth-role': 'service_role',
    'x-veyrnox-auth-aal': 'aal2',
    'x-veyrnox-auth-mfa-at': String(now()),
    'x-veyrnox-organisation-id': 'forged-org',
    'x-request-id': 'forged-request',
};

test('a token with no email, role or second factor: nothing the client sent survives', async () => {
    for (const claims of [{}, { aal: 'aal1' }, { aal: 'aal1', email: '', role: '' }, { aal: 'something-else' }]) {
        const got = await forwarded('/api/v1/session/me', { authorization: `Bearer ${await token(claims)}`, ...FORGED });
        assert.equal(got.get('x-veyrnox-auth-id'), SUB);
        assert.equal(got.get('x-veyrnox-auth-email'), '');
        assert.equal(got.get('x-veyrnox-auth-role'), '');
        assert.equal(got.get('x-veyrnox-auth-aal'), 'aal1');
        assert.equal(got.get('x-veyrnox-auth-mfa-at'), '');
        assert.equal(got.get('x-veyrnox-organisation-id'), '');
        assert.match(got.get('x-request-id'), /^[0-9a-f-]{36}$/);
    }
});

test('an aal2 token without a fresh TOTP entry cannot borrow a client timestamp', async () => {
    const stale = [{ method: 'totp', timestamp: now() - 3600 }];
    for (const claims of [{ aal: 'aal2' }, { aal: 'aal2', amr: stale }, { aal: 'aal2', amr: [{ method: 'password', timestamp: now() }] }]) {
        const got = await forwarded('/api/v1/admin/metrics', { authorization: `Bearer ${await token(claims)}`, ...FORGED });
        assert.equal(got.get('x-veyrnox-auth-aal'), 'aal2');
        assert.equal(got.get('x-veyrnox-auth-mfa-at'), '');
    }
});

test('verified claims are forwarded as they are', async () => {
    const at = now() - 30;
    const got = await forwarded('/api/v1/account', {
        authorization: `Bearer ${await token({ email: 'real@example.test', role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: at }] })}`, ...FORGED,
    });
    assert.deepEqual(IDENTITY_HEADERS.map((h) => got.get(h)), [SUB, 'real@example.test', 'authenticated', 'aal2', String(at)]);
});

test('pages carry no identity at all, whatever the client sent', async () => {
    for (const path of ['/', '/app/admin', '/pricing', '/auth/callback', '/media/social/some-token']) {
        const got = await forwarded(path, FORGED);
        for (const h of IDENTITY_HEADERS) assert.equal(got.get(h), '', `${path} ${h}`);
        assert.equal(got.get('x-veyrnox-organisation-id'), '');
        assert.notEqual(got.get('x-request-id'), 'forged-request');
    }
});

test('every identity header is set on both branches, so none is left to the client', async () => {
    assert.deepEqual(IDENTITY_HEADERS, ['x-veyrnox-auth-id', 'x-veyrnox-auth-email', 'x-veyrnox-auth-role', 'x-veyrnox-auth-aal', 'x-veyrnox-auth-mfa-at']);
    const page = await middleware(new Request('http://localhost:3000/pricing'));
    const api = await middleware(new Request('http://localhost:3000/api/v1/balance', { headers: { authorization: `Bearer ${await token({})}` } }));
    for (const response of [page, api]) {
        for (const h of IDENTITY_HEADERS) assert.notEqual(response.headers.get(`x-middleware-request-${h}`), null, h);
    }
});

test('handlers read the forwarded headers as absent', async () => {
    const got = await forwarded('/api/v1/session/me', { authorization: `Bearer ${await token({})}`, ...FORGED });
    const request = (path) => new Request(`http://localhost:3000${path}`, { headers: got });

    const me = await (await import('../app/api/v1/session/me/route.js')).GET(request('/api/v1/session/me'));
    assert.deepEqual(await me.json(), { authId: SUB, email: null, role: null });

    process.env.ADMIN_REQUIRE_AAL2 = 'true';
    try {
        for (const [file, path] of [['metrics', '/api/v1/admin/metrics'], ['violations', '/api/v1/admin/violations'], ['users/lookup', `/api/v1/admin/users/lookup?user_id=${SUB}`]]) {
            const res = await (await import(`../app/api/v1/admin/${file}/route.js`)).GET(request(path));
            assert.deepEqual([res.status, await res.json()], [403, { error: 'mfa_required' }], file);
        }
    } finally { delete process.env.ADMIN_REQUIRE_AAL2; }

    // The Cinema administrator handlers need a recent second factor.
    Object.assign(process.env, {
        CINEMA_ENABLED: 'true', SOCIAL_CINEMA_PROFILES_ENABLED: 'true', CREATOR_APPLICATIONS_ENABLED: 'true', CREATOR_CONTENT_ENABLED: 'true',
        CINEMA_PUBLISHING_ENABLED: 'true', CINEMA_SUBSCRIPTIONS_ENABLED: 'true', CINEMA_UNLOCKS_ENABLED: 'true',
    });
    const noRpc = async () => assert.fail('reached the database');
    const { publishHandler } = await import('../lib/cinema/publishApi.js');
    const { creatorHandler } = await import('../lib/cinema/creatorApi.js');
    const { earningsHandler } = await import('../lib/cinema/earningsApi.js');
    const { operatorHandler } = await import('../lib/cinema/operatorApi.js');
    const handlers = {
        publish: publishHandler({ action: 'queue', rpcCall: noRpc }),
        creator: creatorHandler({ review: true, rpcCall: noRpc }),
        earnings: earningsHandler({ rpcCall: noRpc }),
        operator: operatorHandler({ action: 'reverse_unlocks', rpcCall: noRpc }),
    };
    const realInfo = console.info;
    console.info = () => {};
    try {
        for (const [name, handler] of Object.entries(handlers)) {
            const res = await handler(request('/api/v1/cinema/admin'));
            assert.equal(res.status, 403, name);
            assert.equal((await res.json()).error, 'recent_mfa_required', name);
        }
    } finally { console.info = realInfo; }
});

test('the Library-to-Cinema route reads only the forwarded identity and refuses without it', async () => {
    const { libraryUploadHandler } = await import('../lib/cinema/libraryUploadApi.js');
    const handler = libraryUploadHandler({ rpcCall: async () => assert.fail('reached the database'), presign: async () => assert.fail('signed an object'), copyVideo: async () => assert.fail('reached Stream') });
    const post = (headers) => new Request('http://localhost:3000/api/v1/cinema/uploads/from-library', { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': SUB }, body: JSON.stringify({ content_id: SUB, job_id: SUB }) });
    const realInfo = console.info;
    console.info = () => {};
    Object.assign(process.env, { CINEMA_ENABLED: 'true', SOCIAL_CINEMA_PROFILES_ENABLED: 'true', CREATOR_CONTENT_ENABLED: 'true', CREATOR_UPLOADS_ENABLED: 'true' });
    try {
        // A page request: the middleware blanked every identity header, whatever the client sent.
        const page = await forwarded('/social-cinema/creator', FORGED);
        assert.deepEqual([(await handler(post(Object.fromEntries(page)))).status], [401]);
        // A verified identity with uploads held: refused before the database, under the same hold as a browser upload.
        const api = await forwarded('/api/v1/cinema/uploads/from-library', { authorization: `Bearer ${await token({})}`, ...FORGED });
        assert.equal(api.get('x-veyrnox-auth-id'), SUB);
        const held = await handler(post(Object.fromEntries(api)));
        assert.deepEqual([held.status, (await held.json()).error], [503, 'upload_safety_hold']);
    } finally { console.info = realInfo; }
});

// stripContext blanks whatever x-veyrnox-* name a client sent, but a handler
// that read a name the middleware does not set would be reading a blank the
// day that stops being true. So the set of names is closed.
function sources(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (name === 'node_modules' || name.startsWith('.')) return [];
        if (statSync(path).isDirectory()) return sources(path);
        return /\.(?:m?js|jsx|ts|tsx)$/.test(name) && !/\.test\.[a-z]+$/.test(name) ? [path] : [];
    });
}
// A caller's own credential on a route the middleware never runs on.
const ALLOWED_ELSEWHERE = { 'app/api/admin/reap-assets/route.js': ['x-veyrnox-admin-token'] };
// The places a prefix itself is matched: the middleware's blanking, and the
// Worker's removal of a caller's identity headers (ADR-0078 amendment 4).
const PREFIX_OWNERS = { 'packages/security/context.js': 'x-veyrnox-', 'lib/internalRequestHeaders.js': 'x-veyrnox-auth-' };

test('handlers read no x-veyrnox-* request header outside IDENTITY_HEADERS', () => {
    const files = ['app', 'lib', 'packages'].flatMap((dir) => sources(join(ROOT, dir)));
    assert.ok(files.length > 200, 'the scan found too few files to be believed');
    const readers = new Set();
    for (const file of files) {
        const rel = relative(ROOT, file).split('\\').join('/');
        for (const [, name] of readFileSync(file, 'utf8').matchAll(/['"`](x-veyrnox-[a-z0-9-]*)['"`]/g)) {
            if (PREFIX_OWNERS[rel] === name) continue;
            if ((ALLOWED_ELSEWHERE[rel] || []).includes(name)) continue;
            assert.ok(IDENTITY_HEADERS.includes(name), `${rel} reads ${name}, which middleware.js does not set`);
            readers.add(name);
        }
    }
    // The scan saw the readers it is meant to police.
    assert.deepEqual([...readers].sort(), [...IDENTITY_HEADERS].sort());
});

// The Worker removes a caller's identity headers, so a request the middleware
// never saw arrives with none (ADR-0078 amendment 4). That only protects a
// handler that refuses when the id is missing, so every one must. Each
// /api/v1 handler is called here with no id, and with the '' the middleware
// sets for a caller it could not name: it has to answer 401 before it reads
// anything. Every *_ENABLED flag is on, so a closed feature cannot answer first.
const ANSWERS_ANYONE = {
    'app/api/v1/[[...path]]/route.js': 404, // the catch-all: no such route, whoever asks
    'app/api/v1/health/route.js': 503,      // echoes the id back; reads nothing of the caller's
};
// These three check the body before the caller, so an empty one would be answered 400.
const BODIES = {
    'app/api/v1/chat/folders/[id]/route.js': { name: 'A' },
    'app/api/v1/chat/personas/[id]/route.js': { name: 'A', instructions: 'Be brief.' },
    'app/api/v1/chat/threads/[id]/route.js': { title: 'A' },
};
test('every /api/v1 handler refuses a request with no caller id, before any outbound call', async () => {
    const flags = [...readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8').matchAll(/"([A-Z0-9_]+_ENABLED)"\s*:/g)].map((m) => m[1]);
    const env = {
        ...Object.fromEntries(flags.map((flag) => [flag, 'true'])),
        APP_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_test', PUBLIC_HOST: 'http://localhost:3000',
    };
    const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
    const stubbedFetch = globalThis.fetch;
    const realInfo = console.info;
    let outbound = [];
    Object.assign(process.env, env);
    globalThis.fetch = async (input) => { outbound.push(String(input?.url || input)); throw new Error('no outbound call is expected'); };
    console.info = () => {};
    try {
        const routes = sources(join(ROOT, 'app', 'api', 'v1')).filter((file) => /[\\/]route\.js$/.test(file));
        let called = 0;
        for (const file of routes) {
            const rel = relative(ROOT, file).split('\\').join('/');
            const handlers = await import(pathToFileURL(file).href);
            const params = Object.fromEntries([...rel.matchAll(/\[(\w+)\]/g)].map((m) => [m[1], SUB]));
            const url = `http://localhost:3000/${rel.slice('app/'.length, -'/route.js'.length).replace(/\[+[.\w]+\]+/g, SUB)}`;
            for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
                if (typeof handlers[method] !== 'function') continue;
                for (const id of [undefined, '']) {
                    outbound = [];
                    const headers = { 'content-type': 'application/json', ...(id === undefined ? {} : { 'x-veyrnox-auth-id': id }) };
                    const body = method === 'GET' ? undefined : JSON.stringify(BODIES[rel] || {});
                    const response = await handlers[method](new Request(url, { method, headers, body }), { params: Promise.resolve(params) });
                    const sent = id === undefined ? 'no id header' : 'an empty id';
                    assert.equal(response.status, ANSWERS_ANYONE[rel] ?? 401, `${method} ${rel} with ${sent}`);
                    if (!(rel in ANSWERS_ANYONE)) assert.deepEqual(outbound, [], `${method} ${rel} made an outbound call with ${sent}`);
                    called += 1;
                }
            }
        }
        assert.ok(called > 250, `only ${called} calls were made: the scan found too few handlers to be believed`);
    } finally {
        globalThis.fetch = stubbedFetch;
        console.info = realInfo;
        for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
});

test('Publish pilot authorizes only signed JWT sub, never forged headers or email', async () => {
    const saved = { PUBLISH_ENABLED: process.env.PUBLISH_ENABLED, PUBLISH_TESTER_AUTH_IDS: process.env.PUBLISH_TESTER_AUTH_IDS };
    Object.assign(process.env, { PUBLISH_ENABLED: 'false', PUBLISH_TESTER_AUTH_IDS: SUB });
    try {
        const path = 'http://localhost:3000/api/v1/social/access';
        const allowed = await middleware(new Request(path, { headers: { authorization: `Bearer ${await token({})}` } }));
        assert.equal(allowed.headers.get('x-middleware-next'), '1');
        const other = await middleware(new Request(path, { headers: { authorization: `Bearer ${await token({ sub: '44444444-4444-4444-8444-444444444444', email: 'tester@example.test' })}`, 'x-veyrnox-auth-id': SUB } }));
        assert.equal(other.status, 503);
        assert.equal((await other.json()).error, 'publish_not_open');
        assert.equal((await middleware(new Request(path, { headers: { 'x-veyrnox-auth-id': SUB } }))).status, 401);
        assert.equal((await middleware(new Request(path, { headers: { authorization: 'Bearer forged' } }))).status, 401);
    } finally {
        for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
});
