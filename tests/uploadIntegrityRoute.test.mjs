import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test',
    R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET: 'test',
    UPLOAD_INTEGRITY_ENABLED: 'true', UPLOAD_REQUEST_RATE_LIMIT_ENABLED: 'true',
});
const { POST } = await import('../app/api/v1/uploads/route.js');
const auth = '11111111-1111-4111-8111-111111111111';
const request = () => new Request('https://veyrnox.test/api/v1/uploads', {
    method: 'POST', headers: { 'x-veyrnox-auth-id': auth }, body: JSON.stringify({ content_type: 'image/png', size_bytes: 1024 }),
});
function stub(result) {
    let reservation;
    globalThis.fetch = async (url, init) => {
        const path = new URL(url).pathname;
        if (path.endsWith('/consume_upload_request')) return Response.json({ ok: true });
        if (path.endsWith('/read_user_balance')) return Response.json(10);
        if (path.endsWith('/reserve_upload')) { reservation = JSON.parse(init.body); return Response.json(result); }
        return new Response('<ListBucketResult></ListBucketResult>');
    };
    return () => reservation;
}
test('no URL escapes if slot reservation fails', async () => {
    for (const [result, status] of [[{ ok: false, code: 'UPLOAD_BUDGET_EXCEEDED' }, 429], [null, 503]]) {
        stub(result);
        const res = await POST(request());
        assert.equal(res.status, status);
        assert.equal((await res.json()).upload_url, undefined);
    }
});
test('successful reservation yields a length-bound non-overwriting signature', async () => {
    const reserved = stub({ ok: true });
    const res = await POST(request());
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(reserved().p_key, body.key);
    assert.equal(reserved().p_size, 1024);
    assert.equal(reserved().p_auth_id, auth);
    assert.equal(body.headers['If-None-Match'], '*');
    assert.equal(new URL(body.upload_url).searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host;if-none-match');
});
