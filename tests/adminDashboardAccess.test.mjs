// The admin dashboard routes verify the Cloudflare Access assertion in code
// (ADR-0078), the same way the Cinema administrator routes do. The edge rule
// is still there; this is the check that does not depend on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { requireDashboardAccess, _resetCertsCache } = await import('../lib/accessJwt.js');

const TEAM = 'team.cloudflareaccess.test';
const AUD = 'a'.repeat(64);
const ACCESS = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const SUPABASE = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', ADMIN_REQUIRE_AAL2: 'true' };
const USER = '11111111-1111-4111-8111-111111111111';
const ADMIN = { 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal2' };
const EDGE = { 'cf-ray': '8f0a1b2c3d4e5f60-LHR' };
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

async function keypair(kid = 'kid-1') {
    const pair = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    return { pair, jwk: { kty: 'RSA', n: jwk.n, e: jwk.e, kid, alg: 'RS256' } };
}
async function mint({ pair, jwk }, over = {}) {
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: `https://${TEAM}`, aud: [AUD], exp: now + 300, iat: now, sub: 'access-user', ...over };
    const body = `${b64url(JSON.stringify({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
    const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, pair.privateKey, new TextEncoder().encode(body));
    return `${body}.${b64url(new Uint8Array(sig))}`;
}

/** Answer the Access key set, and count anything that reaches Supabase. */
function stubNetwork(jwks, rpc = () => Response.json({ ok: true, user: {}, jobs: [], action_id: 'a', tier: 'warning' })) {
    const reached = [];
    globalThis.fetch = async (url, init) => {
        const u = String(url);
        if (u.endsWith('/cdn-cgi/access/certs')) {
            if (jwks === null) throw new Error('certs unreachable');
            return Response.json({ keys: jwks });
        }
        reached.push(u);
        return rpc(u, init);
    };
    return reached;
}
async function withEnv(env, run) {
    const before = {};
    for (const [k, v] of Object.entries(env)) { before[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { return await run(); } finally {
        for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}

const ROUTES = [
    ['metrics GET', '../app/api/v1/admin/metrics/route.js', 'GET', '/api/v1/admin/metrics', undefined],
    ['violations GET', '../app/api/v1/admin/violations/route.js', 'GET', '/api/v1/admin/violations', undefined],
    ['violations POST', '../app/api/v1/admin/violations/route.js', 'POST', '/api/v1/admin/violations', { user_id: USER, tier: 'warning', reason: 'test' }],
    ['users/lookup GET', '../app/api/v1/admin/users/lookup/route.js', 'GET', `/api/v1/admin/users/lookup?user_id=${USER}`, undefined],
];
async function call([, file, method, path, body], headers) {
    const mod = await import(`${new URL(file, import.meta.url).href}?t=${Math.random()}`);
    return mod[method](new Request(`https://veyrnox.test${path}`, {
        method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
    }));
}

test.beforeEach(() => _resetCertsCache());
const realError = console.error;
test.before(() => { console.error = () => {}; });
test.after(() => { console.error = realError; });

for (const route of ROUTES) {
    test(`${route[0]}: no assertion is refused as access_required, before Supabase`, async () => {
        const k = await keypair();
        const reached = stubNetwork([k.jwk]);
        await withEnv({ ...SUPABASE, ...ACCESS }, async () => {
            // With Access configured there is no way round it: not even a
            // request that carries no edge header.
            for (const headers of [{ ...ADMIN, ...EDGE }, ADMIN]) {
                const res = await call(route, headers);
                assert.deepEqual([res.status, await res.json()], [403, { error: 'access_required' }]);
            }
        });
        assert.deepEqual(reached, []);
    });

    test(`${route[0]}: an invalid assertion is refused with a typed error, never a 500`, async () => {
        const k = await keypair();
        const stranger = await keypair('kid-1');
        const reached = stubNetwork([k.jwk]);
        const bad = [
            'not.a.jwt', 'garbage', '',
            await mint(stranger),
            await mint(k, { aud: ['b'.repeat(64)] }),
            await mint(k, { iss: 'https://other.cloudflareaccess.test' }),
            await mint(k, { exp: Math.floor(Date.now() / 1000) - 60 }),
        ];
        await withEnv({ ...SUPABASE, ...ACCESS }, async () => {
            for (const assertion of bad) {
                const res = await call(route, { ...ADMIN, ...EDGE, 'cf-access-jwt-assertion': assertion });
                assert.deepEqual([res.status, await res.json()], [403, { error: 'access_required' }], assertion.slice(0, 12));
            }
        });
        assert.deepEqual(reached, []);
    });

    test(`${route[0]}: a valid assertion passes the door`, async () => {
        const k = await keypair();
        const reached = stubNetwork([k.jwk]);
        await withEnv({ ...SUPABASE, ...ACCESS }, async () => {
            const res = await call(route, { ...ADMIN, ...EDGE, 'cf-access-jwt-assertion': await mint(k) });
            assert.ok(res.status < 300, `status ${res.status}`);
        });
        assert.ok(reached.length >= 1 && reached.every((u) => u.startsWith('https://db.test/')), reached.join(' '));
    });

    test(`${route[0]}: the identity and second-factor gates still answer first`, async () => {
        const k = await keypair();
        const reached = stubNetwork([k.jwk]);
        await withEnv({ ...SUPABASE, ...ACCESS }, async () => {
            const assertion = await mint(k);
            const anon = await call(route, { ...EDGE, 'cf-access-jwt-assertion': assertion });
            assert.deepEqual([anon.status, await anon.json()], [401, { error: 'not_authenticated' }]);
            const aal1 = await call(route, { 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal1', ...EDGE, 'cf-access-jwt-assertion': assertion });
            assert.deepEqual([aal1.status, await aal1.json()], [403, { error: 'mfa_required' }]);
        });
        assert.deepEqual(reached, []);
    });

    test(`${route[0]}: an unreachable key set refuses, it does not throw`, async () => {
        const k = await keypair();
        const reached = stubNetwork(null);
        await withEnv({ ...SUPABASE, ...ACCESS }, async () => {
            const res = await call(route, { ...ADMIN, ...EDGE, 'cf-access-jwt-assertion': await mint(k) });
            assert.deepEqual([res.status, await res.json()], [403, { error: 'access_required' }]);
        });
        assert.deepEqual(reached, []);
    });

    test(`${route[0]}: without Access configured, an edge request is refused and a local one works`, async () => {
        const reached = stubNetwork([]);
        await withEnv({ ...SUPABASE, ACCESS_TEAM_DOMAIN: undefined, ACCESS_AUD: undefined }, async () => {
            const edge = await call(route, { ...ADMIN, ...EDGE, 'cf-access-jwt-assertion': 'x.y.z' });
            assert.deepEqual([edge.status, await edge.json()], [503, { error: 'access_not_configured' }]);
            assert.deepEqual(reached, []);
            // Local development and unit tests: nothing came through the edge.
            const local = await call(route, ADMIN);
            assert.ok(local.status < 300, `status ${local.status}`);
        });
        assert.equal(reached.length >= 1, true);
    });
}

test('requireDashboardAccess: closed whenever Access is configured, local only when it is not', async () => {
    const k = await keypair();
    stubNetwork([k.jwk]);
    const req = (headers) => new Request('https://veyrnox.test/api/v1/admin/metrics', { headers });
    const refused = { ok: false, status: 403, error: 'access_required' };

    assert.deepEqual(await requireDashboardAccess(req({}), ACCESS), refused);
    assert.deepEqual(await requireDashboardAccess(req(EDGE), ACCESS), refused);
    assert.deepEqual(await requireDashboardAccess(req({ ...EDGE, 'cf-access-jwt-assertion': 'not.a.jwt' }), ACCESS), refused);
    const good = await requireDashboardAccess(req({ ...EDGE, 'cf-access-jwt-assertion': await mint(k) }), ACCESS);
    assert.deepEqual(good, { ok: true, via: 'access', subject: 'access-user' });

    for (const partial of [{}, { ACCESS_TEAM_DOMAIN: TEAM }, { ACCESS_AUD: AUD }]) {
        assert.deepEqual(await requireDashboardAccess(req(EDGE), partial), { ok: false, status: 503, error: 'access_not_configured' });
        assert.deepEqual(await requireDashboardAccess(req({}), partial), { ok: true, via: 'local' });
    }
});

test('the three dashboard routes all call the gate', async () => {
    const { readFileSync } = await import('node:fs');
    for (const [, file] of ROUTES) {
        const src = readFileSync(new URL(file, import.meta.url), 'utf8');
        assert.match(src, /await requireDashboardAccess\(req\)/, file);
    }
});
