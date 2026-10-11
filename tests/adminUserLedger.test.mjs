// /api/v1/admin/users/ledger (ADR-0083): one account's ledger and a reasoned
// grant. Same gates as /api/v1/admin/violations, strict input shapes, and the
// grant goes through admin_credit_grant_guarded with the caller's auth id and the
// form's Idempotency-Key so the RPC can refuse non-admins and replays itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const route = new URL('../app/api/v1/admin/users/ledger/route.js', import.meta.url);
const USER = '11111111-1111-4111-8111-111111111111';
const KEY = 'a1b2c3d4-0000-4000-8000-000000000001';
const ADMIN = { 'x-veyrnox-auth-mfa-at': String(Math.floor(Date.now()/1000)), 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal2', 'idempotency-key': KEY };
const CONFIGURED = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', ADMIN_REQUIRE_AAL2: 'true', ADMIN_CREDIT_GRANTS_ENABLED: 'true' };

async function withEnv(env, run) {
    const before = {};
    for (const [k, v] of Object.entries(env)) { before[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { return await run(await import(`${route.href}?t=${Math.random()}`)); } finally {
        for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}
const request = (method, headers, body, query = '') => new Request(`https://veyrnox.test/api/v1/admin/users/ledger${query}`, {
    method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
});
function stubRpc(handler) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const u = String(url);
        const body = init && init.body ? JSON.parse(init.body) : null;
        calls.push({ url: u, body });
        return handler(u, body);
    };
    return calls;
}
const realError = console.error;
test.before(() => { console.error = () => {}; });
test.after(() => { console.error = realError; });

test('unauthenticated, aal1 and unconfigured callers are refused before any RPC', async () => {
    const calls = stubRpc(() => { throw new Error('must not reach Supabase'); });
    await withEnv(CONFIGURED, async ({ GET, POST }) => {
        assert.equal((await GET(request('GET', {}, undefined, `?user_id=${USER}`))).status, 401);
        assert.equal((await POST(request('POST', {}, { user_id: USER, credits: 5, reason: 'note' }))).status, 401);
        const aal1 = await GET(request('GET', { 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal1' }, undefined, `?user_id=${USER}`));
        assert.deepEqual([aal1.status, await aal1.json()], [403, { error: 'mfa_required' }]);
    });
    await withEnv({ ...CONFIGURED, SUPABASE_URL: undefined }, async ({ GET }) => {
        assert.equal((await GET(request('GET', ADMIN, undefined, `?user_id=${USER}`))).status, 503);
    });
    assert.equal(calls.length, 0);
});

test('GET needs a user id and a sane limit; POST validates the body before the RPC', async () => {
    const calls = stubRpc(() => { throw new Error('must not reach Supabase'); });
    await withEnv(CONFIGURED, async ({ GET, POST }) => {
        for (const [query, error] of [['', 'user_id_invalid'], ['?user_id=nope', 'user_id_invalid'], [`?user_id=${USER}&limit=0`, 'limit_invalid'], [`?user_id=${USER}&limit=501`, 'limit_invalid']]) {
            const res = await GET(request('GET', ADMIN, undefined, query));
            assert.deepEqual([res.status, (await res.json()).error], [400, error], query);
        }
        for (const [body, error] of [
            [{ credits: 5, reason: 'note' }, 'user_id_invalid'],
            [{ user_id: USER, credits: 0, reason: 'note' }, 'credits_invalid'],
            [{ user_id: USER, credits: -100001, reason: 'note' }, 'credits_invalid'],
            [{ user_id: USER, credits: 2.5, reason: 'note' }, 'credits_invalid'],
            [{ user_id: USER, credits: '5', reason: 'note' }, 'credits_invalid'],
            [{ user_id: USER, credits: 100001, reason: 'note' }, 'credits_invalid'],
            [{ user_id: USER, credits: 5, reason: '  ' }, 'reason_invalid'],
            [{ user_id: USER, credits: 5, reason: 'x'.repeat(201) }, 'reason_invalid'],
            [[1, 2], 'body_invalid'],
        ]) {
            const res = await POST(request('POST', ADMIN, body));
            assert.deepEqual([res.status, (await res.json()).error], [400, error], JSON.stringify(body));
        }
        const noKey = await POST(request('POST', { 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal2', 'x-veyrnox-auth-mfa-at': ADMIN['x-veyrnox-auth-mfa-at'] }, { user_id: USER, credits: 5, reason: 'note' }));
        assert.deepEqual([noKey.status, (await noKey.json()).error], [400, 'idempotency_key_invalid']);
    });
    assert.equal(calls.length, 0);
});

test('GET reads admin_user_ledger with the admin auth id and never caches', async () => {
    const calls = stubRpc((u) => {
        assert.match(u, /\/rest\/v1\/rpc\/admin_user_ledger$/);
        return Response.json({ ok: true, balance: { balance: 30, free_balance: 0, subscription_balance: 0 }, entries: [{ id: 'e1', delta: 25, reason: 'grant:admin a@b#k' }], actions: [{ id: 'a1', action: 'credit_grant' }] });
    });
    await withEnv(CONFIGURED, async ({ GET }) => {
        const res = await GET(request('GET', ADMIN, undefined, `?user_id=${USER}&limit=50`));
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        const body = await res.json();
        assert.equal(body.balance.balance, 30);
        assert.equal(body.entries.length, 1);
        assert.equal(body.actions[0].action, 'credit_grant');
    });
    assert.deepEqual(calls[0].body, { p_auth_id: 'auth-admin', p_user_id: USER, p_limit: 50 });
});

test('a grant goes through admin_credit_grant_guarded with the trimmed note and the key, 201 when new, 200 on replay', async () => {
    let replayed = false;
    const calls = stubRpc((u) => {
        assert.match(u, /\/rest\/v1\/rpc\/admin_credit_grant_guarded$/);
        return Response.json({ ok: true, replayed, action_id: 'a1', entry_id: 'e1', credits_delta: 25, balance_after: 55 });
    });
    await withEnv(CONFIGURED, async ({ POST }) => {
        const res = await POST(request('POST', ADMIN, { user_id: USER, credits: 25, reason: '  Goodwill after a failed export  ' }));
        assert.equal(res.status, 201);
        assert.deepEqual(await res.json(), { action_id: 'a1', entry_id: 'e1', credits_delta: 25, balance_after: 55, replayed: false });
        replayed = true;
        const again = await POST(request('POST', ADMIN, { user_id: USER, credits: 25, reason: 'Goodwill after a failed export' }));
        assert.equal(again.status, 200);
        assert.equal((await again.json()).replayed, true);
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].body, { p_auth_id: 'auth-admin', p_aal: 'aal2', p_mfa_at: Number(ADMIN['x-veyrnox-auth-mfa-at']), p_user_id: USER, p_credits: 25, p_reason: 'Goodwill after a failed export', p_idempotency_key: KEY });
});

test('RPC refusals map to typed errors: not_admin 403, unknown user 404, others 400', async () => {
    await withEnv(CONFIGURED, async ({ GET, POST }) => {
        stubRpc(() => Response.json({ code: '42501', message: 'not_admin' }, { status: 403 }));
        for (const res of [await GET(request('GET', ADMIN, undefined, `?user_id=${USER}`)), await POST(request('POST', ADMIN, { user_id: USER, credits: 5, reason: 'note' }))]) {
            assert.deepEqual([res.status, await res.json()], [403, { error: 'not_admin' }]);
        }
        for (const [code, status] of [['USER_NOT_FOUND', 404], ['IDEMPOTENCY_KEY_REUSED', 400], ['GRANT_ALREADY_APPLIED', 400]]) {
            stubRpc(() => Response.json({ ok: false, code }));
            const res = await POST(request('POST', ADMIN, { user_id: USER, credits: 5, reason: 'note' }));
            assert.deepEqual([res.status, (await res.json()).error], [status, code.toLowerCase()]);
        }
        stubRpc(() => { throw new Error('network'); });
        const down = await GET(request('GET', ADMIN, undefined, `?user_id=${USER}`));
        assert.deepEqual([down.status, await down.json()], [502, { error: 'internal' }]);
    });
});

 test('grant switch and fresh MFA hold even when the general AAL flag is off', async () => {
 const calls=stubRpc(()=>{throw Error('no RPC');});
 await withEnv({...CONFIGURED, ADMIN_CREDIT_GRANTS_ENABLED:'false'},async({POST})=>{
 assert.equal((await POST(request('POST',ADMIN,{user_id:USER,credits:5,reason:'note'}))).status,503);
 });
 await withEnv({...CONFIGURED,ADMIN_REQUIRE_AAL2:'false'},async({POST})=>{
 for(const bad of ['', 'nope', String(Math.floor(Date.now()/1000)-301), String(Math.floor(Date.now()/1000)+30)]) {
 const r=await POST(request('POST',{...ADMIN,'x-veyrnox-auth-mfa-at':bad},{user_id:USER,credits:5,reason:'note'}));
 assert.deepEqual([r.status,await r.json()],[403,{error:'mfa_required'}]);
 }
 });assert.equal(calls.length,0);
});

test('negative credits dispatch positive magnitude to clawback RPC; exact replay and cap mapping', async () => {
    await withEnv(CONFIGURED, async ({ POST }) => {
        for (const replayed of [false, true]) {
            stubRpc((u, body) => {
                assert.match(u, /admin_credit_clawback_guarded$/);
                assert.deepEqual(body, { p_auth_id: 'auth-admin', p_aal: 'aal2', p_mfa_at: Number(ADMIN['x-veyrnox-auth-mfa-at']), p_user_id: USER, p_credits: 40, p_reason: 'correct allocation', p_idempotency_key: KEY });
                return Response.json({ ok: true, action_id: 'a', entry_id: 'e', credits_delta: -40, balance_after: 60, replayed });
            });
            const res = await POST(request('POST', ADMIN, { user_id: USER, credits: -40, reason: ' correct allocation ' }));
            assert.equal(res.status, replayed ? 200 : 201);
            assert.deepEqual(await res.json(), { action_id: 'a', entry_id: 'e', credits_delta: -40, balance_after: 60, replayed });
        }
        stubRpc(() => Response.json({ ok: false, code: 'INSUFFICIENT_PACK_CREDITS', pack_credits: 60 }));
        const res = await POST(request('POST', ADMIN, { user_id: USER, credits: -61, reason: 'correct allocation' }));
        assert.deepEqual([res.status, await res.json()], [400, { error: 'insufficient_pack_credits', pack_credits: 60 }]);
        stubRpc(() => Response.json({ ok: false, code: 'IDEMPOTENCY_KEY_REUSED' }));
        assert.equal((await POST(request('POST', ADMIN, { user_id: USER, credits: -40, reason: 'correct allocation' }))).status, 400);
    });
});
