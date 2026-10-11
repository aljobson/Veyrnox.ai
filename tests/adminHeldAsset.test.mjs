import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', ADMIN_REQUIRE_AAL2: 'true',
    R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET: 'test' });
const { GET } = await import('../app/api/v1/admin/reports/asset/route.js');
const { GET: asset } = await import('../app/api/v1/jobs/[id]/asset/route.js');
const id = '11111111-1111-4111-8111-111111111111';
const headers = { 'x-veyrnox-auth-id': 'admin', 'x-veyrnox-auth-aal': 'aal2' };
const request = (query = `?job_id=${id}`, h = headers) => new Request('https://app.test/api/v1/admin/reports/asset' + query, { headers: h });
test('inspection gates and validation run before RPC', async () => {
    globalThis.fetch = () => assert.fail('network');
    assert.equal((await GET(request('', {}))).status, 401);
    assert.equal((await GET(request('', { ...headers, 'x-veyrnox-auth-aal': 'aal1' }))).status, 403);
    assert.equal((await GET(request('?job_id=bad'))).status, 400);
});
test('inspection only signs after successful audited RPC and expires in five minutes', async () => {
    globalThis.fetch = async (url, init) => {
        assert.match(String(url), /admin_held_asset$/);
        assert.deepEqual(JSON.parse(init.body), { p_auth_id: 'admin', p_job_id: id });
        return Response.json({ ok: true, r2_key: 'held/test.png', mime_type: 'image/png', size_bytes: 12 });
    };
    const res = await GET(request()); const body = await res.json();
    assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(body.expires_in, 300); assert.equal(body.mime_type, 'image/png');
    assert.equal(new URL(body.url).searchParams.get('X-Amz-Expires'), '300');
    for (const response of [Response.json({ ok: false, code: 'NOT_FOUND' }), Response.json({ code: '42501', message: 'not_admin' }, { status: 403 })]) {
        globalThis.fetch = async () => response;
        const refused = await GET(request()); assert.ok([403, 404].includes(refused.status));
        assert.equal((await refused.json()).url, undefined);
    }
});
test('ordinary asset serving maps HELD to 404 with no URL', async () => {
    globalThis.fetch = async () => Response.json({ ok: false, code: 'HELD' });
    const res = await asset(new Request('https://app.test/api/v1/jobs/' + id + '/asset', { headers }), { params: Promise.resolve({ id }) });
    assert.deepEqual([res.status, await res.json()], [404, { error: 'held' }]);
    assert.equal(res.headers.get('cache-control'), 'no-store');
});
