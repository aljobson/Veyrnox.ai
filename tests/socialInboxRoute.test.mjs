import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));
const { GET } = await import('../app/api/v1/social/inbox/route.js');

const auth = '11111111-1111-4111-8111-111111111111';
const brand = '22222222-2222-4222-8222-222222222222';
const account = '33333333-3333-4333-8333-333333333333';
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
    ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true', PUBLISH_RUNTIME_FLAGS: '{"plans":"true","inbox":"true"}' });
const request = (query = '', identity = auth) => new Request(`https://veyrnox.test/api/v1/social/inbox${query}`, { headers: { 'x-veyrnox-auth-id': identity } });
let calls;
function stub(results = {}) {
    calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        calls.push({ name, args: JSON.parse(init.body) });
        return Response.json(results[name] ?? ({ consume_account_read_request: { ok: true },
            get_or_create_default_social_brand: { ok: true, brand_id: brand },
            list_social_inbox: { ok: true, counts: { all: 1, unread: 1, unresolved: 1 }, members: [{ user_id: auth, email: 'owner@test' }], tags: ['sales'], threads: [{ id: 'thread' }] } })[name]);
    };
}

test('lists a paid inbox using actor identity and validated workflow filters', async () => {
    stub();
    const response = await GET(request(`?accountId=${account}&state=unread&kind=comment&search=hello&assignee=unassigned&priority=high&tag=sales`));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { brand_id: brand, counts: { all: 1, unread: 1, unresolved: 1 },
        members: [{ user_id: auth, email: 'owner@test' }], tags: ['sales'], threads: [{ id: 'thread' }] });
    assert.deepEqual(calls.at(-1), { name: 'list_social_inbox', args: { p_auth_id: auth, p_brand_id: brand,
        p_account_id: account, p_state: 'unread', p_kind: 'comment', p_search: 'hello',
        p_assignee: 'unassigned', p_priority: 'high', p_tag: 'sales' } });
});

test('rejects malformed identities and filters before inbox storage is read', async () => {
    for (const [url, identity] of [['', 'bad'], ['?state=unknown', auth], ['?accountId=bad', auth], [`?search=${'x'.repeat(101)}`, auth],
        ['?assignee=bad', auth], ['?priority=low', auth], ['?tag=%3Cscript%3E', auth]]) {
        stub(); const response = await GET(request(url, identity));
        assert.equal(response.status, identity === 'bad' ? 401 : 400);
        assert.equal(calls.length, 0);
    }
});

test('maps the database paid-plan boundary to an upgrade response', async () => {
    stub({ list_social_inbox: { ok: false, code: 'PLAN_REQUIRED' } });
    const response = await GET(request());
    assert.equal(response.status, 402);
    assert.deepEqual(await response.json(), { error: 'plan_required' });
});
