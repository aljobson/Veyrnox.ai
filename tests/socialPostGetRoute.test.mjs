import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { GET } = await import('../app/api/v1/social/posts/[id]/route.js');
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true',
    PUBLISH_TEAMS_ENABLED: 'true',
});
const auth = '11111111-1111-4111-8111-111111111111';
const ownerAuth = '66666666-6666-4666-8666-666666666666';
const brandId = '22222222-2222-4222-8222-222222222222';
const postId = '55555555-5555-4555-8555-555555555555';
const post = {
    id: postId, status: 'scheduled', scheduled_at: '2026-11-01T10:00:00Z', global_text: 'hi', created_at: '2026-10-18T10:00:00Z', updated_at: '2026-10-18T10:05:00Z',
    media: [{ media_type: 'image' }],
    targets: [{ id: 't1', account_id: 'a1', network: 'instagram', publish_status: 'pending' }],
};

let calls;
function stub(results = {}) {
    calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        calls.push({ name, args: JSON.parse(init.body) });
        const result = results[name] ?? ({
            consume_account_read_request: { ok: true },
            get_or_create_default_social_brand: { ok: true, brand_id: brandId, label: 'My Brand' },
            get_social_brand_access: { ok: true, brand_id: brandId, label: 'Shared', role: 'viewer', owner_auth_id: ownerAuth, paid: true },
            get_social_post: { ok: true, post },
        })[name];
        if (result instanceof Error) throw result;
        return Response.json(result);
    };
}
const call = (id = postId, headers = {}) => GET(
    new Request(`https://veyrnox.test/api/v1/social/posts/${id}`, { headers: { 'x-veyrnox-auth-id': auth, ...headers } }),
    { params: Promise.resolve({ id }) },
);

test('GET /posts/:id: missing or malformed identity never reaches the database', async () => {
    stub();
    for (const identity of ['', 'bad']) assert.equal((await call(postId, { 'x-veyrnox-auth-id': identity })).status, 401);
    assert.deepEqual(calls, []);
});

test('GET /posts/:id: a malformed id is 400 before any RPC', async () => {
    stub();
    const res = await call('not-a-uuid');
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'invalid_post_id' });
    assert.deepEqual(calls, []);
});

test('GET /posts/:id: returns the list row for the caller\'s own post, no-store', async () => {
    stub();
    const res = await call();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await res.json()).post, post);
    assert.deepEqual(calls.at(-1), { name: 'get_social_post', args: { p_auth_id: auth, p_brand_id: brandId, p_post_id: postId } });
});

test('GET /posts/:id: a viewer of a shared brand may read; the RPC runs as the brand owner', async () => {
    stub();
    const res = await call(postId, { 'x-publish-brand-id': brandId });
    assert.equal(res.status, 200);
    assert.deepEqual(calls.at(-1).args, { p_auth_id: ownerAuth, p_brand_id: brandId, p_post_id: postId });
});

test('GET /posts/:id: another brand\'s post is 404 post_not_found, same body as a missing post', async () => {
    stub({ get_social_post: { ok: false, code: 'POST_NOT_FOUND' } });
    const other = await call();
    stub({ get_social_post: { ok: false, code: 'POST_NOT_FOUND' } });
    const missing = await call('77777777-7777-4777-8777-777777777777');
    assert.equal(other.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(await other.json(), { error: 'post_not_found' });
    assert.deepEqual(await missing.json(), { error: 'post_not_found' });
});

test('GET /posts/:id: a non-member selecting a brand gets the brand lookup refusal, no post read', async () => {
    stub({ get_social_brand_access: { ok: false, code: 'BRAND_NOT_FOUND' } });
    const res = await call(postId, { 'x-publish-brand-id': brandId });
    assert.equal(res.status, 404);
    assert.equal(calls.some((c) => c.name === 'get_social_post'), false);
});

test('GET /posts/:id: rate limiting stops the request before any read', async () => {
    stub({ consume_account_read_request: { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 45 } });
    const res = await call();
    assert.equal(res.status, 429);
    assert.equal(calls.some((c) => c.name === 'get_social_post'), false);
});

test('GET /posts/:id: a database failure is a typed 502 with no detail', async () => {
    stub({ get_social_post: new Error('boom') });
    const res = await call();
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'internal' });
});

test('GET /posts/:id: the body carries no token or credential field', async () => {
    stub();
    const text = JSON.stringify(await (await call()).json());
    assert.doesNotMatch(text, /token|secret|credential|password/i);
});

test('0352 get_social_post is brand-scoped, definer-safe and service_role only', async () => {
    const sql = await readFile(new URL('../packages/db/schema/supabase/0352_get_social_post.sql', import.meta.url), 'utf8');
    assert.match(sql, /'updated_at',p\.updated_at/);
    assert.match(sql, /SECURITY DEFINER SET search_path=''/);
    assert.match(sql, /p\.id=p_post_id AND p\.brand_id=p_brand_id/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_social_post\(TEXT,UUID,UUID\) FROM PUBLIC,anon,authenticated/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_social_post\(TEXT,UUID,UUID\) TO service_role/);
    assert.doesNotMatch(sql, /access_token|refresh_token|credential/i);
});
