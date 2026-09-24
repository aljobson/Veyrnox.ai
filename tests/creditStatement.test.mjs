import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { historyCursor, historyPage } from '../lib/historyCursor.js';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true' });
const { GET } = await import('../app/api/v1/ledger/route.js');
const auth = '11111111-1111-4111-8111-111111111111', owner = '22222222-2222-4222-8222-222222222222';
const req = (query = '', id = auth) => new Request(`https://veyrnox.test/api/v1/ledger${query}`, { headers: id ? { 'x-veyrnox-auth-id': id } : {} });

test('cursor rejects SQL/filter syntax and keeps microsecond precision', () => {
    const before = '2026-09-24T12:00:00.123456Z';
    const filter = historyCursor(`https://test?${new URLSearchParams({ before, before_id: owner })}`);
    assert.match(decodeURIComponent(filter), /123456Z/);
    assert.match(decodeURIComponent(filter), /id.lt.22222222/);
    for (const query of ['?before_id=bad', '?before=2026-09-24', `?before=now()&before_id=${owner}`, `?before=${before}&before_id=${owner}),user_id.neq.x`]) {
        assert.throws(() => historyCursor('https://test' + query), /invalid_cursor/);
    }
});
test('next cursor uses the last visible row only when an extra row proves more history', () => {
    const rows = Array.from({ length: 26 }, (_, id) => ({ id, created_at: 'same' }));
    assert.deepEqual(historyPage(rows, 25).next, { before: 'same', before_id: 24 });
    assert.equal(historyPage(rows.slice(0, 25), 25).next, null);
});
test('ledger ownership comes only from verified identity and all movements remain separate', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const u = new URL(url); calls.push(u);
        if (u.pathname.endsWith('/consume_account_read_request')) {
            assert.equal(JSON.parse(init.body).p_auth_id, auth); return Response.json({ ok: true });
        }
        if (u.pathname.endsWith('/users')) {
            assert.equal(u.searchParams.get('auth_id'), `eq.${auth}`); return Response.json([{ id: owner }]);
        }
        assert.equal(u.searchParams.get('user_id'), `eq.${owner}`);
        assert.equal(u.searchParams.get('order'), 'created_at.desc,id.desc');
        assert.equal(u.searchParams.get('limit'), '26');
        return Response.json([
            { id: 'a', delta: -5, free_delta: -5, reason: 'debit:generation', created_at: '2026-09-24T12:00:00Z' },
            { id: 'b', delta: 5, free_delta: 5, reason: 'refund:provider_failed', created_at: '2026-09-24T12:01:00Z' },
            { id: 'c', delta: 2, free_delta: 0, reason: 'operator-private-note', created_at: '2026-09-24T12:02:00Z' },
        ]);
    };
    const response = await GET(req('?user_id=other-account'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.deepEqual(body.entries.map(e => [e.delta, e.kind]), [[-5, 'generation'], [5, 'generation_refund'], [2, 'adjustment']]);
    assert.equal(JSON.stringify(body).includes('operator-private-note'), false);
    assert.equal(calls.length, 3);
});
test('unauthenticated and malformed cursors perform no reads; quotas stop database history reads', async () => {
    globalThis.fetch = () => assert.fail('must not read');
    assert.equal((await GET(req('', null))).status, 401);
    assert.equal((await GET(req('?before=bad'))).status, 400);
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ ok: false, code: 'RATE_LIMITED', retry_after_seconds: 12 }); };
    assert.equal((await GET(req())).status, 429); assert.equal(calls, 1);
});
