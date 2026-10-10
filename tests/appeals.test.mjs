// /api/v1/appeals (ADR-0083): a user's own sanctions and appeals. Identity is
// the middleware's header only; the RPCs resolve the account from it, the
// route never takes a user id from the client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const route = new URL('../app/api/v1/appeals/route.js', import.meta.url);
const SUB = '11111111-1111-4111-8111-111111111111';
const ACTION = '22222222-2222-4222-8222-222222222222';
const USER_HEADERS = { 'x-veyrnox-auth-id': SUB };
const CONFIGURED = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };

async function withEnv(env, run) {
    const before = {};
    for (const [k, v] of Object.entries(env)) { before[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { return await run(await import(`${route.href}?t=${Math.random()}`)); } finally {
        for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}
const request = (method, headers, body) => new Request('https://veyrnox.test/api/v1/appeals', {
    method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
});
/** Supabase stub: the account read limit is open, then the RPC answers. */
function stubRpc(handler) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const u = String(url);
        const body = init && init.body ? JSON.parse(init.body) : null;
        if (u.includes('/rpc/consume_account_read_request')) return Response.json({ ok: true });
        calls.push({ url: u, body });
        return handler(u, body);
    };
    return calls;
}
const realError = console.error;
test.before(() => { console.error = () => {}; });
test.after(() => { console.error = realError; });

test('a caller without a verified identity, or a malformed one, is refused before any RPC', async () => {
    const calls = stubRpc(() => { throw new Error('must not reach Supabase'); });
    await withEnv(CONFIGURED, async ({ GET, POST }) => {
        for (const headers of [{}, { 'x-veyrnox-auth-id': '' }, { 'x-veyrnox-auth-id': 'not-a-uuid' }]) {
            assert.equal((await GET(request('GET', headers))).status, 401);
            assert.equal((await POST(request('POST', headers, { action_id: ACTION, statement: 'This decision was wrong because…' }))).status, 401);
        }
    });
    await withEnv({ ...CONFIGURED, SUPABASE_URL: undefined }, async ({ GET }) => {
        assert.equal((await GET(request('GET', USER_HEADERS))).status, 503);
    });
    assert.equal(calls.length, 0);
});

test('GET returns the sanctions, hold and frozen flag from list_my_sanctions, keyed by the auth id only', async () => {
    const calls = stubRpc((u) => {
        if (u.includes('/rpc/list_my_sanctions')) return Response.json({ ok: true, sanctions: [{ action_id: ACTION, action: 'takedown', appeal_status: null }], hold_until: '2026-10-13T00:00:00Z', frozen: false });
        return Response.json({ ok: true });
    });
    await withEnv(CONFIGURED, async ({ GET }) => {
        const res = await GET(request('GET', USER_HEADERS));
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await res.json(), { sanctions: [{ action_id: ACTION, action: 'takedown', appeal_status: null }], hold_until: '2026-10-13T00:00:00Z', frozen: false });
    });
    const list = calls.find((c) => c.url.includes('/rpc/list_my_sanctions'));
    assert.deepEqual(list.body, { p_auth_id: SUB });
});

test('POST validates the action id and statement, then submits with the auth id; a repeat is 200 replayed', async () => {
    let replayed = false;
    const calls = stubRpc((u) => {
        if (u.includes('/rpc/submit_content_appeal')) return Response.json({ ok: true, appeal_id: 'ap1', status: 'open', submitted_at: '2026-10-10T00:00:00Z', replayed });
        return Response.json({ ok: true });
    });
    await withEnv(CONFIGURED, async ({ POST }) => {
        for (const [body, error] of [
            [{ statement: 'This decision was wrong because…' }, 'action_id_invalid'],
            [{ action_id: 'nope', statement: 'This decision was wrong because…' }, 'action_id_invalid'],
            [{ action_id: ACTION, statement: 'short' }, 'statement_invalid'],
            [{ action_id: ACTION, statement: 'x'.repeat(2001) }, 'statement_invalid'],
            [[1], 'body_invalid'],
        ]) {
            const res = await POST(request('POST', USER_HEADERS, body));
            assert.deepEqual([res.status, (await res.json()).error], [400, error], JSON.stringify(body));
        }
        const res = await POST(request('POST', USER_HEADERS, { action_id: ACTION, statement: '  This decision was wrong because the clip is my own.  ' }));
        assert.equal(res.status, 201);
        assert.deepEqual(await res.json(), { appeal_id: 'ap1', status: 'open', submitted_at: '2026-10-10T00:00:00Z', replayed: false });
        replayed = true;
        assert.equal((await POST(request('POST', USER_HEADERS, { action_id: ACTION, statement: 'This decision was wrong because the clip is my own.' }))).status, 200);
    });
    const submits = calls.filter((c) => c.url.includes('/rpc/submit_content_appeal'));
    assert.equal(submits.length, 2);
    assert.deepEqual(submits[0].body, { p_auth_id: SUB, p_action_id: ACTION, p_statement: 'This decision was wrong because the clip is my own.' });
});

test('RPC refusals are typed: an action that is not the caller\'s is 404, not appealable 400, outage 502', async () => {
    await withEnv(CONFIGURED, async ({ POST, GET }) => {
        for (const [code, status] of [['ACTION_NOT_FOUND', 404], ['ACTION_NOT_APPEALABLE', 400], ['STATEMENT_INVALID', 400]]) {
            stubRpc((u) => (u.includes('/rpc/submit_content_appeal') ? Response.json({ ok: false, code }) : Response.json({ ok: true })));
            const res = await POST(request('POST', USER_HEADERS, { action_id: ACTION, statement: 'This decision was wrong because…' }));
            assert.deepEqual([res.status, (await res.json()).error], [status, code.toLowerCase()]);
        }
        stubRpc(() => { throw new Error('network'); });
        assert.deepEqual([(await GET(request('GET', USER_HEADERS))).status], [502]);
    });
});
