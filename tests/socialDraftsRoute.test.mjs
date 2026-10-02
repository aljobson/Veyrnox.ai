import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { GET, POST } = await import('../app/api/v1/social/drafts/route.js');
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true',
});
const auth = '11111111-1111-4111-8111-111111111111';
const brandId = '22222222-2222-4222-8222-222222222222';
const batchId = '33333333-3333-4333-8333-333333333333';
const postId = '55555555-5555-4555-8555-555555555555';

const getRequest = (headers = {}) => new Request('https://veyrnox.test/api/v1/social/drafts', {
    headers: { 'x-veyrnox-auth-id': auth, ...headers },
});
const postRequest = (body, headers = {}) => new Request('https://veyrnox.test/api/v1/social/drafts', {
    method: 'POST', headers: { 'x-veyrnox-auth-id': auth, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
});

let calls;
function stub(results = {}) {
    calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        calls.push({ name, args: JSON.parse(init.body) });
        const result = results[name] ?? ({
            consume_account_read_request: { ok: true },
            consume_social_post_write_request: { ok: true },
            get_or_create_default_social_brand: { ok: true, idempotent: true, brand_id: brandId },
            list_social_post_drafts: { ok: true, drafts: [] },
            approve_social_post_batch: { ok: true, approved: 3, failed: 1 },
            discard_social_post_drafts: { ok: true, discarded: 1 },
        })[name];
        if (result instanceof Error) throw result;
        return Response.json(result);
    };
}
const names = () => calls.map((c) => c.name);

test('missing or malformed identity never reaches the database', async () => {
    stub();
    for (const identity of ['', 'bad']) {
        assert.equal((await GET(getRequest({ 'x-veyrnox-auth-id': identity }))).status, 401);
        assert.equal((await POST(postRequest({ action: 'approve', batchId }, { 'x-veyrnox-auth-id': identity }))).status, 401);
    }
    assert.deepEqual(calls, []);
});

test('GET lists the caller\'s drafts on their own brand', async () => {
    const drafts = [{ id: postId, draft_batch_id: batchId, networks: ['instagram'] }];
    stub({ list_social_post_drafts: { ok: true, drafts } });
    const res = await GET(getRequest());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { brand_id: brandId, drafts });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(calls.find((c) => c.name === 'list_social_post_drafts').args, { p_auth_id: auth, p_brand_id: brandId });
});

test('malformed bodies are rejected before any write', async () => {
    stub();
    for (const [body, code] of [
        ['not json', 'invalid_body'],
        [{ action: 'publish', batchId }, 'invalid_action'],
        [{ action: 'approve', batchId: 'nope' }, 'invalid_batch_id'],
        [{ action: 'approve', batchId, postId }, 'invalid_post_id'],
        [{ action: 'discard', batchId, postId: 'nope' }, 'invalid_post_id'],
    ]) {
        const res = await POST(postRequest(body));
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.equal((await res.json()).error, code);
    }
    assert.deepEqual(calls, []);
});

test('approve schedules the batch through the write limit and the owner\'s brand', async () => {
    stub();
    const res = await POST(postRequest({ action: 'approve', batchId }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { approved: 3, failed: 1 });
    assert.deepEqual(names(), ['consume_social_post_write_request', 'get_or_create_default_social_brand', 'approve_social_post_batch']);
    assert.deepEqual(calls[2].args, { p_auth_id: auth, p_brand_id: brandId, p_batch_id: batchId });
});

test('discard takes one post or the whole batch', async () => {
    stub();
    assert.deepEqual(await (await POST(postRequest({ action: 'discard', batchId, postId }))).json(), { discarded: 1 });
    assert.equal(calls.at(-1).args.p_post_id, postId);
    stub();
    await POST(postRequest({ action: 'discard', batchId }));
    assert.equal(calls.at(-1).args.p_post_id, null);
});

test('a rate-limited caller never reaches the approval', async () => {
    stub({ consume_social_post_write_request: { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 30 } });
    const res = await POST(postRequest({ action: 'approve', batchId }));
    assert.equal(res.status, 429);
    assert.equal(names().includes('approve_social_post_batch'), false);
});

test('database outcomes map to typed errors without leaking details', async () => {
    stub({ approve_social_post_batch: { ok: false, code: 'BRAND_NOT_FOUND' } });
    let res = await POST(postRequest({ action: 'approve', batchId }));
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'brand_not_found' });

    const original = console.error; console.error = () => {};
    try {
        stub({ approve_social_post_batch: new Error('connection reset with secret detail') });
        res = await POST(postRequest({ action: 'approve', batchId }));
        assert.equal(res.status, 502);
        assert.deepEqual(await res.json(), { error: 'internal' });
    } finally { console.error = original; }
});
