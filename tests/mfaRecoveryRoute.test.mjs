import test from 'node:test';
import assert from 'node:assert/strict';
import { POST as consume } from '../app/api/v1/mfa/recovery/route.js';
import { POST as generate, GET as status } from '../app/api/v1/mfa/recovery/codes/route.js';
import { hashRecoveryCode, normalizeRecoveryCode } from '../lib/mfaRecovery.js';
import { adminListUserFactors } from '../lib/gotrueAdmin.js';

const USER = '11111111-1111-4111-8111-111111111111';
const FACTOR = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const env = { SUPABASE_URL: 'https://auth.example.test', SUPABASE_SERVICE_ROLE_KEY: 'server-secret', MFA_RECOVERY_PEPPER: 'pepper' };
let calls, attempts, result, deleteStatus, factors;
test.beforeEach(ctx => {
    calls = []; attempts = 0; result = { consumed: true, factor_ids: [FACTOR] }; deleteStatus = 200;
    factors = [{ id: FACTOR, factor_type: 'totp', status: 'verified' }, { id: OTHER, factor_type: 'totp', status: 'unverified' }];
    for (const [key, value] of Object.entries(env)) {
        const old = process.env[key]; process.env[key] = value;
        ctx.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
    }
    ctx.mock.method(globalThis, 'fetch', async (input, init) => {
        const url = new URL(input); const body = init.body ? JSON.parse(init.body) : undefined;
        calls.push({ path: url.pathname, method: init.method, body });
        assert.equal(url.origin, env.SUPABASE_URL);
        assert.equal(init.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
        assert.equal(init.headers.Authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
        if (url.pathname.endsWith('/mfa_recovery_attempt')) return Response.json(++attempts <= 5);
        if (url.pathname.endsWith('/mfa_recovery_consume')) return Response.json(result);
        if (url.pathname.endsWith('/mfa_recovery_replace')) return Response.json(10);
        if (url.pathname.endsWith('/mfa_recovery_status')) return Response.json({ total: 10, unused: 9, usable: 9, needs_regeneration: false });
        if (init.method === 'GET') return Response.json({ factors });
        if (init.method === 'DELETE') return new Response(null, { status: deleteStatus });
        throw new Error('unexpected request');
    });
});
function req({ aal = 'aal1', mfaAt, user = USER, code = '01234-56789', method = 'POST', raw } = {}) {
    const headers = { 'x-veyrnox-auth-id': user, 'x-veyrnox-auth-aal': aal };
    if (mfaAt !== undefined) headers['x-veyrnox-auth-mfa-at'] = String(mfaAt);
    return new Request('https://app.example.test/api/v1/mfa/recovery', { method, headers,
        ...(method !== 'GET' ? { body: raw ?? JSON.stringify({ code }) } : {}) });
}
async function error(response, code, statusCode) {
    assert.equal(response.status, statusCode); assert.equal((await response.json()).error, code);
    assert.equal(response.headers.get('cache-control'), 'no-store');
}

test('aal1 consumes before deleting only bound factors', async () => {
    assert.deepEqual(await (await consume(req())).json(), { recovered: true });
    assert.deepEqual(calls.map(c => c.path.split('/').pop()), ['mfa_recovery_attempt', 'mfa_recovery_consume', FACTOR]);
    assert.deepEqual(calls[1].body, { p_user_id: USER, p_hash: await hashRecoveryCode('0123456789', 'pepper', USER) });
    assert.equal(calls[2].path, `/auth/v1/admin/users/${USER}/factors/${FACTOR}`);
});
test('invalid and malformed codes count toward the hard five-attempt limit', async () => {
    result = { consumed: false, factor_ids: [] };
    for (let i = 0; i < 5; i++) await error(await consume(req({ code: i % 2 ? '?' : '01234-56789' })), 'invalid_recovery_code', 400);
    await error(await consume(req()), 'recovery_rate_limited', 429);
    assert.equal(calls.filter(c => c.path.endsWith('mfa_recovery_consume')).length, 3);
    assert.equal(calls.some(c => c.method === 'DELETE'), false);
});
test('missing pepper and absent identity fail closed before any database call', async () => {
    await error(await consume(req({ user: '' })), 'unauthorized', 401);
    delete process.env.MFA_RECOVERY_PEPPER;
    await error(await consume(req()), 'recovery_not_configured', 503);
    assert.equal(calls.length, 0);
});
test('stale or empty intersection never deletes a factor or reports recovery', async () => {
    for (const value of [{ consumed: true, stale: true, factor_ids: [] }, { consumed: true, factor_ids: [] }]) {
        result = value;
        assert.deepEqual(await (await consume(req())).json(), { recovered: false, stale: true });
    }
    assert.equal(calls.some(c => c.method === 'DELETE'), false);
});
test('404 deletion is successful; other errors burn the code and return a safe retry error', async () => {
    deleteStatus = 404;
    assert.deepEqual(await (await consume(req())).json(), { recovered: true });
    deleteStatus = 503;
    await error(await consume(req()), 'recovery_incomplete', 502);
});
test('all returned bound IDs are deleted', async () => {
    result.factor_ids = [FACTOR, OTHER]; await consume(req());
    assert.deepEqual(calls.filter(c => c.method === 'DELETE').map(c => c.path.split('/').pop()), [FACTOR, OTHER]);
});
test('malformed JSON is uniform invalid-code and still rate limited', async () => {
    await error(await consume(req({ raw: '{' })), 'invalid_recovery_code', 400); assert.equal(attempts, 1);
});
test('generation requires aal2 and the exact server freshness window', async () => {
    const now = Math.floor(Date.now() / 1000);
    await error(await generate(req({ mfaAt: now })), 'reauth_required', 403);
    for (const mfaAt of [undefined, '', 'NaN', -1, now - 301, now + 6, '1.5', '9007199254740992']) {
        await error(await generate(req({ aal: 'aal2', mfaAt })), 'reauth_required', 403);
    }
    assert.equal(calls.length, 0);
});
test('fresh generation returns plaintext once, persists only hashes and server-selected factors', async () => {
    const response = await generate(req({ aal: 'aal2', mfaAt: Math.floor(Date.now() / 1000) }));
    const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.codes.length, 10);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const write = calls.find(c => c.path.endsWith('/mfa_recovery_replace')).body;
    assert.deepEqual(write.p_factor_ids, [FACTOR]); assert.equal(write.p_batch, data.batch_id);
    assert.deepEqual(write.p_hashes, await Promise.all(data.codes.map(c => hashRecoveryCode(normalizeRecoveryCode(c), 'pepper', USER))));
    assert.equal(JSON.stringify(calls).includes(data.codes[0]), false);
});
test('no verified TOTP factors refuses generation', async () => {
    factors = [{ id: OTHER, status: 'verified', factor_type: 'phone' }];
    await error(await generate(req({ aal: 'aal2', mfaAt: Math.floor(Date.now() / 1000) })), 'reauth_required', 403);
});
test('status requires aal2 but not freshness, and never writes', async () => {
    await error(await status(req({ method: 'GET' })), 'reauth_required', 403);
    const data = await (await status(req({ aal: 'aal2', method: 'GET' }))).json();
    assert.equal(data.usable, 9); assert.deepEqual(calls.map(c => c.path.split('/').pop()), ['mfa_recovery_status']);
});
test('status/generation also fail closed without identity or pepper', async () => {
    for (const handler of [status, generate]) await error(await handler(req({ user: '' })), 'unauthorized', 401);
    delete process.env.MFA_RECOVERY_PEPPER;
    for (const handler of [status, generate]) await error(await handler(req({ aal: 'aal2', mfaAt: Math.floor(Date.now() / 1000) })), 'recovery_not_configured', 503);
});
test('upstream failures expose no payload', async ctx => {
    ctx.mock.method(globalThis, 'fetch', async () => { throw new Error('SECRET upstream details'); });
    await error(await consume(req()), 'recovery_unavailable', 503);
    await error(await status(req({ aal: 'aal2' })), 'recovery_unavailable', 503);
});
test('admin reader rejects malformed identifiers before fetch', async () => {
    await assert.rejects(adminListUserFactors('../another-user', { supabaseUrl: env.SUPABASE_URL, serviceRoleKey: 'secret' }));
    assert.equal(calls.length, 0);
});

test('REV-C: identical recovery codes hash differently for authenticated users', async () => {
    await consume(req()); await consume(req({ user: OTHER }));
    const consumed = calls.filter(c => c.path.endsWith('/mfa_recovery_consume')).map(c => c.body);
    assert.deepEqual(consumed.map(c => c.p_user_id), [USER, OTHER]);
    assert.notEqual(consumed[0].p_hash, consumed[1].p_hash);
    assert.equal(consumed[1].p_hash, await hashRecoveryCode('0123456789', 'pepper', OTHER));
});
