// The admin dashboard routes verify the Cloudflare Access assertion in code
// (ADR-0078), the same way the Cinema administrator routes do. The edge rule
// is still there; this is the check that does not depend on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { requireDashboardAccess, verifyAccessLogin, _resetCertsCache } = await import('../lib/accessJwt.js');

const TEAM = 'team.cloudflareaccess.test';
const AUD = 'a'.repeat(64);
const ACCESS = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const SUPABASE = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', ADMIN_REQUIRE_AAL2: 'true' };
const USER = '11111111-1111-4111-8111-111111111111';
// The violations POST needs an Idempotency-Key since 0246; the other routes ignore it.
const ADMIN = { 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal2', 'idempotency-key': 'access-test-key-0001' };
const EDGE = { 'cf-ray': '8f0a1b2c3d4e5f60-LHR' };
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

async function keypair(kid = 'kid-1') {
    const pair = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    return { pair, jwk: { kty: 'RSA', n: jwk.n, e: jwk.e, kid, alg: 'RS256' } };
}
// The two payloads Access issues, as its application token reference gives
// them: a person who logged in, and a service token.
const PERSON = { type: 'app', email: 'owner@example.test', sub: '7335d417-61da-459d-899c-0a01c76a2f94', identity_nonce: '6ei69kawdKzMIAPF', country: 'GB' };
const SERVICE_TOKEN = { type: 'app', common_name: 'e367826f93b8d71185e03fe518aff3b4.access', sub: '' };
async function mint({ pair, jwk }, over = {}, base = PERSON) {
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: `https://${TEAM}`, aud: [AUD], exp: now + 300, iat: now, nbf: now, ...base, ...over };
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

    test(`${route[0]}: an assertion issued to a service token is refused, before Supabase`, async () => {
        const k = await keypair();
        const reached = stubNetwork([k.jwk]);
        await withEnv({ ...SUPABASE, ...ACCESS }, async () => {
            const res = await call(route, { ...ADMIN, ...EDGE, 'cf-access-jwt-assertion': await mint(k, {}, SERVICE_TOKEN) });
            assert.deepEqual([res.status, await res.json()], [403, { error: 'access_required' }]);
        });
        assert.deepEqual(reached, []);
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
    assert.deepEqual(good, { ok: true, via: 'access', subject: PERSON.sub });

    for (const partial of [{}, { ACCESS_TEAM_DOMAIN: TEAM }, { ACCESS_AUD: AUD }]) {
        assert.deepEqual(await requireDashboardAccess(req(EDGE), partial), { ok: false, status: 503, error: 'access_not_configured' });
        assert.deepEqual(await requireDashboardAccess(req({}), partial), { ok: true, via: 'local' });
    }
});

// One Access application and one audience cover the machine endpoints and the
// dashboard, so a service token's assertion is valid for both. The dashboard
// is for a person: it takes the assertion of a login and no other.
test('requireDashboardAccess: a person\'s login passes, every other validly signed assertion is refused', async () => {
    const k = await keypair();
    stubNetwork([k.jwk]);
    const gate = async (over, base) => requireDashboardAccess(new Request('https://veyrnox.test/api/v1/admin/metrics', {
        headers: { ...EDGE, 'cf-access-jwt-assertion': await mint(k, over, base) },
    }), ACCESS);
    const refused = { ok: false, status: 403, error: 'access_required' };

    assert.deepEqual(await gate(), { ok: true, via: 'access', subject: PERSON.sub });
    // Claims Access may add to a login do not matter. That includes a
    // common_name: a policy can ask a person for a client certificate as well.
    assert.equal((await gate({ custom: { groups: ['admins'] }, country: undefined, identity_nonce: undefined })).ok, true);
    assert.equal((await gate({ common_name: 'laptop.example.test' })).ok, true);

    assert.deepEqual(await gate({}, SERVICE_TOKEN), refused, 'the service token payload as documented');
    const notAPerson = [
        [{ sub: '' }, 'an empty sub'],
        [{ sub: undefined }, 'no sub'],
        [{ sub: 7 }, 'a sub that is not text'],
        [{ email: undefined }, 'no email'],
        [{ email: '' }, 'an empty email'],
        [{ email: ['owner@example.test'] }, 'an email that is not text'],
        [{ common_name: SERVICE_TOKEN.common_name, sub: '' }, 'a service token with an email added'],
    ];
    for (const [over, what] of notAPerson) assert.deepEqual(await gate(over), refused, what);
    assert.deepEqual(await gate({ email: 'owner@example.test' }, SERVICE_TOKEN), refused);
    assert.deepEqual(await gate({ sub: PERSON.sub }, SERVICE_TOKEN), refused);
});

test('requireDashboardAccess: the refusal is logged by kind, with nothing from the assertion', async () => {
    const k = await keypair();
    stubNetwork([k.jwk]);
    const said = [];
    const quiet = console.error;
    console.error = (...a) => said.push(a.join(' '));
    try {
        await requireDashboardAccess(new Request('https://veyrnox.test/api/v1/admin/metrics', {
            headers: { ...EDGE, 'cf-access-jwt-assertion': await mint(k, {}, SERVICE_TOKEN) },
        }), ACCESS);
    } finally { console.error = quiet; }
    assert.deepEqual(said, ['[access] refused: not_a_login']);
});

// The check the Cinema administrator handlers run on the assertion: the same
// verification, then the same rule as the dashboard (ADR-0078 amendment 2).
test('verifyAccessLogin: returns a login\'s payload and throws for any other assertion, with a reason', async () => {
    const k = await keypair();
    stubNetwork([k.jwk]);
    const check = async (over, base) => verifyAccessLogin(await mint(k, over, base), { teamDomain: TEAM, aud: AUD });

    const payload = await check();
    assert.deepEqual([payload.email, payload.sub], [PERSON.email, PERSON.sub]);
    await assert.rejects(check({}, SERVICE_TOKEN), { reason: 'not_a_login' });
    await assert.rejects(check({ sub: '' }), { reason: 'not_a_login' });
    await assert.rejects(check({ email: undefined }), { reason: 'not_a_login' });
    // An assertion that does not verify is refused for that, whatever it claims.
    await assert.rejects(check({ aud: ['b'.repeat(64)] }), { reason: 'audience' });
    await assert.rejects(check({ exp: Math.floor(Date.now() / 1000) - 60 }), { reason: 'expired' });
    await assert.rejects(verifyAccessLogin(await mint(await keypair('kid-1')), { teamDomain: TEAM, aud: AUD }), { reason: 'signature' });
    await assert.rejects(verifyAccessLogin('not.a.jwt', { teamDomain: TEAM, aud: AUD }), { reason: 'malformed' });
});

// The Cinema administrator routes, called as exported, so the verifier under
// test is the one production runs. One answer satisfies every RPC they make.
const TITLE = '22222222-2222-4222-8222-222222222222';
const CINEMA_ON = {
    CINEMA_ENABLED: 'true', SOCIAL_CINEMA_PROFILES_ENABLED: 'true', CREATOR_APPLICATIONS_ENABLED: 'true', CREATOR_CONTENT_ENABLED: 'true',
    CINEMA_PUBLISHING_ENABLED: 'true', CINEMA_UNLOCKS_ENABLED: 'true', CINEMA_SUBSCRIPTIONS_ENABLED: 'true',
};
const CINEMA_ANSWER = {
    ok: true, applications: [], submissions: [], content: [], id: USER, status: 'approved',
    content_id: TITLE, pass_id: TITLE, unlocks_reversed: 0, credits_returned: 0, complete: true, refund_usd_cents: 100,
};
const cinemaAdmin = () => ({
    'x-veyrnox-auth-id': USER, 'x-veyrnox-auth-aal': 'aal2', 'x-veyrnox-auth-mfa-at': String(Math.floor(Date.now() / 1000)),
    'idempotency-key': USER, ...EDGE,
});
const CINEMA_ROUTES = [
    ['cinema creators GET', '../app/api/v1/admin/cinema/creators/route.js', 'GET', '/api/v1/admin/cinema/creators', undefined],
    ['cinema creators POST', '../app/api/v1/admin/cinema/creators/route.js', 'POST', '/api/v1/admin/cinema/creators', { application_id: TITLE, decision: 'approved', reason: 'Original work' }],
    ['cinema earnings GET', '../app/api/v1/admin/cinema/earnings/route.js', 'GET', '/api/v1/admin/cinema/earnings', undefined],
    ['cinema submissions GET', '../app/api/v1/admin/cinema/submissions/route.js', 'GET', '/api/v1/admin/cinema/submissions', undefined],
    ['cinema submissions POST', '../app/api/v1/admin/cinema/submissions/route.js', 'POST', '/api/v1/admin/cinema/submissions', { submission_id: TITLE, decision: 'approved', reason: 'Looks fine' }],
    ['cinema suspend POST', '../app/api/v1/admin/cinema/suspend/route.js', 'POST', '/api/v1/admin/cinema/suspend', { content_id: TITLE, reason: 'Rights complaint upheld' }],
    ['cinema unlocks/reverse POST', '../app/api/v1/admin/cinema/unlocks/reverse/route.js', 'POST', '/api/v1/admin/cinema/unlocks/reverse', { content_id: TITLE, reason: 'Rights complaint' }],
    ['cinema pass/refund POST', '../app/api/v1/admin/cinema/pass/refund/route.js', 'POST', '/api/v1/admin/cinema/pass/refund', { pass_id: TITLE, reason: 'Duplicate Pass charge' }],
];

/** What a test logged through console.error: every line, and the Access gate's own. */
function errorLog(t) {
    const all = [];
    t.mock.method(console, 'error', (...a) => all.push(a.join(' ')));
    return { all, access: () => all.filter((line) => line.startsWith('[access]')) };
}

for (const route of CINEMA_ROUTES) {
    test(`${route[0]}: an assertion issued to a service token is refused, before Supabase`, async (t) => {
        t.mock.method(console, 'info', () => {});
        const said = errorLog(t);
        const k = await keypair();
        const reached = stubNetwork([k.jwk], () => Response.json(CINEMA_ANSWER));
        const assertion = await mint(k, {}, SERVICE_TOKEN);
        await withEnv({ ...SUPABASE, ...ACCESS, ...CINEMA_ON }, async () => {
            const res = await call(route, { ...cinemaAdmin(), 'cf-access-jwt-assertion': assertion });
            assert.deepEqual([res.status, (await res.json()).error], [403, 'access_required']);
        });
        assert.deepEqual(reached, []);
        // The refusal is logged by kind, with nothing from the assertion.
        assert.deepEqual(said.access(), ['[access] refused: not_a_login']);
        for (const secret of [assertion, ...assertion.split('.'), SERVICE_TOKEN.common_name]) assert.ok(!said.all.join('\n').includes(secret));
    });

    test(`${route[0]}: a person's login passes the door`, async (t) => {
        t.mock.method(console, 'info', () => {});
        const k = await keypair();
        const reached = stubNetwork([k.jwk], () => Response.json(CINEMA_ANSWER));
        const said = errorLog(t);
        await withEnv({ ...SUPABASE, ...ACCESS, ...CINEMA_ON }, async () => {
            const res = await call(route, { ...cinemaAdmin(), 'cf-access-jwt-assertion': await mint(k) });
            assert.equal(res.status, 200);
        });
        assert.ok(reached.length >= 2 && reached.every((u) => u.startsWith('https://db.test/')), reached.join(' '));
        assert.deepEqual(said.access(), []);
    });

    test(`${route[0]}: an assertion that does not verify, or none, is still refused`, async (t) => {
        t.mock.method(console, 'info', () => {});
        const said = errorLog(t);
        const k = await keypair();
        const reached = stubNetwork([k.jwk], () => Response.json(CINEMA_ANSWER));
        const bad = [undefined, 'not.a.jwt', await mint(await keypair('kid-1')), await mint(k, { aud: ['b'.repeat(64)] })];
        await withEnv({ ...SUPABASE, ...ACCESS, ...CINEMA_ON }, async () => {
            for (const assertion of bad) {
                const res = await call(route, { ...cinemaAdmin(), ...(assertion ? { 'cf-access-jwt-assertion': assertion } : {}) });
                assert.deepEqual([res.status, (await res.json()).error], [403, 'access_required'], String(assertion).slice(0, 12));
            }
        });
        assert.deepEqual(reached, []);
        assert.deepEqual(said.access(), [
            '[access] refused: no assertion on a Cinema administrator request',
            '[access] refused: malformed', '[access] refused: signature', '[access] refused: audience',
        ]);
    });
}

// A handler factory that verifies the assertion itself, in the mode that does.
const CINEMA_ADMIN = /^(?:creatorHandler\(\{ review: true\b|earningsHandler\(|operatorHandler\(\{ action: '(?:reverse_unlocks|refund_pass)'|publishHandler\(\{ action: '(?:queue|review|suspend)')/;

test('every route under /api/v1/admin verifies the Access assertion in code', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const walk = (dir) => readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : /^route\.[jt]sx?$/.test(name) ? [path] : [];
    });
    const files = walk(fileURLToPath(new URL('../app/api/v1/admin', import.meta.url)));
    assert.ok(files.length >= 9, `found ${files.length} admin routes`);
    // Each of these is called above with a service token's assertion and a login's.
    const called = new Set(CINEMA_ROUTES.map(([, file, method]) => `${fileURLToPath(new URL(file, import.meta.url))} ${method}`));
    let dashboard = 0;
    for (const file of files) {
        const src = readFileSync(file, 'utf8');
        if (/await requireDashboardAccess\(req\)/.test(src)) { dashboard++; continue; }
        const handlers = [...src.matchAll(/^export const ([A-Z]+) = (.+);$/gm)];
        assert.ok(handlers.length > 0, `${file} has no in-code Access check`);
        // A method exported in any other form would not be read below.
        const named = src.match(/\b(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/g);
        assert.equal(named.length, handlers.length, `${file} names a method outside a one-line export`);
        for (const [, method, handler] of handlers) {
            assert.match(handler, CINEMA_ADMIN, `${file}: ${handler}`);
            assert.ok(called.delete(`${file} ${method}`), `${file} ${method} is not in CINEMA_ROUTES`);
        }
    }
    assert.equal(dashboard, 3);
    assert.deepEqual([...called], [], 'CINEMA_ROUTES names a route that does not exist');
});
