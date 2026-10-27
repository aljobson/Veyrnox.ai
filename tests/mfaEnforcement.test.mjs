import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { middleware } = await import('../middleware.js');
const { _resetJwksCache } = await import('../lib/supabaseJwt.js');
const { _resetMfaEnrolmentCache, accountMfaEnrolled, allowedAtAal1, aal2RequiredWhenEnrolled } = await import('../lib/mfaEnforcement.js');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUB = '44444444-4444-4444-8444-444444444444';
const now = () => Math.floor(Date.now() / 1000);
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
const realFetch = globalThis.fetch;
const realError = console.error;
const saved = {};
let enrolment; // what the database says: true, false, or 'down'
let lookups;

test.before(() => {
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'REQUIRE_AAL2_WHEN_ENROLLED']) saved[key] = process.env[key];
    Object.assign(process.env, { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'test-service-role' });
    console.error = () => {};
    globalThis.fetch = async (input, init) => {
        const url = new URL(String(input instanceof Request ? input.url : input));
        if (url.pathname.endsWith('/jwks') || url.pathname.includes('.well-known')) return Response.json({ keys: [{ ...jwk, kid: 'test' }] });
        if (url.pathname === '/rest/v1/rpc/account_mfa_enrolled') {
            lookups.push(JSON.parse(init.body));
            if (enrolment === 'down') return new Response('unavailable', { status: 503 });
            return Response.json(enrolment);
        }
        throw new Error(`unexpected fetch ${url}`);
    };
});
test.after(() => {
    globalThis.fetch = realFetch; console.error = realError;
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
});
test.beforeEach(() => {
    _resetJwksCache(); _resetMfaEnrolmentCache();
    process.env.REQUIRE_AAL2_WHEN_ENROLLED = 'true';
    enrolment = true; lookups = [];
});

async function token(claims = {}) {
    const h = encode({ alg: 'ES256', kid: 'test' });
    const p = encode({ sub: SUB, iss: `${SUPABASE_URL}/auth/v1`, aud: 'authenticated', exp: now() + 300, role: 'authenticated', aal: 'aal1', ...claims });
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`;
}
async function call(path, { claims, method = 'GET', headers = {} } = {}) {
    const request = new Request(`http://localhost:3000${path}`, {
        method, headers: { authorization: `Bearer ${await token(claims)}`, ...headers },
    });
    return middleware(request);
}
const passed = (response) => Boolean(response.headers.get('x-middleware-next'));
async function refused(response, status, error) {
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, error);
}

test('an aal1 token for an enrolled account is refused with mfa_required', async () => {
    await refused(await call('/api/v1/balance'), 403, 'mfa_required');
    await refused(await call('/api/v1/generations', { method: 'POST' }), 403, 'mfa_required');
    await refused(await call('/api/v1/account', { method: 'DELETE' }), 403, 'mfa_required');
    assert.deepEqual(lookups[0], { p_auth_id: SUB });
});

test('a forged aal header cannot stand in for an aal2 token', async () => {
    await refused(await call('/api/v1/balance', { headers: { 'x-veyrnox-auth-aal': 'aal2' } }), 403, 'mfa_required');
});

test('an aal2 token passes without asking the database', async () => {
    assert.equal(passed(await call('/api/v1/balance', { claims: { aal: 'aal2' } })), true);
    assert.equal(lookups.length, 0);
});

test('an account without a verified factor keeps working at aal1', async () => {
    enrolment = false;
    assert.equal(passed(await call('/api/v1/balance')), true);
});

test('an unavailable lookup refuses retryably instead of letting the token through', async () => {
    enrolment = 'down';
    await refused(await call('/api/v1/balance'), 503, 'service_unavailable');
});

test('sign-out can still remove this phone push token at aal1', async () => {
    assert.equal(passed(await call('/api/v1/devices', { method: 'DELETE' })), true);
    await refused(await call('/api/v1/devices', { method: 'POST' }), 403, 'mfa_required');
    assert.equal(allowedAtAal1('delete', '/api/v1/devices/'), true);
    assert.equal(allowedAtAal1('DELETE', '/api/v1/devices/other'), false);
});

test('OAuth-client tokens are left to the MCP route and never looked up', async () => {
    assert.equal(passed(await call('/api/v1/mcp', { method: 'POST', claims: { client_id: 'client-1' } })), true);
    assert.equal(lookups.length, 0);
});

test('the flag is off unless set to exactly true, and then nothing is looked up', async () => {
    for (const value of [undefined, '', '1', 'TRUE', 'yes']) {
        if (value === undefined) delete process.env.REQUIRE_AAL2_WHEN_ENROLLED; else process.env.REQUIRE_AAL2_WHEN_ENROLLED = value;
        assert.equal(aal2RequiredWhenEnrolled(), false, String(value));
        assert.equal(passed(await call('/api/v1/balance')), true);
    }
    assert.equal(lookups.length, 0);
});

test('the answer is cached briefly per account, and a malformed answer is not trusted', async () => {
    const cfg = { supabaseUrl: SUPABASE_URL, serviceRoleKey: 'k' };
    let calls = 0;
    const answer = async () => { calls += 1; return true; };
    assert.equal(await accountMfaEnrolled(SUB, cfg, { now: 1_000, call: answer }), true);
    assert.equal(await accountMfaEnrolled(SUB, cfg, { now: 30_000, call: answer }), true);
    assert.equal(calls, 1);
    assert.equal(await accountMfaEnrolled(SUB, cfg, { now: 62_000, call: answer }), true);
    assert.equal(calls, 2);
    _resetMfaEnrolmentCache();
    await assert.rejects(accountMfaEnrolled(SUB, cfg, { call: async () => ({ ok: true }) }));
});
