// /api/v1/admin/users/lookup (ADR-0058 decision 7 follow-up): the read behind
// the violations UI. Same gates as the other admin routes, exactly one lookup
// key, and the caller's auth id goes to the RPC so it can check is_admin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const route = new URL('../app/api/v1/admin/users/lookup/route.js', import.meta.url);
const USER = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const ADMIN = { 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal2' };
const CONFIGURED = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', ADMIN_REQUIRE_AAL2: 'true' };

async function withEnv(env, run) {
    const before = {};
    for (const [k, v] of Object.entries(env)) { before[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { return await run(await import(`${route.href}?t=${Math.random()}`)); } finally {
        for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}
const get = (headers, query = '') => new Request(`https://veyrnox.test/api/v1/admin/users/lookup${query}`, { headers });
function stubRpc(handler) {
    const calls = [];
    globalThis.fetch = async (url, init) => { const body = init && init.body ? JSON.parse(init.body) : null; calls.push({ url: String(url), body }); return handler(String(url), body); };
    return calls;
}

test('gates run before any RPC: 401, mfa_required, 503 unconfigured', async () => {
    const calls = stubRpc(() => { throw new Error('must not reach Supabase'); });
    await withEnv(CONFIGURED, async ({ GET }) => {
        assert.equal((await GET(get({}, `?user_id=${USER}`))).status, 401);
        const aal1 = await GET(get({ 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal1' }, `?user_id=${USER}`));
        assert.deepEqual([aal1.status, await aal1.json()], [403, { error: 'mfa_required' }]);
    });
    await withEnv({ ...CONFIGURED, SUPABASE_URL: undefined }, async ({ GET }) => {
        assert.equal((await GET(get(ADMIN, `?user_id=${USER}`))).status, 503);
    });
    assert.equal(calls.length, 0);
});

test('exactly one well-formed lookup key is required', async () => {
    const calls = stubRpc(() => { throw new Error('must not reach Supabase'); });
    await withEnv(CONFIGURED, async ({ GET }) => {
        for (const [query, error] of [
            ['', 'lookup_invalid'],
            [`?user_id=${USER}&email=a@b.co`, 'lookup_invalid'],
            ['?user_id=nope', 'user_id_invalid'],
            ['?job_id=nope', 'job_id_invalid'],
            ['?email=not-an-email', 'email_invalid'],
            [`?email=${encodeURIComponent('a'.repeat(70) + '@x.co')}`, 'email_invalid'],
        ]) {
            const res = await GET(get(ADMIN, query));
            assert.deepEqual([res.status, (await res.json()).error], [400, error], query);
        }
    });
    assert.equal(calls.length, 0);
});

test('each key reaches admin_lookup_user with the admin auth id and the others null', async () => {
    const payload = { ok: true, user: { id: USER, email: 'x@example.test', frozen_at: null, warnings: 0, takedowns: 1 }, jobs: [{ job_id: JOB, model_id: 'seedance-2.0-fast', state: 'STORED', has_asset: true, taken_down: false }] };
    for (const [query, expected] of [
        ['?email=%20X%40Example.test%20', { p_email: 'X@Example.test', p_user_id: null, p_job_id: null }],
        [`?user_id=${USER}`, { p_email: null, p_user_id: USER, p_job_id: null }],
        [`?job_id=${JOB}`, { p_email: null, p_user_id: null, p_job_id: JOB }],
    ]) {
        const calls = stubRpc((u) => { assert.match(u, /\/rpc\/admin_lookup_user$/); return Response.json(payload); });
        await withEnv(CONFIGURED, async ({ GET }) => {
            const res = await GET(get(ADMIN, query));
            assert.equal(res.status, 200);
            assert.deepEqual(await res.json(), { user: payload.user, jobs: payload.jobs });
            assert.equal(res.headers.get('cache-control'), 'no-store');
        });
        assert.deepEqual(calls[0].body, { p_auth_id: 'auth-admin', ...expected }, query);
    }
});

test('RPC outcomes map to typed errors: not_admin 403, user_not_found 404, others 400', async () => {
    await withEnv(CONFIGURED, async ({ GET }) => {
        stubRpc(() => Response.json({ code: '42501', message: 'not_admin' }, { status: 403 }));
        const denied = await GET(get(ADMIN, `?user_id=${USER}`));
        assert.deepEqual([denied.status, await denied.json()], [403, { error: 'not_admin' }]);
        stubRpc(() => Response.json({ ok: false, code: 'USER_NOT_FOUND' }));
        const missing = await GET(get(ADMIN, `?job_id=${JOB}`));
        assert.deepEqual([missing.status, await missing.json()], [404, { error: 'user_not_found' }]);
        stubRpc(() => Response.json({ ok: false, code: 'LOOKUP_REQUIRED' }));
        const bad = await GET(get(ADMIN, `?user_id=${USER}`));
        assert.deepEqual([bad.status, await bad.json()], [400, { error: 'lookup_required' }]);
    });
});
