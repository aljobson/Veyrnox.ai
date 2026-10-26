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
function stub(result, createdAt = '2026-10-26T10:00:00.000Z') {
    let reservation;
    globalThis.fetch = async (url, init) => {
        const path = new URL(url).pathname;
        if (path.endsWith('/consume_upload_request')) return Response.json({ ok: true });
        if (path.endsWith('/read_user_balance')) return Response.json(10);
        if (path.endsWith('/reserve_upload')) { reservation = JSON.parse(init.body); return Response.json(result); }
        if (path.endsWith('/upload_reservations')) {
            const query = new URL(url).searchParams;
            assert.equal(query.get('select'), 'created_at');
            assert.equal(query.get('r2_key'), `eq.${reservation.p_key}`);
            assert.equal(query.get('limit'), '1');
            if (createdAt === 'unavailable') return new Response('', { status: 503 });
            return Response.json(createdAt === null ? [] : [{ created_at: createdAt }]);
        }
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
    assert.equal(body.reserved_until, '2026-10-27T09:00:00.000Z', 'deadline is based on database created_at, not Worker time');
    assert.deepEqual(body, {
        key: reserved().p_key, upload_url: body.upload_url, content_type: 'image/png',
        headers: { 'Content-Type': 'image/png', 'If-None-Match': '*' },
        max_bytes: 20 * 1024 * 1024, expires_in: 900, reserved: true, reserved_until: '2026-10-27T09:00:00.000Z',
    });
});

test('optional deadline lookup failure or invalid timestamp preserves the existing grant reply', async () => {
    for (const createdAt of [null, 'invalid', 'unavailable']) {
        stub({ ok: true }, createdAt);
        const res = await POST(request()), body = await res.json();
        assert.equal(res.status, 200); assert.equal(body.reserved, true);
        assert.deepEqual(Object.keys(body).sort(), ['key', 'upload_url', 'content_type', 'headers', 'max_bytes', 'expires_in', 'reserved'].sort());
    }
});

test('non-reserved uploads keep every existing response field and omit the deadline', async () => {
    process.env.UPLOAD_INTEGRITY_ENABLED = 'false';
    try {
        const reserved = stub({ ok: true });
        const res = await POST(request()), body = await res.json();
        assert.equal(res.status, 200); assert.equal(reserved(), undefined);
        assert.deepEqual(body, { key: body.key, upload_url: body.upload_url, content_type: 'image/png',
            max_bytes: 20 * 1024 * 1024, expires_in: 900, reserved: false });
    } finally { process.env.UPLOAD_INTEGRITY_ENABLED = 'true'; }
});

test('batch budget uses server-held totals before granting any upload, and fails closed', async () => {
    for (const budget of [{ ok: false, code: 'UPLOAD_BUDGET_EXCEEDED' }, null, { ok: true }]) {
        const calls = [];
        globalThis.fetch = async (url, init) => {
            const path = new URL(url).pathname; calls.push(path);
            if (path.endsWith('/consume_upload_request')) return Response.json({ ok: true });
            if (path.endsWith('/read_user_balance')) return Response.json(10);
            if (path.endsWith('/check_upload_batch_budget')) {
                const args = JSON.parse(init.body);
                assert.equal(args.p_count, 3); assert.equal(args.p_bytes, 300000000); assert.equal(args.p_auth_id, auth);
                assert.deepEqual(args.p_stored, []); return Response.json(budget);
            }
            if (path.endsWith('/reserve_upload')) return Response.json({ ok: true });
            return new Response('<ListBucketResult></ListBucketResult>');
        };
        const req = new Request('https://veyrnox.test/api/v1/uploads', { method: 'POST', headers: { 'x-veyrnox-auth-id': auth },
            body: JSON.stringify({ content_type: 'video/mp4', size_bytes: 100000000, batch_count: 3, batch_bytes: 300000000 }) });
        const res = await POST(req), body = await res.json();
        assert.equal(res.status, budget?.ok ? 200 : budget ? 429 : 503);
        assert.equal(calls.some(p => p.endsWith('/reserve_upload')), budget?.ok === true);
        if (!budget?.ok) assert.equal(body.upload_url, undefined);
        else assert.equal(body.reserved, true);
    }
});
