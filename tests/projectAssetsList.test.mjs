import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/v1/projects/[id]/assets/route.js';

Object.assign(process.env, { APP_ENV: 'development', PUBLIC_HOST: 'http://localhost:3000',
    SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_local_test', TENANT_PROJECTS_ENABLED: 'true' });
const original = globalThis.fetch;
test.after(() => { globalThis.fetch = original; });
const id = crypto.randomUUID();
const params = { params: Promise.resolve({ id }) };
const request = (authorization = 'Bearer test-user') => new Request(`http://localhost:3000/api/v1/projects/${id}/assets`, {
    headers: { authorization, 'x-veyrnox-auth-id': crypto.randomUUID(), 'x-request-id': crypto.randomUUID() },
});

test('lists inspected assets with the caller token, no storage key, not cacheable', async () => {
    const urls = [];
    globalThis.fetch = async (url, init) => {
        urls.push(String(url));
        assert.equal(init.headers.authorization, 'Bearer test-user');
        return Response.json(urls.length === 1 ? [{ id }] : [
            { id: 'a1', sniffed_type: 'video/mp4', byte_size: 10, duration_ms: 5000, width: 1280, height: 720, created_at: 'x', r2_key: 'secret' },
        ]);
    };
    const response = await GET(request(), params);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const body = await response.json();
    assert.deepEqual(body.assets, [{ id: 'a1', content_type: 'video/mp4', byte_size: 10, duration_ms: 5000, width: 1280, height: 720, created_at: 'x' }]);
    assert.match(urls[1], /state=eq\.inspected/);
    assert.match(urls[1], /limit=100/);
    assert.doesNotMatch(urls[1], /r2_key/);
});

test('a project the caller cannot see is 404 and no asset query is made', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json([]); };
    const response = await GET(request(), params);
    assert.equal(response.status, 404);
    assert.equal(calls, 1);
});

test('a malformed project id is rejected before any upstream call', async () => {
    globalThis.fetch = async () => { throw new Error('must not call upstream'); };
    const response = await GET(request(), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    assert.equal(response.status, 400);
});
