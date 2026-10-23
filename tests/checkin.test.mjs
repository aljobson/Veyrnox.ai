import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { checkinEnabled } from '../lib/checkin.js';
import { mockCheckin } from '../apps/mobile/dev/mockCheckin.mjs';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
const { GET, POST } = await import('../app/api/v1/checkin/route.js');
const auth = '11111111-1111-4111-8111-111111111111';
const req = (method, body, id = auth) => new Request('https://v.test/api/v1/checkin', {
    method, headers: id ? { 'x-veyrnox-auth-id': id } : {}, ...(body === undefined ? {} : { body }),
});
async function setup(fn) {
    const saved = { ...process.env }; const fetch = globalThis.fetch;
    const calls = []; let result = { ok: true }; let rate = { ok: true };
    Object.assign(process.env, { CHECKIN_ENABLED: 'true', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'false' });
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/rpc/')[1];
        calls.push({ name, body: JSON.parse(init.body) });
        const value = name === 'consume_account_read_request' ? rate : result;
        if (value instanceof Error) throw value;
        return Response.json(value);
    };
    try { await fn({ calls, result: value => { result = value; }, rate: value => { rate = value; } }); }
    finally {
        globalThis.fetch = fetch;
        for (const key of ['CHECKIN_ENABLED', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ACCOUNT_READ_RATE_LIMIT_ENABLED']) {
            if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
        }
    }
}
test('check-in flag accepts only the exact string true', () => {
    assert.equal(checkinEnabled({ CHECKIN_ENABLED: 'true' }), true);
    for (const value of [undefined, null, '', 'TRUE', '1', true, 'false']) assert.equal(checkinEnabled({ CHECKIN_ENABLED: value }), false);
    assert.equal(checkinEnabled(undefined), false);
});
test('both methods require a verified UUID and hide feature when disabled', () => setup(async ({ calls }) => {
    for (const [method, handler] of [['GET', GET], ['POST', POST]]) {
        for (const id of [null, 'not-a-uuid']) assert.equal((await handler(req(method, undefined, id))).status, 401);
        delete process.env.CHECKIN_ENABLED;
        const response = await handler(req(method));
        assert.equal(response.status, 404); assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.deepEqual(await response.json(), { error: 'not_found' });
    }
    assert.equal(calls.length, 0);
}));
test('routes forward Auth UUID, reject every nonempty POST body and preserve results', () => setup(async ({ calls, result }) => {
    for (const body of ['{}', ' ', 'null', '{"credits":999}']) assert.equal((await POST(req('POST', body))).status, 400);
    assert.equal(calls.length, 0);
    const status = { ok: true, claimed_today: false, streak: 2, next_day: 3, next_credits: 2, rewards: [1,1,2,2,2,3] };
    result(status); assert.deepEqual(await (await GET(req('GET'))).json(), status);
    const claim = { ok: true, already_claimed: false, streak: 3, day: 3, credits: 2, balance_after: 12 };
    result(claim); assert.deepEqual(await (await POST(req('POST'))).json(), claim);
    assert.deepEqual(calls, ['read_checkin_status', 'daily_checkin'].map(name => ({ name, body: { p_auth_id: auth } })));
}));
test('typed errors do not expose upstream details', () => setup(async ({ result }) => {
    for (const handler of [GET, POST]) {
        const method = handler === GET ? 'GET' : 'POST';
        for (const [upstream, status, error] of [
            [{ ok: false, code: 'CHECKIN_BUSY' }, 409, 'checkin_busy'],
            [{ ok: false, code: 'ACCOUNT_UNAVAILABLE' }, 403, 'account_unavailable'],
            [{ ok: false, code: 'secret-db-detail' }, 502, 'checkin_unavailable'],
            [new Error('secret-db-detail'), 502, 'checkin_unavailable'],
        ]) {
            result(upstream); const response = await handler(req(method));
            assert.equal(response.status, status); assert.deepEqual(await response.json(), { error });
        }
    }
}));
test('both reads and writes consume the existing rate bucket', () => setup(async ({ rate, calls }) => {
    process.env.ACCOUNT_READ_RATE_LIMIT_ENABLED = 'true';
    rate({ ok: false, code: 'RATE_LIMITED', retry_after_seconds: 12 });
    assert.equal((await POST(req('POST'))).status, 429);
    assert.equal((await GET(req('GET'))).status, 429);
    assert.ok(calls.every(c => c.name === 'consume_account_read_request'));
    rate({ ok: false, code: 'NOT_FOUND' });
    assert.equal((await POST(req('POST'))).status, 403);
}));
test('development mock respects the flag, UTC streak amounts and daily replay', () => {
    const state = { balance: 10 }; const now = Date.parse('2026-10-01T23:59:00Z');
    assert.equal(mockCheckin('GET', 'alice', state, false, now).status, 404);
    for (let i = 0; i < 7; i++) {
        const stamp = now + i * 86400000;
        assert.equal(mockCheckin('GET', 'alice', state, true, stamp).body.next_credits, [1,1,2,2,2,3,3][i]);
        assert.equal(mockCheckin('POST', 'alice', state, true, stamp).body.credits, [1,1,2,2,2,3,3][i]);
        assert.equal(mockCheckin('POST', 'alice', state, true, stamp).body.credits, 0);
    }
    assert.equal(state.balance, 24);
    assert.equal(mockCheckin('POST', 'alice', state, true, now + 9 * 86400000).body.streak, 1);
});
